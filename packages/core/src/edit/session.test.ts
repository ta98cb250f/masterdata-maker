import { beforeEach, describe, expect, it } from 'vitest';
import { loadProject } from '../io/project';
import { MemoryProjectFs } from '../io/memory-fs';
import type { Project } from '../model/project';
import { EditCode } from './codes';
import { createTable, deleteTable, enterInput, insertRows, renameColumn, renameTable, setEnums, updateColumn } from './index';
import type { EditEvent } from './session';
import { EditSession } from './session';
import type { CommandResult } from './transaction';
import { loadSample, mirror, recordUids, snapshot, tableNamed } from './test-helpers';

let project: Project;
let session: EditSession;

beforeEach(async () => {
  project = await loadSample();
  session = new EditSession(project);
});

function uid(name: string): number {
  return tableNamed(project, name).uid;
}

function setHp(text: string, index = 0): CommandResult {
  return enterInput(project, { table: uid('character'), cells: [{ record: recordUids(project, 'character')[index], column: 'hp' }], text });
}

function setCost(text: string): CommandResult {
  return enterInput(project, { table: uid('skill'), cells: [{ record: recordUids(project, 'skill')[0], column: 'cost' }], text });
}

describe('履歴（FR-HIS-01〜04）', () => {
  it('§5.17 の 6 番: テーブル A、B の順に編集して元に戻すを 2 回押すと、B、A の順に戻り、それぞれのテーブルが返る', () => {
    const original = snapshot(project);
    session.run(setHp('1000'));
    const afterA = snapshot(project);
    session.run(setCost('99'));
    const b = session.undo();
    expect(b?.tables[0]).toBe(uid('skill'));
    expect(snapshot(project)).toBe(afterA);
    const a = session.undo();
    expect(a?.tables[0]).toBe(uid('character'));
    expect(snapshot(project)).toBe(original);
    expect(session.undo()).toBeUndefined();
    expect(session.redo()?.tables[0]).toBe(uid('character'));
    expect(session.redo()?.tables[0]).toBe(uid('skill'));
    expect(session.redo()).toBeUndefined();
  });

  it('新しい操作をするとやり直しの履歴は消える。元に戻す操作の名前が分かる', () => {
    session.run(setHp('1000'));
    session.run(setHp('1100'));
    expect(session.undoLabel()).toBe(EditCode.opInput);
    session.undo();
    expect(session.canRedo()).toBe(true);
    session.run(setCost('5'));
    expect(session.canRedo()).toBe(false);
    expect(session.undoCount).toBe(2);
  });

  it('空のトランザクションは履歴に積まない', () => {
    const r = setHp('1200');
    expect(r.ok && r.tx.patches).toEqual([]);
    session.run(r);
    expect(session.canUndo()).toBe(false);
  });

  it('履歴の件数は既定で 200（P-44）。上限を超えたら古いものから捨てる', () => {
    const small = new EditSession(project, { historyLimit: 3 });
    for (let i = 1; i <= 5; i++) small.run(setHp(String(i)));
    expect(small.undoCount).toBe(3);
    for (let i = 0; i < 3; i++) small.undo();
    expect(tableNamed(project, 'character').records[0].cells.get('hp')).toBe(2);
    const big = new EditSession(project);
    for (let i = 0; i < 205; i++) big.run(setHp(String(i + 10)));
    expect(big.undoCount).toBe(200);
  });

  it('複数のコマンドを 1 つの操作にまとめる。途中で失敗したら全部戻す', () => {
    const original = snapshot(project);
    const t = uid('character');
    const r = session.applyGroup(EditCode.opUpdateColumn, [
      (p) => renameColumn(p, { table: t, from: 'hp', to: 'max_hp' }),
      (p) => {
        const field = tableNamed(p, 'character').fields.find((f) => f.name === 'max_hp')!;
        return updateColumn(p, { table: t, column: 'max_hp', field: { ...field, display_name: '最大HP' } });
      },
    ]);
    expect(r.ok).toBe(true);
    expect(session.undoCount).toBe(1);
    expect(tableNamed(project, 'character').fields.find((f) => f.name === 'max_hp')?.display_name).toBe('最大HP');
    session.undo();
    expect(snapshot(project)).toBe(original);
    session.redo();
    expect(tableNamed(project, 'character').fields.find((f) => f.name === 'max_hp')?.display_name).toBe('最大HP');
    session.undo();

    const failed = session.applyGroup(EditCode.opUpdateColumn, [
      (p) => renameColumn(p, { table: t, from: 'hp', to: 'max_hp' }),
      (p) => renameColumn(p, { table: t, from: 'name', to: 'max_hp' }),
    ]);
    expect(failed.ok).toBe(false);
    expect(snapshot(project)).toBe(original);
    expect(session.undoCount).toBe(0);
  });
});

describe('変更の購読（Worker への転送）', () => {
  it('当てたパッチを順に通知する。複製に同じ順で当てると同じ状態になる', async () => {
    const replica = await loadSample();
    const events: EditEvent['kind'][] = [];
    session.subscribe((e) => events.push(e.kind));
    mirror(session, replica);
    const rev = session.revision;
    session.run(insertRows(project, { table: uid('skill'), anchor: null, position: 'below', count: 2 }));
    session.run(setCost('7'));
    session.undo();
    session.undo();
    session.redo();
    expect(events).toEqual(['apply', 'apply', 'undo', 'undo', 'redo']);
    expect(session.revision).toBe(rev + 5);
    expect(snapshot(replica)).toBe(snapshot(project));
    // 採番も複製の側で進んでいる
    expect(replica.uids.peek()).toBe(project.uids.peek());
  });

  it('購読をやめられる', () => {
    let count = 0;
    const off = session.subscribe(() => count++);
    session.run(setHp('1'));
    off();
    session.run(setHp('2'));
    expect(count).toBe(1);
  });
});

describe('未保存の判定（FR-FIO-03〜05）', () => {
  it('§5.17 の 5 番: 別のテーブルに切り替えても未保存の変更が残る（テーブルごとに状態を持つ）', () => {
    session.run(setHp('1000'));
    expect(session.isTableDirty(uid('character'))).toBe(true);
    expect(session.isTableDirty(uid('skill'))).toBe(false);
    // テーブル B を開いて A に戻る（画面の切り替えはモデルを変えない）
    expect(tableNamed(project, 'skill').records).toHaveLength(3);
    expect(tableNamed(project, 'character').records[0].cells.get('hp')).toBe(1000);
    expect(session.isTableDirty(uid('character'))).toBe(true);
    expect(session.dirtyTables()).toEqual([uid('character')]);
    expect(session.hasUnsavedChanges()).toBe(true);
  });

  it('元に戻して読み込んだときの内容に戻れば未保存でなくなる', () => {
    expect(session.hasUnsavedChanges()).toBe(false);
    session.run(setHp('1000'));
    session.run(setHp('1200'));
    expect(session.isTableDirty(uid('character'))).toBe(false);
    session.undo();
    expect(session.isTableDirty(uid('character'))).toBe(true);
    session.undo();
    expect(session.isTableDirty(uid('character'))).toBe(false);
    expect(session.hasUnsavedChanges()).toBe(false);
  });

  it('手で元の値に入れ直しても、正規形のテキストが同じなら未保存でない（isTableModified は速い判定で true のまま）', () => {
    session.run(setHp('1000'));
    expect(session.isTableModified(uid('character'))).toBe(true);
    session.run(setHp('1200'));
    expect(session.isTableModified(uid('character'))).toBe(true);
    expect(session.isTableDirty(uid('character'))).toBe(false);
    session.undo();
    session.undo();
    expect(session.isTableModified(uid('character'))).toBe(false);
    expect(session.isTableModified(uid('skill'))).toBe(false);
  });

  it('保存すると保存したテキストが新しい基準になる。履歴は消えず、元に戻すと未保存になる', () => {
    session.run(setHp('1000'));
    const plan = session.planSave();
    expect(plan.files.map((f) => f.path)).toEqual(['tables/character.yaml']);
    expect(plan.files[0].text).toContain('    hp: 1000\n');
    expect(plan.remove).toEqual([]);
    session.markSaved(plan.files, plan.remove);
    expect(session.hasUnsavedChanges()).toBe(false);
    expect(tableNamed(project, 'character').source?.text).toBe(plan.files[0].text);
    expect(session.canUndo()).toBe(true);
    session.undo();
    expect(session.isTableDirty(uid('character'))).toBe(true);
    session.redo();
    expect(session.isTableDirty(uid('character'))).toBe(false);
  });

  it('共通設定の変更も未保存として扱う', () => {
    session.run(setEnums(project, [{ name: 'rarity', values: ['N'] }]));
    expect(session.isCommonDirty('enums')).toBe(true);
    expect(session.isCommonDirty('colors')).toBe(false);
    const plan = session.planSave();
    expect(plan.files.map((f) => [f.path, f.target.kind])).toEqual([['config/enums.yaml', 'common']]);
    session.markSaved(plan.files);
    expect(session.hasUnsavedChanges()).toBe(false);
  });

  it('読み込んだファイルが正規形でなくても、開いた直後は未保存にしない', async () => {
    const fs = new MemoryProjectFs({
      'sheetcraft.yaml': 'format_version: 1\nstorage:\n  format: yaml\ntimezone: Asia/Tokyo\n',
      'tables/item.yaml': '# コメント\ntable: item\nfields: []\nrecords:\n  - {id: 1}\n',
    });
    const result = await loadProject(fs);
    if (result.status !== 'ok') throw new Error('読み込めない');
    const s = new EditSession(result.project);
    expect(s.hasUnsavedChanges()).toBe(false);
    expect(s.planSave().files).toEqual([]);
    // 編集して元に戻せば、また未保存でなくなる
    const item = result.project.tables[0];
    s.run(enterInput(result.project, { table: item.uid, cells: [{ record: item.records[0].uid, column: 'version' }], text: '1' }));
    expect(s.isTableDirty(item.uid)).toBe(true);
    expect(s.planSave().files[0].text).toBe('table: item\nfields: []\nrecords:\n  - id: 1\n    version: "1"\n');
    s.undo();
    expect(s.hasUnsavedChanges()).toBe(false);
  });
});

describe('保存の計画（P-43）', () => {
  it('新しいテーブルは tables/<名前>.<拡張子> に書く', () => {
    session.run(createTable(project, { name: 'item' }));
    const plan = session.planSave();
    expect(plan.files.map((f) => f.path)).toEqual(['tables/item.yaml']);
    expect(plan.files[0].text).toBe('table: item\nfields: []\nrecords: []\n');
  });

  it('名前を変えたテーブルは新しい名前のファイルに書き、元のファイルを消す', () => {
    session.run(renameTable(project, { table: uid('skill'), name: 'ability' }));
    const plan = session.planSave();
    expect(plan.files.map((f) => f.path).sort()).toEqual(['tables/ability.yaml', 'tables/character.yaml']);
    expect(plan.remove).toEqual(['tables/skill.yaml']);
    session.markSaved(plan.files, plan.remove);
    expect(session.hasUnsavedChanges()).toBe(false);
    expect(tableNamed(project, 'ability').source?.path).toBe('tables/ability.yaml');
  });

  it('削除したテーブルのファイルを消す。同じ名前で作り直したら消さずに上書きする', () => {
    const stage = uid('stage');
    session.run(deleteTable(project, { table: stage }));
    expect(session.hasUnsavedChanges()).toBe(true);
    expect(session.removedTableFiles()).toEqual(['tables/stage.yaml']);
    expect(session.planSave()).toEqual({ files: [], remove: ['tables/stage.yaml'] });
    session.run(createTable(project, { name: 'stage' }));
    const plan = session.planSave();
    expect(plan.files.map((f) => f.path)).toEqual(['tables/stage.yaml']);
    expect(plan.remove).toEqual([]);
    session.markSaved(plan.files, plan.remove);
    expect(session.hasUnsavedChanges()).toBe(false);
    // 削除を元に戻すと、元のテーブルは未保存（ファイルは新しいテーブルの内容になっているため）
    session.undo();
    session.undo();
    expect(session.isTableDirty(stage)).toBe(true);
  });

  it('JSON のプロジェクトでも同じ（拡張子は形式に従う）', async () => {
    const json = await loadSample('basic-json');
    const s = new EditSession(json);
    s.run(createTable(json, { name: 'item' }));
    expect(s.planSave().files.map((f) => f.path)).toEqual(['tables/item.json']);
  });
});
