import { beforeEach, describe, expect, it } from 'vitest';
import { renameColumnInFormula } from '../formula/rename';
import type { Cell } from '../model/cell';
import { RichCell } from '../model/cell';
import type { Project } from '../model/project';
import { createMatcher, defaultFindOptions } from '../sheet/find';
import { planPaste } from '../sheet/clipboard';
import { EditCode } from './codes';
import {
  applySortOrder,
  changeColumnType,
  checkColumnTypeChange,
  clearCells,
  copyCells,
  createTable,
  deleteColumns,
  deleteRows,
  deleteTable,
  duplicateRows,
  duplicateTable,
  EditSession,
  enterInput,
  fillCells,
  fillDown,
  fillRight,
  fillSeriesCells,
  findTableReferences,
  insertColumn,
  insertRows,
  moveColumns,
  moveRows,
  pasteCells,
  renameBaseField,
  renameColumn,
  renameEnum,
  renameTable,
  replaceCells,
  setBaseFields,
  setCellColor,
  setCellComment,
  setColors,
  setColumnsHidden,
  setColumnWidth,
  setEnums,
  setFrozenColumns,
  setTableDisplayName,
  updateColumn,
} from './index';
import type { CommandResult, EditFailure, Transaction } from './index';
import { loadSample, mirror, recordUids, snapshot, tableNamed } from './test-helpers';

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

function rows(name: string): number[] {
  return recordUids(project, name);
}

function cellAt(table: string, index: number, column: string): Cell | undefined {
  return tableNamed(project, table).records[index].cells.get(column);
}

function failuresOf(r: CommandResult): EditFailure[] {
  if (r.ok) throw new Error(`成功してしまった: ${JSON.stringify(r.tx.patches.map((p) => p.op))}`);
  return r.failures;
}

/**
 * コマンドを当て、Worker 側の複製（構造化複製したパッチを当てたもの）と一致すること、
 * 元に戻すと正規形のテキストが元と一致し、やり直すと適用後と一致することを確かめる
 */
function check(make: (p: Project) => CommandResult): Transaction {
  const before = snapshot(project);
  const r = make(project);
  if (!r.ok) throw new Error(`失敗: ${JSON.stringify(r.failures)}`);
  const tx = session.apply(r.tx);
  const after = snapshot(project);
  expect(after).not.toBe(before);
  expect(snapshot(replica)).toBe(after);
  expect(session.undo()).toBe(tx);
  expect(snapshot(project)).toBe(before);
  expect(snapshot(replica)).toBe(before);
  expect(session.redo()).toBe(tx);
  expect(snapshot(project)).toBe(after);
  expect(snapshot(replica)).toBe(after);
  return tx;
}

/** 失敗して何も変わらないこと */
function rejects(make: (p: Project) => CommandResult): EditFailure[] {
  const before = snapshot(project);
  const failures = failuresOf(make(project));
  expect(snapshot(project)).toBe(before);
  return failures;
}

describe('セルへの入力（FR-EDT-01〜06）', () => {
  it('値を入れる。セル色とメモは残す', () => {
    const [r1, r2] = rows('character');
    const tx = check((p) => enterInput(p, { table: uid('character'), cells: [{ record: r1, column: 'hp' }], text: '1000' }));
    expect(cellAt('character', 0, 'hp')).toBe(1000);
    expect(tx.label).toBe(EditCode.opInput);
    expect(tx.tables).toEqual([uid('character')]);
    expect(tx.focus).toEqual({ table: uid('character'), records: [r1], columns: ['hp'] });
    check((p) => enterInput(p, { table: uid('character'), cells: [{ record: r2, column: 'hp' }], text: '1000' }));
    expect(cellAt('character', 1, 'hp')).toEqual(new RichCell({ value: 1000, color: 'red', comment: '次回調整予定' }));
  });

  it('= で始まればセル単位式にし、値を入れればセル単位式を消す', () => {
    const [r1, r2] = rows('character');
    check((p) => enterInput(p, { table: uid('character'), cells: [{ record: r1, column: 'effective_hp' }], text: '=hp * 3' }));
    expect(cellAt('character', 0, 'effective_hp')).toEqual(new RichCell({ override: 'hp * 3' }));
    check((p) => enterInput(p, { table: uid('character'), cells: [{ record: r2, column: 'effective_hp' }], text: '1.5' }));
    expect(cellAt('character', 1, 'effective_hp')).toBe(1.5);
  });

  it('型に合わない入力は確定させない（FR-EDT-05）', () => {
    const [r1] = rows('character');
    const failures = rejects((p) => enterInput(p, { table: uid('character'), cells: [{ record: r1, column: 'hp' }], text: '12a' }));
    expect(failures).toEqual([
      { code: EditCode.notInt, hint: EditCode.hintInt, params: { input: '12a' }, table: uid('character'), column: 'hp', input: '12a' },
    ]);
  });

  it('編集できない列は入力を受け付けない（FR-EDT-06）', () => {
    const [r1] = rows('character');
    const failures = rejects((p) => enterInput(p, { table: uid('character'), cells: [{ record: r1, column: 'id' }], text: '5' }));
    expect(failures.map((f) => f.code)).toEqual([EditCode.readonlyColumn]);
  });

  it('今の編集用のテキストと同じなら何も変えない。datetime は同じ瞬間なら元の時差を保つ（P-19）', () => {
    const [r1] = rows('character');
    const t = uid('character');
    const same = enterInput(project, { table: t, cells: [{ record: r1, column: 'hp' }], text: '1200' });
    expect(same.ok && same.tx.patches).toEqual([]);
    // 既存の値と同じ瞬間なら、時差の違う表記で入れても元の値のまま
    const sameInstant = enterInput(project, { table: t, cells: [{ record: r1, column: 'start_at' }], text: '2026-10-13T03:00:00Z' });
    expect(sameInstant.ok && sameInstant.tx.patches).toEqual([]);
    session.run(enterInput(project, { table: t, cells: [{ record: r1, column: 'start_at' }], text: '2026-10-14T03:00:00Z' }));
    expect(cellAt('character', 0, 'start_at')).toBe('2026-10-14T03:00:00+00:00');
    for (const text of ['2026-10-14 12:00:00', '2026-10-14 12:00']) {
      const r = enterInput(project, { table: t, cells: [{ record: r1, column: 'start_at' }], text });
      expect(r.ok && r.tx.patches, text).toEqual([]);
    }
    const undos = session.undoCount;
    session.apply((enterInput(project, { table: t, cells: [{ record: r1, column: 'hp' }], text: '1200' }) as { ok: true; tx: Transaction }).tx);
    expect(session.undoCount).toBe(undos);
  });

  it('複数のセルに同じ値を入れる（Ctrl+Enter）と 1 回で戻る', () => {
    const t = uid('character');
    check((p) => enterInput(p, { table: t, cells: rows('character').map((record) => ({ record, column: 'defense' })), text: '5' }));
    expect([0, 1, 2].map((i) => cellAt('character', i, 'defense'))).toEqual([5, 5, 5]);
  });

  it('読み込みエラーのテーブルは編集の対象にしない', () => {
    project.brokenTables.push({ kind: 'broken', uid: 555, name: 'bad', source: { path: 'tables/bad.yaml', format: 'yaml', text: '' }, diagnostics: [] });
    const failures = rejects((p) => enterInput(p, { table: 555, cells: [{ record: 1, column: 'x' }], text: '1' }));
    expect(failures).toEqual([{ code: EditCode.tableBroken, params: { table: 'bad' }, table: 555 }]);
  });
});

describe('値の消去・セル色・メモ（FR-EDT-02、FR-ANN-01〜02）', () => {
  it('値とセル単位式を消し、セル色とメモは残す。編集できない列は飛ばす', () => {
    const t = uid('character');
    const [r1, r2] = rows('character');
    check((p) =>
      clearCells(p, {
        table: t,
        cells: [
          { record: r2, column: 'hp' },
          { record: r2, column: 'effective_hp' },
          { record: r1, column: 'name' },
          { record: r1, column: 'id' },
        ],
      }),
    );
    expect(cellAt('character', 1, 'hp')).toEqual(new RichCell({ color: 'red', comment: '次回調整予定' }));
    expect(cellAt('character', 1, 'effective_hp')).toBeUndefined();
    expect(cellAt('character', 0, 'name')).toBeUndefined();
    expect(cellAt('character', 0, 'id')).toBe(1);
    expect(rejects((p) => clearCells(p, { table: t, cells: [{ record: r1, column: 'id' }] })).map((f) => f.code)).toEqual([EditCode.readonlyColumn]);
  });

  it('セル色を範囲にまとめて設定・解除する', () => {
    const t = uid('character');
    const cells = rows('character').map((record) => ({ record, column: 'hp' }));
    check((p) => setCellColor(p, { table: t, cells, color: 'blue' }));
    expect(cellAt('character', 0, 'hp')).toEqual(new RichCell({ value: 1200, color: 'blue' }));
    expect(cellAt('character', 1, 'hp')).toEqual(new RichCell({ value: 800, color: 'blue', comment: '次回調整予定' }));
    check((p) => setCellColor(p, { table: t, cells, color: null }));
    expect(cellAt('character', 0, 'hp')).toBe(1200);
    expect(rejects((p) => setCellColor(p, { table: t, cells, color: 'gold' })).map((f) => f.code)).toEqual([EditCode.colorUnknown]);
  });

  it('メモの追加・編集・削除', () => {
    const t = uid('character');
    const [r1, r2] = rows('character');
    check((p) => setCellComment(p, { table: t, cells: [{ record: r1, column: 'name' }], comment: '主人公' }));
    expect(cellAt('character', 0, 'name')).toEqual(new RichCell({ value: '勇者アルス', comment: '主人公' }));
    check((p) => setCellComment(p, { table: t, cells: [{ record: r2, column: 'hp' }], comment: '' }));
    expect(cellAt('character', 1, 'hp')).toEqual(new RichCell({ value: 800, color: 'red' }));
  });
});

describe('貼り付け（FR-CLP-03〜07）', () => {
  it('§5.17 の 3 番: int 列に 10、abc、30 を貼ると何も変わらず、2 行目の失敗が返る', () => {
    const t = uid('character');
    const failures = rejects((p) =>
      pasteCells(p, { table: t, rows: rows('character'), columns: ['hp'], clip: { text: [['10'], ['abc'], ['30']] } }),
    );
    expect(failures).toEqual([
      {
        code: EditCode.notInt,
        hint: EditCode.hintInt,
        params: { input: 'abc' },
        table: t,
        record: rows('character')[1],
        column: 'hp',
        row: 1,
        col: 0,
        input: 'abc',
      },
    ]);
    expect(session.canUndo()).toBe(false);
  });

  it('テキストを型に変換して貼る。セル色・メモは残す。= で始まれば式', () => {
    const t = uid('character');
    check((p) =>
      pasteCells(p, {
        table: t,
        rows: rows('character').slice(0, 2),
        columns: ['hp', 'defense', 'effective_hp'],
        clip: { text: [['10', '1,000', '=hp'], ['20', '', '1.5']] },
      }),
    );
    expect(cellAt('character', 0, 'hp')).toBe(10);
    expect(cellAt('character', 0, 'defense')).toBe(1000);
    expect(cellAt('character', 0, 'effective_hp')).toEqual(new RichCell({ override: 'hp' }));
    expect(cellAt('character', 1, 'hp')).toEqual(new RichCell({ value: 20, color: 'red', comment: '次回調整予定' }));
    expect(cellAt('character', 1, 'defense')).toBeUndefined();
    expect(cellAt('character', 1, 'effective_hp')).toBe(1.5);
  });

  it('1 セルのコピーを範囲に貼ると、範囲全体を同じ値で埋める（FR-CLP-03）', () => {
    const t = uid('character');
    const plan = planPaste({ rows: 1, cols: 1 }, { top: 0, left: 0, bottom: 2, right: 1 });
    expect(plan?.tiled).toBe(true);
    check((p) => pasteCells(p, { table: t, rows: rows('character'), columns: ['hp', 'defense'], clip: { text: [['7']] } }));
    for (let i = 0; i < 3; i++) expect(cellAt('character', i, 'defense')).toBe(7);
  });

  it('レコードの末尾を超えたら行を追加し、主キーを採番する（FR-CLP-05）。100 セルの貼り付けも 1 回で戻る（FR-HIS-03）', () => {
    const t = uid('skill');
    const existing = rows('skill');
    const text = Array.from({ length: 100 }, (_, i) => [String(i)]);
    const targetRows = [...existing, ...Array.from({ length: 97 }, () => null)];
    const tx = check((p) => pasteCells(p, { table: t, rows: targetRows, columns: ['cost'], clip: { text } }));
    const table = tableNamed(project, 'skill');
    expect(table.records).toHaveLength(100);
    expect(table.records.map((r) => r.cells.get('id'))).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(table.records[99].cells.get('cost')).toBe(99);
    expect(tx.focus?.records).toHaveLength(100);
    expect(session.undoCount).toBe(1);
  });

  it('編集できない列・表の右端を超える列が含まれるなら全体を取りやめる', () => {
    const t = uid('character');
    expect(
      rejects((p) => pasteCells(p, { table: t, rows: rows('character').slice(0, 1), columns: ['id', 'hp'], clip: { text: [['9', '9']] } })).map(
        (f) => f.code,
      ),
    ).toEqual([EditCode.readonlyColumn]);
    expect(
      rejects((p) => pasteCells(p, { table: t, rows: rows('character').slice(0, 1), columns: ['memo', null], clip: { text: [['a', 'b']] } })).map(
        (f) => f.code,
      ),
    ).toEqual([EditCode.pasteOutside]);
    expect(rejects((p) => pasteCells(p, { table: t, rows: rows('character'), columns: ['hp'], clip: { text: [] } })).map((f) => f.code)).toEqual([
      EditCode.pasteEmpty,
    ]);
  });

  it('本ツールの中でのコピーは値・セル単位式・セル色・メモを持ち込む（FR-CLP-06）', () => {
    const t = uid('character');
    const [r1, r2, r3] = rows('character');
    const clip = copyCells(project, { table: t, rows: [r2], columns: ['hp', 'effective_hp'] });
    expect(clip?.text).toEqual([['800', '=hp * 2']]);
    check((p) => pasteCells(p, { table: t, rows: [r3], columns: ['hp', 'effective_hp'], clip: clip! }));
    expect(cellAt('character', 2, 'hp')).toEqual(new RichCell({ value: 800, color: 'red', comment: '次回調整予定' }));
    expect(cellAt('character', 2, 'effective_hp')).toEqual(new RichCell({ override: 'hp * 2' }));
    // 空のセルを貼ると、貼り付け先のセル色・メモも消える
    const empty = copyCells(project, { table: t, rows: [r1], columns: ['effective_hp'] });
    check((p) => pasteCells(p, { table: t, rows: [r3], columns: ['effective_hp'], clip: empty! }));
    expect(cellAt('character', 2, 'effective_hp')).toBeUndefined();
  });

  it('型が違う列へのコピーは変換する。変換できなければ失敗の一覧', () => {
    const t = uid('character');
    const [r1, r2] = rows('character');
    const clip = copyCells(project, { table: t, rows: [r1], columns: ['hp', 'name'] });
    check((p) => pasteCells(p, { table: t, rows: [r2], columns: ['memo', 'defense'].slice(0, 1), clip: { ...clip!, text: [clip!.text[0].slice(0, 1)] } }));
    expect(cellAt('character', 1, 'memo')).toBe('1200');
    const failures = rejects((p) => pasteCells(p, { table: t, rows: [r2], columns: ['hp', 'defense'], clip: clip! }));
    expect(failures.map((f) => [f.code, f.col, f.input])).toEqual([[EditCode.notInt, 1, '勇者アルス']]);
  });

  it('切り取りと貼り付けで元のセルを空にする（値・式・色・メモ）。別のテーブルへも', () => {
    const c = uid('character');
    const s = uid('skill');
    const [, r2] = rows('character');
    const clip = copyCells(project, { table: c, rows: [r2], columns: ['hp'], cut: true });
    const [s1] = rows('skill');
    const tx = check((p) => pasteCells(p, { table: s, rows: [s1], columns: ['cost'], clip: clip! }));
    expect(cellAt('character', 1, 'hp')).toBeUndefined();
    expect(cellAt('skill', 0, 'cost')).toEqual(new RichCell({ value: 800, color: 'red', comment: '次回調整予定' }));
    expect(tx.tables).toEqual([s, c]);
  });

  it('同じテーブルの中で切り取って、重なる範囲へ貼る', () => {
    const t = uid('character');
    const [r1, r2, r3] = rows('character');
    const clip = copyCells(project, { table: t, rows: [r1, r2], columns: ['defense'], cut: true });
    check((p) => pasteCells(p, { table: t, rows: [r2, r3], columns: ['defense'], clip: clip! }));
    expect([0, 1, 2].map((i) => cellAt('character', i, 'defense'))).toEqual([undefined, 30, 10]);
  });

  it('値のみ貼り付けは計算済みの値を使い、式・色・メモを持ち込まない（FR-CLP-07）', () => {
    const t = uid('character');
    const [r1, r2, r3] = rows('character');
    const effective = (_table: number, record: number, column: string) => (column === 'effective_hp' ? (record === r2 ? 1600 : 1560) : undefined);
    const clip = copyCells(project, { table: t, rows: [r2], columns: ['effective_hp'], effectiveValue: effective });
    expect(clip?.text).toEqual([['1600']]);
    check((p) => pasteCells(p, { table: t, rows: [r1], columns: ['hp'], clip: clip!, valuesOnly: true }));
    expect(cellAt('character', 0, 'hp')).toBe(1600);
    const rich = copyCells(project, { table: t, rows: [r2], columns: ['hp'] });
    check((p) => pasteCells(p, { table: t, rows: [r3], columns: ['hp'], clip: rich!, valuesOnly: true }));
    expect(cellAt('character', 2, 'hp')).toBe(800);
    // 他のアプリからのテキストでは、= で始まっても式にしない
    check((p) => pasteCells(p, { table: t, rows: [r3], columns: ['memo'], clip: { text: [['=hp']] }, valuesOnly: true }));
    expect(cellAt('character', 2, 'memo')).toBe('=hp');
  });

  it('Ctrl+D / Ctrl+R: 先頭の行・列をコピーする（FR-FIL-04）', () => {
    const t = uid('character');
    check((p) => fillDown(p, { table: t, rows: rows('character'), columns: ['hp', 'defense'] }));
    expect(cellAt('character', 2, 'hp')).toBe(1200);
    expect(cellAt('character', 2, 'defense')).toBe(30);
    check((p) => fillRight(p, { table: t, rows: rows('character').slice(0, 1), columns: ['defense', 'hp', 'memo'] }));
    expect(cellAt('character', 0, 'hp')).toBe(30);
    expect(cellAt('character', 0, 'memo')).toBe('30');
  });
});

describe('フィル（FR-FIL-01〜05）', () => {
  it('数値は等差を見つけて続ける（下・上）', () => {
    const t = uid('character');
    const [r1, r2, r3] = rows('character');
    check((p) => fillCells(p, { table: t, source: { rows: [r1, r2], columns: ['hp'] }, targetRows: [r3], direction: 'down' }));
    expect(cellAt('character', 2, 'hp')).toEqual(400);
    check((p) => fillCells(p, { table: t, source: { rows: [r2, r3], columns: ['defense'] }, targetRows: [r1], direction: 'up' }));
    expect(cellAt('character', 0, 'defense')).toBeUndefined();
  });

  it('§5.17 の 4 番: 1、2 から下へ 3 セル分で 3、4、5。末尾が数字の文字列は数字を進める', () => {
    const t = uid('stage');
    session.run(insertRows(project, { table: t, anchor: null, position: 'below', count: 3 }));
    const [s1, s2, ...rest] = rows('stage');
    session.run(pasteCells(project, { table: t, rows: [s1, s2], columns: ['boss_id'], clip: { text: [['1'], ['2']] } }));
    session.run(setCellColor(project, { table: t, cells: [{ record: s1, column: 'boss_id' }], color: 'red' }));
    check((p) => fillCells(p, { table: t, source: { rows: [s1, s2], columns: ['boss_id', 'name'] }, targetRows: rest, direction: 'down' }));
    // セル色・メモは元の範囲の対応するセルから持ち込む（並びを繰り返す）
    expect([2, 3, 4].map((i) => cellAt('stage', i, 'boss_id'))).toEqual([new RichCell({ value: 3, color: 'red' }), 4, new RichCell({ value: 5, color: 'red' })]);
    expect([2, 3, 4].map((i) => cellAt('stage', i, 'name'))).toEqual(['stage_03', 'stage_04', 'stage_05']);
  });

  it('列の型に変換できなければ全体を取りやめる（int 列に小数）', () => {
    const t = uid('character');
    session.run(enterInput(project, { table: t, cells: [{ record: rows('character')[2], column: 'hp' }], text: '1001' }));
    const [r1, r2, r3] = rows('character');
    // 1200, 800, 1001 は等差でないので最小二乗法の直線で延長し（P-41）、整数にならない
    session.run(insertRows(project, { table: t, anchor: null, position: 'below', count: 1 }));
    const r4 = rows('character')[3];
    const f2 = rejects((p) => fillCells(p, { table: t, source: { rows: [r1, r2, r3], columns: ['hp'] }, targetRows: [r4], direction: 'down' }));
    expect(f2.map((f) => [f.code, f.record])).toEqual([[EditCode.notInt, r4]]);
  });

  it('右へのフィルは列をまたいで推定し、各列の型に変換する。編集できない列は取りやめる', () => {
    const t = uid('character');
    const [r1] = rows('character');
    check((p) => fillCells(p, { table: t, source: { rows: [r1], columns: ['hp'] }, targetColumns: ['defense', 'memo'], direction: 'right' }));
    expect(cellAt('character', 0, 'defense')).toBe(1200);
    expect(cellAt('character', 0, 'memo')).toBe('1200');
    const failures = rejects((p) => fillCells(p, { table: t, source: { rows: [r1], columns: ['version'] }, targetColumns: ['id'], direction: 'left' }));
    expect(failures.map((f) => f.code)).toEqual([EditCode.readonlyColumn]);
  });

  it('日時は間隔を見つけて続ける', () => {
    const t = uid('character');
    const [r1, r2, r3] = rows('character');
    check((p) => fillCells(p, { table: t, source: { rows: [r1, r2], columns: ['start_at'] }, targetRows: [r3], direction: 'down' }));
    // 2026-10-13 12:00 と 2026-10-20 00:00 の間隔は 6.5 日
    expect(cellAt('character', 2, 'start_at')).toBe('2026-10-26T12:00:00+09:00');
  });

  it('連番の入力（FR-FIL-05）', () => {
    const t = uid('character');
    const cells = rows('character').map((record) => ({ record, column: 'hp' }));
    check((p) => fillSeriesCells(p, { table: t, cells, start: '10', step: '5' }));
    expect([0, 1, 2].map((i) => cellAt('character', i, 'hp'))).toEqual([10, new RichCell({ value: 15, color: 'red', comment: '次回調整予定' }), 20]);
    check((p) => fillSeriesCells(p, { table: t, cells: rows('character').map((record) => ({ record, column: 'power' })), start: '9007199254740993', step: '2' }));
    expect(cellAt('character', 2, 'power')).toBe(9007199254740997n);
    check((p) => fillSeriesCells(p, { table: t, cells: rows('character').map((record) => ({ record, column: 'start_at' })), start: '2026-11-01', step: '0.5' }));
    expect(cellAt('character', 2, 'start_at')).toBe('2026-11-02T00:00:00+09:00');
    expect(rejects((p) => fillSeriesCells(p, { table: t, cells: [{ record: rows('character')[0], column: 'name' }], start: '1', step: '1' })).map((f) => f.code)).toEqual([
      EditCode.seriesUnsupportedType,
    ]);
    expect(rejects((p) => fillSeriesCells(p, { table: t, cells, start: 'x', step: '1' })).map((f) => f.code)).toEqual([EditCode.seriesInvalidStart]);
    expect(rejects((p) => fillSeriesCells(p, { table: t, cells, start: '1', step: '0.5' })).map((f) => f.code)).toEqual([EditCode.notInt]);
  });
});

describe('行（FR-ROW-01〜04、FR-SRT-02）', () => {
  it('上・下への挿入（複数行）。主キーは既存の最大値＋1 から（DR-16）', () => {
    const t = uid('character');
    const [r1, r2] = rows('character');
    const tx = check((p) => insertRows(p, { table: t, anchor: r1, position: 'above', count: 2 }));
    const table = tableNamed(project, 'character');
    expect(table.records.map((r) => r.cells.get('id'))).toEqual([4, 5, 1, 2, 3]);
    expect(tx.focus?.records).toEqual(table.records.slice(0, 2).map((r) => r.uid));
    check((p) => insertRows(p, { table: t, anchor: r2, position: 'below', count: 1 }));
    expect(tableNamed(project, 'character').records.map((r) => r.cells.get('id'))).toEqual([4, 5, 1, 2, 6, 3]);
  });

  it('削除（複数行）', () => {
    const t = uid('character');
    const [r1, , r3] = rows('character');
    check((p) => deleteRows(p, { table: t, records: [r3, r1] }));
    expect(rows('character')).toHaveLength(1);
  });

  it('複製は主キーを採番し直す', () => {
    const t = uid('character');
    const [r1, r2] = rows('character');
    check((p) => duplicateRows(p, { table: t, records: [r2, r1] }));
    const table = tableNamed(project, 'character');
    expect(table.records.map((r) => r.cells.get('id'))).toEqual([1, 2, 4, 5, 3]);
    expect(table.records[3].cells.get('hp')).toEqual(new RichCell({ value: 800, color: 'red', comment: '次回調整予定' }));
    expect(table.records[2].uid).not.toBe(r1);
  });

  it('移動（ファイル上の順序も変わる）', () => {
    const t = uid('character');
    const [r1, r2, r3] = rows('character');
    check((p) => moveRows(p, { table: t, records: [r3], before: r1 }));
    expect(rows('character')).toEqual([r3, r1, r2]);
    check((p) => moveRows(p, { table: t, records: [r3, r1], before: null }));
    expect(rows('character')).toEqual([r2, r3, r1]);
    expect(rejects((p) => moveRows(p, { table: t, records: [r1], before: r1 })).map((f) => f.code)).toEqual([EditCode.invalidMoveTarget]);
  });

  it('並べ替えの適用。一部の行だけなら、その行の位置の中で並べる', () => {
    const t = uid('character');
    const [r1, r2, r3] = rows('character');
    check((p) => applySortOrder(p, { table: t, order: [r3, r2, r1] }));
    expect(rows('character')).toEqual([r3, r2, r1]);
    session.undo();
    check((p) => applySortOrder(p, { table: t, order: [r3, r1] }));
    expect(rows('character')).toEqual([r3, r2, r1]);
  });
});

describe('列（FR-COL-01〜08）', () => {
  it('挿入。固定する列の範囲の中なら固定する列の数を増やす', () => {
    const t = uid('character');
    check((p) => insertColumn(p, { table: t, position: { anchor: 'hp', side: 'right' }, field: { name: 'mp', type: 'int' } }));
    expect(tableNamed(project, 'character').fields.map((f) => f.name).slice(0, 4)).toEqual(['name', 'rarity', 'hp', 'mp']);
    session.run(setFrozenColumns(project, { table: t, count: 3 }));
    check((p) => insertColumn(p, { table: t, position: { anchor: 'id', side: 'left' }, field: { name: 'first', type: 'string' } }));
    expect(tableNamed(project, 'character').fields[0].name).toBe('first');
    expect(tableNamed(project, 'character').view.frozen_columns).toBe(4);
  });

  it('列名の書式・重複・型の指定を確かめる', () => {
    const t = uid('character');
    const ins = (name: string, type: 'int' | 'enum' = 'int') => rejects((p) => insertColumn(p, { table: t, position: { index: 0 }, field: { name, type } }));
    expect(ins('Bad')[0].code).toBe(EditCode.columnInvalidName);
    expect(ins('1x')[0].code).toBe(EditCode.columnInvalidName);
    expect(ins('true')[0].code).toBe(EditCode.columnInvalidName);
    expect(ins('hp')[0].code).toBe(EditCode.columnDuplicate);
    expect(ins('version')[0].code).toBe(EditCode.columnDuplicate);
    expect(ins('kind', 'enum')[0].code).toBe(EditCode.enumRefRequired);
  });

  it('削除。表示設定の中のその列の指定も消す。共通列は消せない', () => {
    const t = uid('character');
    check((p) => deleteColumns(p, { table: t, columns: ['hp', 'memo'] }));
    const table = tableNamed(project, 'character');
    expect(table.fields.some((f) => f.name === 'hp')).toBe(false);
    expect(table.view.column_widths).toEqual([['name', 160]]);
    expect(table.records.some((r) => r.cells.has('hp'))).toBe(false);
    expect(rejects((p) => deleteColumns(p, { table: t, columns: ['id'] })).map((f) => f.code)).toEqual([EditCode.columnIsBaseField]);
    // 固定する列の範囲の中の列を消したら、固定する列の数を減らす
    check((p) => deleteColumns(p, { table: uid('stage'), columns: ['name'] }));
    expect(tableNamed(project, 'stage').view.frozen_columns).toBe(1);
  });

  it('設定の編集。列名と型はここでは変えない', () => {
    const t = uid('character');
    const hp = tableNamed(project, 'character').fields.find((f) => f.name === 'hp')!;
    check((p) => updateColumn(p, { table: t, column: 'hp', field: { ...hp, display_name: '体力', validation: { required: true, min: 1 } } }));
    expect(tableNamed(project, 'character').fields.find((f) => f.name === 'hp')?.display_name).toBe('体力');
    expect(rejects((p) => updateColumn(p, { table: t, column: 'hp', field: { ...hp, name: 'x' } }))[0].code).toBe(EditCode.columnNameChange);
    expect(rejects((p) => updateColumn(p, { table: t, column: 'hp', field: { ...hp, type: 'float' } }))[0].code).toBe(EditCode.columnTypeChange);
    expect(rejects((p) => updateColumn(p, { table: t, column: 'id', field: { name: 'id', type: 'int' } }))[0].code).toBe(EditCode.columnIsBaseField);
  });

  it('列名の変更（FR-COL-03）: 同じテーブルの式・他のテーブルの ref・全テーブルの REF() をまとめて書き換える', () => {
    const c = uid('character');
    const s = uid('stage');
    // 準備: stage に REF() の式の列と、character.code を参照する列を足す
    session.run(insertColumn(project, { table: s, position: { index: 2 }, field: { name: 'boss_hp', type: 'int', formula: 'REF("character", boss_id, "HP")' } }));
    session.run(insertColumn(project, { table: s, position: { index: 3 }, field: { name: 'boss_code', type: 'string', ref: 'character.code' } }));
    const [s1] = rows('stage');
    session.run(enterInput(project, { table: s, cells: [{ record: s1, column: 'boss_hp' }], text: '=REF("character", 1, "hp") + 1' }));

    check((p) => renameColumn(p, { table: c, from: 'hp', to: 'max_hp' }));
    const character = tableNamed(project, 'character');
    expect(character.fields.find((f) => f.name === 'effective_hp')?.formula).toBe('max_hp * (1 + defense / 100)');
    expect(cellAt('character', 1, 'effective_hp')).toEqual(new RichCell({ override: 'max_hp * 2' }));
    expect(cellAt('character', 1, 'max_hp')).toEqual(new RichCell({ value: 800, color: 'red', comment: '次回調整予定' }));
    expect(character.view.column_widths).toEqual([['name', 160], ['max_hp', 80], ['memo', 200]]);
    const stage = tableNamed(project, 'stage');
    expect(stage.fields.find((f) => f.name === 'boss_hp')?.formula).toBe('REF("character", boss_id, "max_hp")');
    expect(cellAt('stage', 0, 'boss_hp')).toEqual(new RichCell({ override: 'REF("character", 1, "max_hp") + 1' }));

    check((p) => renameColumn(p, { table: c, from: 'code', to: 'char_code' }));
    expect(tableNamed(project, 'stage').fields.find((f) => f.name === 'boss_code')?.ref).toBe('character.char_code');
    expect(renameColumnInFormula('code', 'code', 'x')).toBe('x');
    expect(rejects((p) => renameColumn(p, { table: c, from: 'name', to: 'rarity' }))[0].code).toBe(EditCode.columnDuplicate);
    expect(rejects((p) => renameColumn(p, { table: c, from: 'id', to: 'key' }))[0].code).toBe(EditCode.columnIsBaseField);
  });

  it('型の変更（FR-COL-04）: 変換できない値を先に一覧で返し、承認後に変換する（変換できない値は残す）', () => {
    const t = uid('character');
    const check1 = checkColumnTypeChange(project, { table: t, column: 'code', type: 'float' });
    expect(check1.ok && check1.issues.map((i) => [i.input, i.error.code])).toEqual([
      ['NO', EditCode.notNumber],
      ['null', EditCode.notNumber],
    ]);
    check((p) => changeColumnType(p, { table: t, column: 'code', type: 'float' }));
    expect([0, 1, 2].map((i) => cellAt('character', i, 'code'))).toEqual(['NO', 1.1, 'null']);
    check((p) => changeColumnType(p, { table: t, column: 'hp', type: 'string' }));
    expect(cellAt('character', 0, 'hp')).toBe('1200');
    expect(cellAt('character', 1, 'hp')).toEqual(new RichCell({ value: '800', color: 'red', comment: '次回調整予定' }));
    check((p) => changeColumnType(p, { table: t, column: 'rarity', type: 'list<enum>' }));
    expect(cellAt('character', 0, 'rarity')).toEqual(['SSR']);
    check((p) => changeColumnType(p, { table: t, column: 'defense', type: 'int64' }));
    const defense = tableNamed(project, 'character').fields.find((f) => f.name === 'defense');
    expect(defense?.default).toBe(0n);
    expect(cellAt('character', 0, 'defense')).toBe(30n);
    expect(rejects((p) => changeColumnType(p, { table: t, column: 'memo', type: 'enum' }))[0].code).toBe(EditCode.enumRefRequired);
  });

  it('移動（共通列は動かせない）', () => {
    const t = uid('character');
    check((p) => moveColumns(p, { table: t, columns: ['memo', 'code'], before: 'name' }));
    expect(tableNamed(project, 'character').fields.map((f) => f.name).slice(0, 3)).toEqual(['code', 'memo', 'name']);
    expect(rejects((p) => moveColumns(p, { table: t, columns: ['id'], before: null }))[0].code).toBe(EditCode.columnIsBaseField);
    expect(rejects((p) => moveColumns(p, { table: t, columns: ['hp'], before: 'version' }))[0].code).toBe(EditCode.invalidMoveTarget);
  });

  it('列幅・固定する列の数・非表示（表示設定）', () => {
    const t = uid('character');
    check((p) => setColumnWidth(p, { table: t, columns: ['hp', 'rarity'], width: 120 }));
    expect(tableNamed(project, 'character').view.column_widths).toEqual([['name', 160], ['hp', 120], ['memo', 200], ['rarity', 120]]);
    check((p) => setColumnWidth(p, { table: t, columns: ['name'], width: 100 }));
    expect(tableNamed(project, 'character').view.column_widths.some(([n]) => n === 'name')).toBe(false);
    check((p) => setFrozenColumns(p, { table: t, count: 0 }));
    expect(tableNamed(project, 'character').view.frozen_columns).toBeUndefined();
    check((p) => setColumnsHidden(p, { table: t, columns: ['memo', 'version'], hidden: true }));
    expect(tableNamed(project, 'character').view.hidden_columns).toEqual(['memo', 'version']);
    check((p) => setColumnsHidden(p, { table: uid('stage'), columns: ['version'], hidden: false }));
    expect(tableNamed(project, 'stage').view.hidden_columns).toBeUndefined();
    expect(rejects((p) => setColumnWidth(p, { table: t, columns: ['hp'], width: 0 }))[0].code).toBe(EditCode.invalidWidth);
  });
});

describe('置換（FR-FND-04）', () => {
  it('型の変換規則と編集可否に従い、置換できたものを 1 つのトランザクションにし、できなかったセルを返す', () => {
    const c = uid('character');
    const s = uid('skill');
    const m = createMatcher({ ...defaultFindOptions('1'), regex: false });
    if (!m.ok) throw new Error('matcher');
    const cells = [
      ...rows('character').map((record) => ({ table: c, record, column: 'hp' })),
      ...rows('character').map((record) => ({ table: c, record, column: 'id' })),
      ...rows('skill').map((record) => ({ table: s, record, column: 'cost' })),
      { table: c, record: rows('character')[1], column: 'code' },
    ];
    const before = snapshot(project);
    const result = replaceCells(project, { cells, matcher: m.matcher, replacement: 'x', searchFormulas: false });
    // 置換できたのは code の 1.10 → x.x0 だけ。hp の 1200 → x200、cost の 10 → x0 は整数でない。id は編集できない
    expect(result.replaced).toBe(1);
    expect(result.failures.map((f) => [f.code, f.column, f.input])).toEqual([
      [EditCode.notInt, 'hp', 'x200'],
      [EditCode.readonlyColumn, 'id', 'x'],
      [EditCode.notInt, 'cost', 'x0'],
      [EditCode.notInt, 'cost', 'x2'],
    ]);
    expect(snapshot(project)).toBe(before);
    session.apply(result.tx!);
    expect(cellAt('character', 1, 'code')).toBe('x.x0');
    session.undo();
    expect(snapshot(project)).toBe(before);
  });

  it('式の中も置換する。偽ならセル単位式のセルは対象にしない', () => {
    const t = uid('character');
    const m = createMatcher(defaultFindOptions('hp'));
    if (!m.ok) throw new Error('matcher');
    const cells = [{ table: t, record: rows('character')[1], column: 'effective_hp' }];
    expect(replaceCells(project, { cells, matcher: m.matcher, replacement: 'defense', searchFormulas: false }).tx).toBeNull();
    const r = replaceCells(project, { cells, matcher: m.matcher, replacement: 'defense', searchFormulas: true });
    check(() => ({ ok: true, tx: r.tx! }));
    expect(cellAt('character', 1, 'effective_hp')).toEqual(new RichCell({ override: 'defense * 2' }));
  });
});

describe('テーブル（FR-TBL-01〜03）', () => {
  it('新規作成（共通列だけの雛形）', () => {
    const tx = check((p) => createTable(p, { name: 'item', display_name: 'アイテム' }));
    const item = tableNamed(project, 'item');
    expect(item).toMatchObject({ name: 'item', display_name: 'アイテム', fields: [], records: [], source: null });
    expect(tx.tables).toEqual([item.uid]);
    expect(project.tables.map((t) => t.name)).toEqual(['character', 'item', 'skill', 'stage']);
    expect(rejects((p) => createTable(p, { name: 'skill' }))[0].code).toBe(EditCode.tableDuplicate);
    expect(rejects((p) => createTable(p, { name: 'Item' }))[0].code).toBe(EditCode.tableInvalidName);
  });

  it('複製', () => {
    check((p) => duplicateTable(p, { table: uid('skill'), name: 'skill_copy' }));
    const copy = tableNamed(project, 'skill_copy');
    const original = tableNamed(project, 'skill');
    expect(copy.records.map((r) => r.cells.get('name'))).toEqual(original.records.map((r) => r.cells.get('name')));
    expect(copy.records.map((r) => r.uid).some((u) => original.records.some((r) => r.uid === u))).toBe(false);
    expect(copy.source).toBeNull();
  });

  it('名前の変更: 他のテーブルの ref と全テーブルの REF() も書き換える', () => {
    const c = uid('character');
    session.run(insertColumn(project, { table: c, position: { index: 0 }, field: { name: 'total_cost', type: 'int', formula: 'SUM(REF("skill", skill_ids, "cost"))' } }));
    check((p) => renameTable(p, { table: uid('skill'), name: 'ability' }));
    const character = tableNamed(project, 'character');
    expect(character.fields.find((f) => f.name === 'skill_ids')?.ref).toBe('ability.id');
    expect(character.fields.find((f) => f.name === 'total_cost')?.formula).toBe('SUM(REF("ability", skill_ids, "cost"))');
    expect(project.tables.map((t) => t.name)).toEqual(['ability', 'character', 'stage']);
    check((p) => setTableDisplayName(p, { table: uid('ability'), displayName: 'アビリティ' }));
  });

  it('削除と、参照しているものの一覧（削除前の警告用）', () => {
    expect(findTableReferences(project, uid('character'))).toEqual([
      { table: uid('stage'), tableName: 'stage', column: 'boss_id', kind: 'ref', count: 1 },
    ]);
    expect(findTableReferences(project, uid('skill'))).toEqual([
      { table: uid('character'), tableName: 'character', column: 'skill_ids', kind: 'ref', count: 1 },
    ]);
    expect(findTableReferences(project, uid('stage'))).toEqual([]);
    const s = uid('stage');
    const tx = check((p) => deleteTable(p, { table: s }));
    expect(project.tables.map((t) => t.name)).toEqual(['character', 'skill']);
    session.undo();
    expect(tx.tables).toEqual([s]);
    expect(tableNamed(project, 'stage').source?.path).toBe('tables/stage.yaml');
  });

  it('共通設定（列挙型・セル色・共通列）の編集', () => {
    check((p) => setEnums(p, [...p.common.enums.items, { name: 'size', values: ['S', 'M', 'L'] }]));
    expect(project.common.enums.items.map((e) => e.name)).toEqual(['rarity', 'element', 'size']);
    check((p) => setColors(p, [{ key: 'red', color: '#ff0000', label: '赤' }]));
    check((p) => setBaseFields(p, [...p.common.base_fields.items, { name: 'note', type: 'string' }]));
    expect(rejects((p) => setBaseFields(p, [{ name: 'hp', type: 'int' }]))[0].code).toBe(EditCode.columnDuplicate);
    expect(rejects((p) => setEnums(p, [{ name: 'a', values: [] }, { name: 'a', values: [] }]))[0].code).toBe(EditCode.commonDuplicateName);
  });

  it('共通列の名前の変更: 全テーブルのセルのキー・表示設定・式も書き換える', () => {
    const c = uid('character');
    session.run(insertColumn(project, { table: c, position: { index: 0 }, field: { name: 'label', type: 'string', formula: 'version & "!"' } }));
    check((p) => renameBaseField(p, { from: 'version', to: 'ver' }));
    expect(project.common.base_fields.items.map((f) => f.name)).toEqual(['id', 'ver']);
    expect(cellAt('character', 2, 'ver')).toBe('0.1.2');
    expect(cellAt('stage', 0, 'ver')).toBe('0.1.2');
    expect(tableNamed(project, 'stage').view.hidden_columns).toEqual(['ver']);
    expect(tableNamed(project, 'character').fields.find((f) => f.name === 'label')?.formula).toBe('ver & "!"');
    expect(rejects((p) => renameBaseField(p, { from: 'ver', to: 'hp' }))[0].code).toBe(EditCode.columnDuplicate);
  });

  it('列挙型の名前の変更: enum_ref も書き換える', () => {
    check((p) => renameEnum(p, { from: 'element', to: 'attribute' }));
    expect(tableNamed(project, 'character').fields.find((f) => f.name === 'element')?.enum_ref).toBe('attribute');
    expect(tableNamed(project, 'skill').fields.find((f) => f.name === 'element')?.enum_ref).toBe('attribute');
  });
});
