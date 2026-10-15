import { beforeEach, describe, expect, it } from 'vitest';
import { RichCell } from '../model/cell';
import type { Project } from '../model/project';
import type { Patch } from './patch';
import {
  PatchError,
  applyPatch,
  applyPatches,
  cellDataEquals,
  commonVersion,
  fromCellData,
  recordIndex,
  tableListVersion,
  tableVersion,
  toCellData,
} from './patch';
import { loadSample, recordUids, snapshot, structuredCloneOf, tableNamed } from './test-helpers';

let project: Project;
let replica: Project;

beforeEach(async () => {
  project = await loadSample();
  replica = await loadSample();
});

function uidOf(name: string): number {
  return tableNamed(project, name).uid;
}

/** パッチを当て、逆のパッチで元に戻ること、複製したパッチを別のプロジェクトに当てても同じ結果になることを確かめる */
function roundTrip(patch: Patch): { inverse: Patch; after: string } {
  const before = snapshot(project);
  const inverse = applyPatch(project, patch);
  const after = snapshot(project);
  expect(after).not.toBe(before);
  // Worker との同期の前提: 構造化複製したパッチを別のモデルに当てても同じ状態になる
  applyPatch(replica, structuredCloneOf(patch));
  expect(snapshot(replica)).toBe(after);
  applyPatch(project, inverse);
  expect(snapshot(project)).toBe(before);
  applyPatch(replica, structuredCloneOf(inverse));
  expect(snapshot(replica)).toBe(before);
  return { inverse, after };
}

describe('セルの形の変換', () => {
  it('RichCell とプレーンな形を行き来する。値だけなら値そのものに戻る', () => {
    const rich = new RichCell({ value: [1, 2], color: 'red', comment: 'メモ' });
    const data = toCellData(rich);
    expect(data).toEqual({ value: [1, 2], color: 'red', comment: 'メモ' });
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
    const back = fromCellData(data);
    expect(back).toBeInstanceOf(RichCell);
    expect(back).toEqual(rich);
    expect(fromCellData({ value: 5 })).toBe(5);
    expect(fromCellData({})).toBeUndefined();
    expect(fromCellData({ value: '', color: '' })).toBeUndefined();
    expect(fromCellData(structuredCloneOf(toCellData(new RichCell({ override: 'hp * 2' }))))).toEqual(new RichCell({ override: 'hp * 2' }));
  });

  it('比べるときは未入力の値と空の文字列を無いものとみなし、number と bigint は区別する', () => {
    expect(cellDataEquals({ value: '' }, null)).toBe(true);
    expect(cellDataEquals({ value: [] , color: '' }, {})).toBe(true);
    expect(cellDataEquals({ value: 1 }, { value: 1n })).toBe(false);
    expect(cellDataEquals({ value: [1, 2] }, { value: [1, 2] })).toBe(true);
    expect(cellDataEquals({ value: 1, comment: 'a' }, { value: 1, comment: 'b' })).toBe(false);
  });
});

describe('各パッチの適用と逆のパッチ', () => {
  it('setCells: 値・RichCell・未入力', () => {
    const t = uidOf('character');
    const [r1, r2] = recordUids(project, 'character');
    roundTrip({
      op: 'setCells',
      table: t,
      cells: [
        { record: r1, column: 'hp', cell: { value: 1000 } },
        { record: r2, column: 'hp', cell: { value: 1000, color: 'red', comment: '次回調整予定' } },
        { record: r1, column: 'memo', cell: null },
        { record: r1, column: 'defense', cell: { override: 'hp / 10' } },
        { record: r1, column: 'hp', cell: { value: 1100 } },
      ],
    });
  });

  it('insertRecords / deleteRecords: 位置を保って戻る', () => {
    const t = uidOf('character');
    const [r1, , r3] = recordUids(project, 'character');
    roundTrip({
      op: 'insertRecords',
      table: t,
      items: [
        { index: 0, record: { uid: 900, cells: [['id', { value: 10 }]], extra: [] } },
        { index: 2, record: { uid: 901, cells: [['id', { value: 11 }], ['hp', { value: 5, color: 'red' }]], extra: [] } },
        { index: 4, record: { uid: 902, cells: [], extra: [] } },
      ],
    });
    const { inverse } = roundTrip({ op: 'deleteRecords', table: t, records: [r3, r1] });
    expect(inverse).toMatchObject({ op: 'insertRecords', items: [{ index: 0 }, { index: 2 }] });
  });

  it('insertRecords は内部番号の採番を先に進める（Worker 側のモデルでも重ならない）', () => {
    const t = uidOf('skill');
    applyPatch(project, { op: 'insertRecords', table: t, items: [{ index: 0, record: { uid: 5000, cells: [], extra: [] } }] });
    expect(project.uids.peek()).toBe(5001);
  });

  it('setRecordOrder', () => {
    const t = uidOf('character');
    const order = recordUids(project, 'character').reverse();
    roundTrip({ op: 'setRecordOrder', table: t, order });
  });

  it('insertField / deleteField: 列定義とセルの値', () => {
    const t = uidOf('skill');
    const [r1, r2] = recordUids(project, 'skill');
    roundTrip({
      op: 'insertField',
      table: t,
      index: 1,
      field: { name: 'mp', type: 'int', display_name: 'MP' },
      cells: [
        [r1, { value: 3 }],
        [r2, { value: 4, comment: 'x' }],
      ],
    });
    roundTrip({ op: 'deleteField', table: uidOf('character'), name: 'hp' });
  });

  it('updateField / renameField / renameCellKey / setFieldOrder', () => {
    const t = uidOf('character');
    roundTrip({ op: 'updateField', table: t, name: 'hp', field: { name: 'hp', type: 'int', display_name: '体力' } });
    roundTrip({ op: 'renameField', table: t, from: 'hp', to: 'max_hp' });
    roundTrip({ op: 'renameCellKey', table: t, from: 'version', to: 'ver' });
    const names = tableNamed(project, 'character').fields.map((f) => f.name);
    roundTrip({ op: 'setFieldOrder', table: t, order: [...names].reverse() });
  });

  it('setView', () => {
    roundTrip({ op: 'setView', table: uidOf('character'), view: { column_widths: [['hp', 120]], hidden_columns: ['memo'] } });
  });

  it('setTableName はテーブルを名前の順に並べ直す。setTableDisplayName', () => {
    const t = uidOf('character');
    const listBefore = tableListVersion(project);
    roundTrip({ op: 'setTableName', table: t, name: 'zebra' });
    expect(tableListVersion(project)).toBeGreaterThan(listBefore);
    const inverse = applyPatch(project, { op: 'setTableName', table: t, name: 'zebra' });
    expect(project.tables.map((x) => x.name)).toEqual(['skill', 'stage', 'zebra']);
    applyPatch(project, inverse);
    expect(project.tables.map((x) => x.name)).toEqual(['character', 'skill', 'stage']);
    roundTrip({ op: 'setTableDisplayName', table: uidOf('skill'), displayName: null });
    roundTrip({ op: 'setTableDisplayName', table: uidOf('skill'), displayName: '技' });
  });

  it('addTable / removeTable: 読み込み元の情報も含めて戻る', () => {
    const { inverse } = roundTrip({ op: 'removeTable', table: uidOf('stage') });
    expect(inverse).toMatchObject({ op: 'addTable', table: { name: 'stage', source: { path: 'tables/stage.yaml' } } });
    roundTrip({
      op: 'addTable',
      table: {
        uid: 777,
        name: 'item',
        fields: [{ name: 'name', type: 'string' }],
        records: [{ uid: 778, cells: [['id', { value: 1 }]], extra: [] }],
        view: { column_widths: [] },
        source: null,
        diagnostics: [],
      },
    });
  });

  it('setCommon: 共通設定と「既定値か」', () => {
    roundTrip({ op: 'setCommon', part: 'enums', items: [{ name: 'rarity', values: ['N'] }], isDefault: false });
    roundTrip({ op: 'setCommon', part: 'colors', items: [{ key: 'red', color: '#ff0000' }], isDefault: false });
    roundTrip({
      op: 'setCommon',
      part: 'base_fields',
      items: [{ name: 'id', type: 'int', primary: true, auto: 'increment', editable: false }],
      isDefault: true,
    });
  });
});

describe('適用の失敗', () => {
  it('指す先が無ければ PatchError で、モデルは変えない', () => {
    const before = snapshot(project);
    const t = uidOf('character');
    expect(() => applyPatch(project, { op: 'setCells', table: t, cells: [{ record: 1, column: 'hp', cell: null }, { record: 99999, column: 'hp', cell: null }] })).toThrow(PatchError);
    expect(() => applyPatch(project, { op: 'renameField', table: t, from: 'hp', to: 'name' })).toThrow(PatchError);
    expect(() => applyPatch(project, { op: 'setTableName', table: t, name: 'skill' })).toThrow(PatchError);
    expect(() => applyPatch(project, { op: 'removeTable', table: 424242 })).toThrow(PatchError);
    expect(snapshot(project)).toBe(before);
  });

  it('applyPatches は途中で失敗したら、それまでに当てたものを戻す（全部か無しか）', () => {
    const before = snapshot(project);
    const t = uidOf('character');
    const [r1] = recordUids(project, 'character');
    expect(() =>
      applyPatches(project, [
        { op: 'setCells', table: t, cells: [{ record: r1, column: 'hp', cell: { value: 1 } }] },
        { op: 'deleteRecords', table: t, records: [r1] },
        { op: 'deleteRecords', table: t, records: [r1] },
      ]),
    ).toThrow(PatchError);
    expect(snapshot(project)).toBe(before);
  });

  it('読み込みエラーのテーブル（BrokenTable）には当てられない', () => {
    project.brokenTables.push({ kind: 'broken', uid: 555, name: 'bad', source: { path: 'tables/bad.yaml', format: 'yaml', text: '' }, diagnostics: [] });
    expect(() => applyPatch(project, { op: 'setView', table: 555, view: { column_widths: [] } })).toThrow(PatchError);
  });
});

describe('版数', () => {
  it('変更のたびに、そのテーブルの版数が変わる。共通列の変更は全テーブルの版数を変える', () => {
    const c = uidOf('character');
    const s = uidOf('skill');
    const [r1] = recordUids(project, 'character');
    const v0 = tableVersion(project, c);
    const s0 = tableVersion(project, s);
    applyPatch(project, { op: 'setCells', table: c, cells: [{ record: r1, column: 'hp', cell: { value: 1 } }] });
    const v1 = tableVersion(project, c);
    expect(v1).not.toBe(v0);
    expect(tableVersion(project, s)).toBe(s0);
    const cv = commonVersion(project);
    applyPatch(project, { op: 'setCommon', part: 'colors', items: [], isDefault: false });
    expect(commonVersion(project)).not.toBe(cv);
    expect(tableVersion(project, c)).toBe(v1);
    applyPatch(project, { op: 'setCommon', part: 'base_fields', items: [...project.common.base_fields.items], isDefault: false });
    expect(tableVersion(project, c)).not.toBe(v1);
    expect(tableVersion(project, s)).not.toBe(s0);
  });

  it('レコードの索引はレコードの増減に追従する', () => {
    const t = tableNamed(project, 'skill');
    expect(recordIndex(project, t).size).toBe(3);
    applyPatch(project, { op: 'insertRecords', table: t.uid, items: [{ index: 3, record: { uid: 6000, cells: [], extra: [] } }] });
    expect(recordIndex(project, t).has(6000)).toBe(true);
    applyPatch(project, { op: 'deleteRecords', table: t.uid, records: [6000] });
    expect(recordIndex(project, t).has(6000)).toBe(false);
  });
});
