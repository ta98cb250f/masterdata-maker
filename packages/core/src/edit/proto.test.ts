import { beforeEach, describe, expect, it } from 'vitest';
import { Calculator } from '../calc';
import { planExport } from '../export';
import { serializeTable } from '../io/serialize';
import type { Project } from '../model/project';
import type { TableProto } from '../model/proto';
import { resolveProto } from '../model/proto';
import { tableColumns } from '../model/table';
import {
  changeColumnType,
  deleteColumns,
  EditSession,
  insertColumn,
  moveColumns,
  renameBaseField,
  renameColumn,
  setBaseFields,
  updateColumn,
} from './index';
import type { CommandResult, Transaction } from './index';
import { loadSample, mirror, snapshot, tableNamed } from './test-helpers';

// 列の操作とフィールド番号（P-63）。サンプルの stage は `proto` が無いので、以前の規則で id 1, version 2, name 3, boss_id 4

let project: Project;
let replica: Project;
let session: EditSession;

beforeEach(async () => {
  project = await loadSample();
  replica = await loadSample();
  session = new EditSession(project);
  mirror(session, replica);
});

function uid(name: string): number {
  return tableNamed(project, name).uid;
}

/** 今の列に合わせたフィールド番号 */
function protoOf(name: string): TableProto {
  const table = tableNamed(project, name);
  return resolveProto(table.proto, tableColumns(project.common.base_fields.items, table));
}

/** 適用して、Worker 側の複製と一致し、元に戻す・やり直すで番号も戻ることを確かめる */
function check(make: (p: Project) => CommandResult): Transaction {
  const before = snapshot(project);
  const r = make(project);
  if (!r.ok) throw new Error(`失敗: ${JSON.stringify(r.failures)}`);
  const tx = session.apply(r.tx);
  const after = snapshot(project);
  expect(snapshot(replica)).toBe(after);
  session.undo();
  expect(snapshot(project)).toBe(before);
  expect(snapshot(replica)).toBe(before);
  session.redo();
  expect(snapshot(project)).toBe(after);
  expect(snapshot(replica)).toBe(after);
  return tx;
}

function protoFile(name: string): string {
  const result = planExport(project, new Calculator(project), { format: 'protobuf', tables: [name] });
  expect(result.ok).toBe(true);
  return result.files[0].content as string;
}

describe('列の操作とフィールド番号（P-63）', () => {
  it('列を先頭に足しても既存の番号は変わらず、新しい列は最大 + 1。保存すると proto を書く', () => {
    expect(tableNamed(project, 'stage').proto).toBeUndefined();
    check((p) => insertColumn(p, { table: uid('stage'), position: { index: 0 }, field: { name: 'reward', type: 'int' } }));
    expect(protoOf('stage')).toEqual({
      fields: [
        ['id', 1],
        ['version', 2],
        ['reward', 5],
        ['name', 3],
        ['boss_id', 4],
      ],
      reserved: [],
    });
    const text = serializeTable(tableNamed(project, 'stage'), project.common.base_fields.items, 'yaml');
    expect(text.endsWith('proto:\n  fields:\n    id: 1\n    version: 2\n    reward: 5\n    name: 3\n    boss_id: 4\n')).toBe(true);
    expect(protoFile('stage')).toContain('  optional int64 reward = 5;\n');
  });

  it('列の移動では番号が変わらない（proto の無いテーブルは、以前の規則の番号を引き継ぐ）', () => {
    check((p) => moveColumns(p, { table: uid('stage'), columns: ['boss_id'], before: 'name' }));
    expect(protoOf('stage').fields).toEqual([
      ['id', 1],
      ['version', 2],
      ['boss_id', 4],
      ['name', 3],
    ]);
  });

  it('列を消すと番号と名前を reserved にする。同じ名前の列を作り直すと新しい番号で、名前は reserved から外す', () => {
    check((p) => deleteColumns(p, { table: uid('stage'), columns: ['name'] }));
    expect(protoOf('stage').reserved).toEqual([{ number: 3, name: 'name' }]);
    const proto = protoFile('stage');
    expect(proto).toContain('message Stage { // ステージ\n  reserved 3;\n  reserved "name";\n  optional int64 id = 1;');
    check((p) => insertColumn(p, { table: uid('stage'), position: { index: 0 }, field: { name: 'name', type: 'string' } }));
    expect(protoOf('stage')).toEqual({
      fields: [
        ['id', 1],
        ['version', 2],
        ['name', 5],
        ['boss_id', 4],
      ],
      reserved: [{ number: 3 }],
    });
  });

  it('列名の変更では番号を引き継ぐ', () => {
    check((p) => renameColumn(p, { table: uid('stage'), from: 'name', to: 'title' }));
    expect(protoOf('stage')).toEqual({
      fields: [
        ['id', 1],
        ['version', 2],
        ['title', 3],
        ['boss_id', 4],
      ],
      reserved: [],
    });
  });

  it('proto の型が変わる型の変更は新しい番号にし、古い番号を reserved にする。同じ型のままなら番号は変えない', () => {
    check((p) => changeColumnType(p, { table: uid('stage'), column: 'boss_id', type: 'int64' }));
    expect(protoOf('stage').fields[3]).toEqual(['boss_id', 4]);
    check((p) => changeColumnType(p, { table: uid('stage'), column: 'boss_id', type: 'string' }));
    expect(protoOf('stage').fields[3]).toEqual(['boss_id', 5]);
    expect(protoOf('stage').reserved).toEqual([{ number: 4 }]);
  });

  it('出力しない列にしても番号は変わらず、.proto では欠番になる', () => {
    const field = { ...tableNamed(project, 'stage').fields[0], export: false };
    check((p) => updateColumn(p, { table: uid('stage'), column: 'name', field }));
    const proto = protoFile('stage');
    expect(proto).toContain('  optional string version = 2; // バージョン\n  optional int64 boss_id = 4; // ボス\n');
    expect(proto).not.toContain('reserved');
  });

  it('共通列の名前の変更は全テーブルで番号を引き継ぎ、共通列を足すと各テーブルで最大 + 1', () => {
    check((p) => renameBaseField(p, { from: 'version', to: 'ver' }));
    for (const name of ['character', 'skill', 'stage']) {
      expect(protoOf(name).fields[1]).toEqual(['ver', 2]);
      expect(protoOf(name).reserved).toEqual([]);
    }
    const stageMax = Math.max(...protoOf('stage').fields.map(([, n]) => n));
    check((p) => setBaseFields(p, [...p.common.base_fields.items, { name: 'note', type: 'string' }]));
    expect(protoOf('stage').fields[2]).toEqual(['note', stageMax + 1]);
  });
});
