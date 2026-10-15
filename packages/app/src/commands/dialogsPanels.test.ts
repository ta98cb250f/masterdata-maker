import { describe, expect, it } from 'vitest';
import { SHORTCUTS, enterInput, selectCell, selectColRange } from '@sheetcraft/core';
import { goToLocationText } from '../components/NameBox';
import { findBar } from '../components/findBarState';
import { insertColumnAndSelect, suggestColumnName } from '../dialogs/columnInsert';
import { columnTarget } from '../dialogs/columnSettings';
import { seriesTarget } from '../dialogs/series';
import { groupShortcuts } from '../dialogs/shortcuts';
import { problemRows, revealDiagnostic } from '../panels/problems';
import { openSampleStore, tableUid } from '../testing/sampleStore';
import { columnsToDelete } from './columns';
import { duplicateAndShow } from './tables';

describe('列の操作の対象（column.*）', () => {
  it('args が無ければ選択中の列。列全体を選んでいれば選んだ列すべてを削除の対象にし、共通列は分ける', async () => {
    const store = await openSampleStore();
    const sheet = store.sheet();
    if (sheet === null) throw new Error('no sheet');
    const name = sheet.colOf('name');
    store.setSelection(selectCell({ row: 0, col: name }, sheet.size));
    expect(columnTarget(store)?.column).toBe('name');
    store.setSelection(selectColRange(sheet.colOf('version'), sheet.colOf('hp'), sheet.size));
    expect(columnsToDelete(store)).toMatchObject({ columns: ['name', 'rarity', 'hp'], base: ['version'] });
    // 選択の中の列を指せば選択全体、外の列を指せばその列だけ
    expect(columnsToDelete(store, { column: 'rarity' })?.columns).toEqual(['name', 'rarity', 'hp']);
    expect(columnsToDelete(store, { column: 'memo' })?.columns).toEqual(['memo']);
  });

  it('列の挿入: 使われていない列名の候補。挿入した列を選ぶ', async () => {
    const store = await openSampleStore();
    const project = store.project;
    const table = store.table();
    if (project === null || table === undefined) throw new Error('not open');
    expect(suggestColumnName(project, table)).toBe('column_1');
    expect(insertColumnAndSelect(store, { table: table.uid, column: 'hp', side: 'left' }, { name: 'atk', type: 'int' })).toBeNull();
    const sheet = store.sheet();
    expect(sheet?.colOf('atk')).toBe((sheet?.colOf('hp') ?? 0) - 1);
    expect(store.selection()?.kind).toBe('cols');
    // 同じ名前は挿入できない
    expect(insertColumnAndSelect(store, { table: table.uid, column: 'hp', side: 'left' }, { name: 'atk', type: 'int' })?.[0]).toContain('既にあります');
  });
});

describe('テーブルの複製（table.duplicate）', () => {
  it('名前の候補を付けて複製し、複製を表示する。表示名は「… のコピー」', async () => {
    const store = await openSampleStore();
    expect(duplicateAndShow(store, tableUid(store, 'stage'))).toBe(true);
    expect(store.table()?.name).toBe('stage_copy');
    expect(store.table()?.display_name).toBe('ステージ のコピー');
    expect(store.table()?.records.length).toBe(2);
    expect(duplicateAndShow(store, tableUid(store, 'stage'))).toBe(true);
    expect(store.table()?.name).toBe('stage_copy2');
  });
});

describe('問題パネル（FR-UI-06）', () => {
  it('共通設定・テーブルの順に並べ、押すとそのテーブルのセルを選ぶ', async () => {
    const store = await openSampleStore();
    const project = store.project;
    if (project === null) throw new Error('not open');
    const character = project.tables.find((t) => t.name === 'character');
    if (character === undefined) throw new Error('no character');
    // hp の min に違反する値を入れる（id=3）
    const record = character.records[2];
    expect(store.apply(enterInput(project, { table: character.uid, cells: [{ record: record.uid, column: 'hp' }], text: '0' })).ok).toBe(true);
    await store.flushValidation();
    const rows = problemRows(store.getState().validation, store.tabs().map((t) => t.name), 'ja');
    const row = rows.find((r) => r.table === 'character' && r.column === 'hp' && r.key === '3');
    expect(row?.diagnostic.severity).toBe('error');
    store.setActiveTable(tableUid(store, 'skill'));
    if (row !== undefined) revealDiagnostic(store, row.diagnostic);
    expect(store.table()?.name).toBe('character');
    const sheet = store.sheet();
    expect(store.selection()?.anchor).toEqual({ row: 2, col: sheet?.colOf('hp') });
  });
});

describe('ショートカット一覧・連番入力・名前ボックス・検索欄', () => {
  it('ショートカットを分類ごとに分ける（分類の順は最初に出てきた順）', () => {
    const groups = groupShortcuts(SHORTCUTS);
    expect(groups[0][0]).toBe('common');
    expect(groups.map(([c]) => c)).toContain('navigate');
    expect(groups.flatMap(([, list]) => list).length).toBe(SHORTCUTS.length);
  });

  it('連番入力の対象: 複数の行なら列ごと、1 行なら左から右。開始値は先頭のセルの値', async () => {
    const store = await openSampleStore();
    const sheet = store.sheet();
    if (sheet === null) throw new Error('no sheet');
    const hp = sheet.colOf('hp');
    const defense = sheet.colOf('defense');
    store.setSelection({ kind: 'cells', anchor: { row: 0, col: hp }, active: { row: 2, col: defense }, ranges: [{ top: 0, left: hp, bottom: 2, right: defense }] });
    const t = seriesTarget(store);
    expect(t?.groups.map((g) => g.map((c) => c.column))).toEqual([
      ['hp', 'hp', 'hp'],
      ['defense', 'defense', 'defense'],
    ]);
    expect(t?.start).toBe('1200');
    store.setSelection({ kind: 'cells', anchor: { row: 0, col: hp }, active: { row: 0, col: defense }, ranges: [{ top: 0, left: hp, bottom: 0, right: defense }] });
    expect(seriesTarget(store)?.groups.map((g) => g.map((c) => c.column))).toEqual([['hp', 'defense']]);
  });

  it('名前ボックス: 位置へ移る。移れなければ理由を返す', async () => {
    const store = await openSampleStore();
    expect(goToLocationText(store, 'stage / boss_id / 2')).toBeNull();
    expect(store.table()?.name).toBe('stage');
    const sheet = store.sheet();
    expect(store.selection()?.anchor).toEqual({ row: 1, col: sheet?.colOf('boss_id') });
    // stage の version は非表示の列
    expect(goToLocationText(store, 'stage / version / 1')).toContain('非表示');
    expect(goToLocationText(store, 'nothing')).toContain('nothing');
  });

  it('検索欄の開閉と検索語', async () => {
    const store = await openSampleStore();
    const bar = findBar(store);
    expect(bar.getState().open).toBe(false);
    store.run('find.open');
    expect(bar.getState()).toMatchObject({ open: true, focusSeq: 1 });
    bar.setQuery('abc');
    store.run('find.replace');
    expect(bar.getState().open).toBe(false);
    expect(store.getState().dialogs.at(-1)).toMatchObject({ id: 'find.replace', args: { query: 'abc' } });
  });
});
