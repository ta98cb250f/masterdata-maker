import { describe, expect, it } from 'vitest';
import { DEFAULT_COLUMN_WIDTH, MemoryProjectFs, RichCell, enterInput, extendTo, resolveShortcut, selectCell, selectColRange, selectRowRange, setColumnWidth } from '@masterdata-maker/core';
import { menuEntriesToItems } from '../components/MenuList';
import { MAX_COLUMN_WIDTH, parseColumnWidth } from '../dialogs/columnResize';
import { downloadSource } from '../fs/download';
import { basicSampleFiles } from '../fs/sample';
import { copySelection, pasteText } from '../grid/clipboard';
import { planFill } from '../grid/dragMath';
import { MIN_COLUMN_WIDTH } from '../grid/layout';
import { contextMenuExtension } from '../grid/extensions/contextMenus';
import { applyFill, autoFillDown, moveRange } from '../grid/extensions/fillHandle';
import { moveDisplayedColumns, moveDisplayedRows } from '../grid/extensions/reorder';
import { refKeys, refNamesText, refTargetOf } from '../sheet/references';
import { AppStore } from '../store/AppStore';
import type { MenuEntry } from '../store/types';
import { allCommands } from './index';
import { setColumnFilter } from './sortFilter';

async function open(files: Record<string, string> = basicSampleFiles()) {
  const store = new AppStore({ commands: allCommands(), platform: 'other', validationDelay: 0 });
  expect(await store.open(downloadSource('basic-yaml', new MemoryProjectFs(files), 'sample', () => undefined))).toBe(true);
  await store.flushValidation();
  const uid = (name: string) => store.tabs().find((t) => t.name === name)?.uid ?? -1;
  const sheet = () => {
    const s = store.sheet();
    if (s === null) throw new Error('no sheet');
    return s;
  };
  const col = (name: string) => sheet().colOf(name);
  /** 表示上の行の実効値 */
  const value = (row: number, column: string) => {
    const record = sheet().recordAt(row);
    return record === undefined ? undefined : store.calc?.getCell(sheet().table, record.uid, column).raw;
  };
  /** 表示中の列の値（上から） */
  const column = (name: string) => sheet().rowUids.map((u) => store.calc?.getCell(sheet().table, u, name).raw);
  /** ファイル上の順の列の値 */
  const fileColumn = (name: string) => sheet().table.records.map((r) => store.calc?.getCell(sheet().table, r.uid, name).raw);
  const select = (top: number, left: number, bottom = top, right = left) => {
    const size = sheet().size;
    store.setSelection(extendTo(selectCell({ row: top, col: left }, size), { row: bottom, col: right }, size));
  };
  return { store, uid, sheet, col, value, column, fileColumn, select };
}

describe('フィル（FR-FIL-01〜03、§5.17 の 4 番）', () => {
  it('1, 2 を下へ 3 セル広げると 3, 4, 5 が入り、1 回で元に戻る', async () => {
    const { store, sheet, col, column, select } = await open();
    const hp = col('hp');
    select(2, hp);
    store.run('row.insertBelow', { count: 2 });
    const project = store.project!;
    const [a, b] = sheet().rowUids;
    store.apply(enterInput(project, { table: sheet().table.uid, cells: [{ record: a, column: 'hp' }], text: '1' }));
    store.apply(enterInput(project, { table: sheet().table.uid, cells: [{ record: b, column: 'hp' }], text: '2' }));
    const source = { top: 0, left: hp, bottom: 1, right: hp };
    const plan = planFill(source, { row: 4, col: hp }, { dx: 0, dy: 50 });
    expect(plan?.direction).toBe('down');
    expect(applyFill(store, sheet().table.uid, source, plan!)).toBe(true);
    expect(column('hp')).toEqual([1, 2, 3, 4, 5]);
    expect(store.selection()?.ranges[0]).toEqual({ top: 0, left: hp, bottom: 4, right: hp });
    store.undo();
    expect(column('hp')).toEqual([1, 2, 650, undefined, undefined]);
  });

  it('上へ・末尾が数字の文字列も進める（stage_01 → stage_00 ではなく上へは減らす）', async () => {
    const { store, sheet, col, column, uid } = await open();
    store.setActiveTable(uid('stage'));
    const name = col('name');
    const source = { top: 1, left: name, bottom: 1, right: name };
    expect(applyFill(store, sheet().table.uid, source, planFill(source, { row: 0, col: name }, { dx: 0, dy: -10 })!)).toBe(true);
    expect(column('name')).toEqual(['stage_01', 'stage_02']);
  });

  it('変換できないセルがあれば全体を取りやめ、失敗の一覧を出す', async () => {
    const { store, sheet, col, value } = await open();
    const name = col('name');
    const source = { top: 0, left: name, bottom: 1, right: name };
    // 文字列を列挙型の列へ広げる
    const plan = planFill(source, { row: 1, col: name + 1 }, { dx: 30, dy: 0 })!;
    expect(plan.direction).toBe('right');
    expect(applyFill(store, sheet().table.uid, source, plan)).toBe(false);
    expect(value(0, 'rarity')).toBe('SSR');
    expect(store.getState().dialogs.at(-1)?.id).toBe('message');
    expect(store.session?.canUndo()).toBe(false);
  });
});

describe('フィルハンドルのダブルクリック', () => {
  it('隣の列にデータが続く行まで下へフィルする', async () => {
    const { store, sheet, col, column } = await open();
    const hp = col('hp');
    expect(autoFillDown(store, sheet().table.uid, { top: 0, left: hp, bottom: 0, right: hp })).toBe(true);
    expect(column('hp')).toEqual([1200, 1200, 1200]);
  });
});

describe('範囲の枠のドラッグによる移動（FR-CLP-06）', () => {
  it('値・セル色・メモを移し、元のセルを空にする。1 回で元に戻る', async () => {
    const { store, sheet, col, value } = await open();
    const hp = col('hp');
    expect(moveRange(store, sheet().table.uid, { top: 1, left: hp, bottom: 1, right: hp }, { top: 2, left: hp, bottom: 2, right: hp })).toBe(true);
    expect(value(1, 'hp')).toBeUndefined();
    expect(value(2, 'hp')).toBe(800);
    const moved = sheet().recordAt(2)?.cells.get('hp');
    expect(moved).toBeInstanceOf(RichCell);
    expect((moved as RichCell).color).toBe('red');
    expect((moved as RichCell).comment).toBe('次回調整予定');
    expect(store.session?.undoLabel()).toBe('ui.moveCells.op');
    expect(store.t(store.session?.undoLabel() ?? '')).toBe('セルの移動');
    store.undo();
    expect(value(1, 'hp')).toBe(800);
    expect(value(2, 'hp')).toBe(650);
  });

  it('編集できない列（id）は動かせず、何も変えない', async () => {
    const { store, sheet, value } = await open();
    expect(moveRange(store, sheet().table.uid, { top: 0, left: 0, bottom: 0, right: 0 }, { top: 2, left: 0, bottom: 2, right: 0 })).toBe(false);
    expect(value(0, 'id')).toBe(1);
  });
});

describe('並べ替え（FR-SRT-01、02、05）', () => {
  it('表示だけの並べ替えはファイル上の順を変えない。適用すると書き換え、元に戻せる', async () => {
    const { store, col, column, fileColumn, select } = await open();
    select(0, col('hp'));
    store.run('sort.asc');
    expect(column('hp')).toEqual([650, 800, 1200]);
    expect(fileColumn('hp')).toEqual([1200, 800, 650]);
    expect(store.isProjectModified()).toBe(false);
    store.run('sort.desc', { column: 'hp' });
    expect(column('hp')).toEqual([1200, 800, 650]);
    store.run('sort.asc', { column: 'hp' });
    store.run('sort.apply');
    expect(fileColumn('hp')).toEqual([650, 800, 1200]);
    expect(store.view(store.getState().activeTable!).sort).toEqual([]);
    expect(column('hp')).toEqual([650, 800, 1200]);
    store.undo();
    expect(fileColumn('hp')).toEqual([1200, 800, 650]);
    store.run('sort.desc', { column: 'name' });
    store.run('sort.clear');
    expect(column('hp')).toEqual([1200, 800, 650]);
  });

  it('version 列はセマンティック バージョニングで並べる（0.1.2 < 0.1.11）', async () => {
    const { store, uid, column } = await open();
    store.setActiveTable(uid('stage'));
    store.run('sort.desc', { column: 'version' });
    expect(column('version')).toEqual(['0.1.11', '0.1.2']);
    store.run('sort.asc', { column: 'version' });
    expect(column('version')).toEqual(['0.1.2', '0.1.11']);
  });
});

describe('フィルタ（FR-SRT-03、04、06）', () => {
  it('値の一覧・条件で絞り込み、解除できる', async () => {
    const { store, column } = await open();
    const table = store.getState().activeTable!;
    setColumnFilter(store, table, 'rarity', { type: 'values', values: new Set(['SSR', 'R']), includeEmpty: false });
    expect(column('name')).toEqual(['勇者アルス', '盗賊カイ']);
    setColumnFilter(store, table, 'hp', { type: 'range', min: 700 });
    expect(column('name')).toEqual(['勇者アルス']);
    setColumnFilter(store, table, 'hp', null);
    setColumnFilter(store, table, 'rarity', { type: 'contains', value: 's' });
    expect(column('name')).toEqual(['勇者アルス', '魔法使いリナ']);
    store.run('filter.clear');
    expect(column('name')).toHaveLength(3);
  });

  it('フィルタ中のコピー・貼り付け・フィル・値の消去・行の削除は、表示中の行だけを対象にする（FR-SRT-04）', async () => {
    const { store, col, column, fileColumn, select, sheet } = await open();
    const table = store.getState().activeTable!;
    const hp = col('hp');
    setColumnFilter(store, table, 'rarity', { type: 'values', values: new Set(['SSR', 'R']), includeEmpty: false });
    select(0, hp, 1, hp);
    expect(copySelection(store, false)?.tsv).toBe('1200\n650');
    select(0, hp);
    expect(pasteText(store, '10\n20', false)).toBe(true);
    expect(fileColumn('hp')).toEqual([10, 800, 20]);
    const source = { top: 0, left: hp, bottom: 0, right: hp };
    applyFill(store, table, source, planFill(source, { row: 1, col: hp }, { dx: 0, dy: 5 })!);
    expect(fileColumn('hp')).toEqual([10, 800, 10]);
    select(0, hp, 1, hp);
    store.run('edit.clear');
    expect(fileColumn('hp')).toEqual([undefined, 800, undefined]);
    store.setSelection(selectRowRange(0, 1, sheet().size));
    store.run('row.delete');
    expect(fileColumn('name')).toEqual(['魔法使いリナ']);
    expect(column('name')).toEqual([]);
  });

  it('エラー・警告のある行だけに絞り込む（FR-SRT-06）', async () => {
    const { store, column, sheet } = await open();
    // 2 行目の hp を警告の上限（warn_above: 5000）より大きくする
    store.apply(enterInput(store.project!, { table: sheet().table.uid, cells: [{ record: sheet().rowUids[1], column: 'hp' }], text: '6000' }));
    await store.flushValidation();
    store.run('filter.issuesOnly');
    expect(store.commands.get('filter.issuesOnly')?.checked?.(store)).toBe(true);
    expect(column('name')).toEqual(['魔法使いリナ']);
    store.run('filter.issuesOnly');
    expect(column('name')).toHaveLength(3);
  });
});

describe('行・列のドラッグによる並べ替え（FR-ROW-04、FR-COL-05）', () => {
  it('行を移すとファイル上の順序も変わり、移した行を選ぶ', async () => {
    const { store, fileColumn } = await open();
    const table = store.getState().activeTable!;
    expect(moveDisplayedRows(store, table, 2, 2, 0)).toBe(true);
    expect(fileColumn('name')).toEqual(['盗賊カイ', '勇者アルス', '魔法使いリナ']);
    expect(store.selection()?.kind).toBe('rows');
    expect(store.selection()?.ranges[0].top).toBe(0);
    expect(moveDisplayedRows(store, table, 0, 1, 3)).toBe(true);
    expect(fileColumn('name')).toEqual(['魔法使いリナ', '盗賊カイ', '勇者アルス']);
    store.undo();
    store.undo();
    expect(fileColumn('name')).toEqual(['勇者アルス', '魔法使いリナ', '盗賊カイ']);
  });

  it('表示だけの並べ替えの間は行を移さない', async () => {
    const { store, fileColumn } = await open();
    const table = store.getState().activeTable!;
    store.run('sort.asc', { column: 'hp' });
    expect(moveDisplayedRows(store, table, 2, 2, 0)).toBe(false);
    expect(fileColumn('name')).toEqual(['勇者アルス', '魔法使いリナ', '盗賊カイ']);
  });

  it('列を移すと列定義の順序が変わる。共通列は動かせない', async () => {
    const { store, sheet, col } = await open();
    const table = store.getState().activeTable!;
    const hp = col('hp');
    expect(moveDisplayedColumns(store, table, hp, hp, col('name'))).toBe(true);
    expect(sheet().table.fields.map((f) => f.name).slice(0, 3)).toEqual(['hp', 'name', 'rarity']);
    expect(store.selection()?.kind).toBe('cols');
    expect(moveDisplayedColumns(store, table, 0, 0, 4)).toBe(false);
    expect(store.getState().status?.text).toContain('共通列');
    store.undo();
    expect(sheet().table.fields.map((f) => f.name).slice(0, 3)).toEqual(['name', 'rarity', 'hp']);
  });
});

describe('行・列の移動のメニュー（キーだけでの操作。NFR-40）', () => {
  it('行を上・下へ、列を左・右へ移す。共通列やテーブルの列の先頭より前へは動かせない', async () => {
    const { store, sheet, col, fileColumn, select } = await open();
    select(0, col('name'));
    expect(store.isEnabled('row.moveUp')).toBe(false);
    store.run('row.moveDown');
    expect(fileColumn('name')).toEqual(['魔法使いリナ', '勇者アルス', '盗賊カイ']);
    store.run('row.moveDown');
    expect(fileColumn('name')).toEqual(['魔法使いリナ', '盗賊カイ', '勇者アルス']);
    expect(store.isEnabled('row.moveDown')).toBe(false);
    store.run('row.moveUp');
    expect(fileColumn('name')).toEqual(['魔法使いリナ', '勇者アルス', '盗賊カイ']);
    select(0, col('name'));
    expect(store.isEnabled('column.moveLeft')).toBe(false);
    select(0, 0);
    expect(store.isEnabled('column.moveRight')).toBe(false);
    select(0, col('hp'));
    store.run('column.moveLeft');
    expect(sheet().table.fields.map((f) => f.name).slice(0, 3)).toEqual(['name', 'hp', 'rarity']);
    store.run('column.moveRight');
    expect(sheet().table.fields.map((f) => f.name).slice(0, 3)).toEqual(['name', 'rarity', 'hp']);
  });
});

describe('列の固定・非表示（FR-COL-07、08）と行の複製（FR-ROW-03）', () => {
  it('この列までを固定・固定を解除・非表示・非表示の列を表示。どれも元に戻せる', async () => {
    const { store, sheet, col } = await open();
    expect(sheet().table.view.frozen_columns).toBe(2);
    store.run('column.freeze', { column: 'rarity' });
    expect(sheet().table.view.frozen_columns).toBe(4);
    expect(sheet().frozenCount).toBe(4);
    store.run('column.unfreeze');
    expect(sheet().table.view.frozen_columns).toBeUndefined();
    store.undo();
    expect(sheet().table.view.frozen_columns).toBe(4);
    store.setSelection(selectColRange(col('hp'), col('defense'), sheet().size));
    expect(store.commandLabel('column.hide')).toBe('2 列を非表示');
    store.run('column.hide');
    expect(sheet().table.view.hidden_columns).toEqual(['hp', 'defense']);
    expect(col('hp')).toBe(-1);
    store.run('column.showHidden');
    expect(sheet().table.view.hidden_columns).toBeUndefined();
    store.undo();
    expect(col('hp')).toBe(-1);
  });

  it('行を複製すると主キーを採番し直し、複製した行を選ぶ', async () => {
    const { store, sheet, column, select } = await open();
    select(0, 2);
    store.run('row.duplicate');
    expect(column('name')).toEqual(['勇者アルス', '勇者アルス', '魔法使いリナ', '盗賊カイ']);
    expect(column('id')).toEqual([1, 4, 2, 3]);
    expect(store.selection()?.kind).toBe('rows');
    expect(store.selection()?.ranges[0].top).toBe(1);
    store.undo();
    expect(sheet().size.rows).toBe(3);
  });
});

describe('列のサイズを変更（FR-COL-06 をキーだけで。NFR-40）', () => {
  it('選んだ列を対象にダイアログを開く。右クリックした列が選択の外なら、その列だけ。列ヘッダーの右クリックと表示メニューに載る', async () => {
    const { store, sheet, col } = await open();
    const table = store.getState().activeTable!;
    const lastArgs = () => store.getState().dialogs.at(-1);
    store.setSelection(selectColRange(col('name'), col('hp'), sheet().size));
    store.run('column.resize');
    expect(lastArgs()).toMatchObject({ id: 'column.resize', args: { uid: table, columns: ['name', 'rarity', 'hp'] } });
    store.closeDialog();
    store.run('column.resize', { column: 'rarity' });
    expect(lastArgs()?.args).toMatchObject({ columns: ['name', 'rarity', 'hp'] });
    store.closeDialog();
    store.run('column.resize', { column: 'defense' });
    expect(lastArgs()?.args).toMatchObject({ columns: ['defense'] });
    store.closeDialog();

    const colItems = contextMenuExtension.contextMenu?.({ area: 'columnHeader', table, col: col('hp'), column: 'hp', clientX: 0, clientY: 0 }, store) ?? [];
    expect(colItems.flatMap((e) => (e.kind === 'command' ? [e.command] : []))).toContain('column.resize');
    expect(store.commands.menuGroups('view').flat().map((d) => d.id)).toContain('column.resize');
    expect(store.commandLabel('column.resize')).toBe('列のサイズを変更');
  });

  it('複数の列に同じ幅を当て、1 回で元に戻る。既定の幅（100）に戻すと view から消える', async () => {
    const { store, sheet } = await open();
    const table = store.getState().activeTable!;
    const widths = () => sheet().columns.filter((c) => ['name', 'rarity', 'hp'].includes(c.name)).map((c) => c.width);
    expect(widths()).toEqual([160, 100, 80]);
    store.applyOrReport(setColumnWidth(store.project!, { table, columns: ['name', 'rarity', 'hp'], width: 120 }));
    expect(widths()).toEqual([120, 120, 120]);
    store.undo();
    expect(widths()).toEqual([160, 100, 80]);
    store.applyOrReport(setColumnWidth(store.project!, { table, columns: ['name', 'hp'], width: DEFAULT_COLUMN_WIDTH }));
    expect(sheet().table.view.column_widths.map(([name]) => name)).not.toContain('name');
    expect(sheet().table.view.column_widths.map(([name]) => name)).not.toContain('hp');
  });

  it('幅の入力の解釈（全角の数字も受け付ける。整数でない・範囲の外は受け付けない）', () => {
    expect(parseColumnWidth('160')).toBe(160);
    expect(parseColumnWidth(' １６０ ')).toBe(160);
    expect(parseColumnWidth(String(MIN_COLUMN_WIDTH))).toBe(MIN_COLUMN_WIDTH);
    expect(parseColumnWidth(String(MAX_COLUMN_WIDTH))).toBe(MAX_COLUMN_WIDTH);
    for (const bad of ['', 'abc', '12.5', '-50', String(MIN_COLUMN_WIDTH - 1), String(MAX_COLUMN_WIDTH + 1)]) expect(parseColumnWidth(bad), bad).toBeNull();
  });
});

describe('セル色とメモ（FR-ANN-01、02）', () => {
  it('セル色を範囲にまとめて当てる・解除する（1 回の操作）', async () => {
    const { store, sheet, col, select } = await open();
    select(0, col('name'), 2, col('rarity'));
    store.run('cell.color', 'blue');
    const colorOf = (row: number, name: string) => {
      const c = sheet().recordAt(row)?.cells.get(name);
      return c instanceof RichCell ? c.color : undefined;
    };
    expect(colorOf(0, 'name')).toBe('blue');
    expect(colorOf(2, 'rarity')).toBe('blue');
    // 値は変わらない
    expect(sheet().recordAt(0)?.cells.get('name')).toMatchObject({ value: '勇者アルス' });
    store.run('cell.color', null);
    expect(colorOf(1, 'name')).toBeUndefined();
    store.undo();
    store.undo();
    expect(colorOf(0, 'name')).toBeUndefined();
    expect(store.session?.canUndo()).toBe(false);
  });

  it('メモの操作の名前は、メモの有無で変わる。右クリックの「メモを削除」で消せる', async () => {
    const { store, sheet, col, select } = await open();
    select(1, col('hp'));
    expect(store.commandLabel('cell.comment')).toBe('メモを編集');
    store.run('cell.comment', { remove: true });
    const cell = sheet().recordAt(1)?.cells.get('hp');
    expect(cell instanceof RichCell ? cell.comment : undefined).toBeUndefined();
    expect(store.commandLabel('cell.comment')).toBe('メモを挿入');
  });
});

describe('参照（FR-ANN-05、FR-REF-01）', () => {
  it('参照列のセルに参照先の名前を添える', async () => {
    const { store, sheet } = await open();
    const calc = store.calc!;
    const field = sheet().allColumns.find((f) => f.name === 'skill_ids')!;
    const target = refTargetOf(calc, field)!;
    expect(target.table.name).toBe('skill');
    expect(target.nameColumn?.name).toBe('name');
    const keys = refKeys(calc.getCell(sheet().table, sheet().rowUids[1], 'skill_ids'));
    expect(refNamesText(calc, target, keys, 0)).toBe('ファイア, ヒール');
  });

  it('参照先へ移動する（テーブルを切り替え、レコードを選ぶ）', async () => {
    const { store, uid, sheet, col, select, value } = await open();
    store.setActiveTable(uid('stage'));
    select(0, col('boss_id'));
    expect(store.isEnabled('cell.gotoRef')).toBe(true);
    store.run('cell.gotoRef');
    expect(store.getState().activeTable).toBe(uid('character'));
    const sel = store.selection()!;
    expect(value(sel.anchor.row, 'name')).toBe('盗賊カイ');
    expect(sheet().columns[sel.anchor.col].name).toBe('id');
    // リストの 2 番目のキー
    select(0, col('skill_ids'));
    store.run('cell.gotoRef', { index: 1 });
    expect(store.table()?.name).toBe('skill');
    expect(value(store.selection()!.anchor.row, 'name')).toBe('ウィンド');
  });

  it('参照列でないセルでは使えない', async () => {
    const { store, col, select } = await open();
    select(0, col('name'));
    expect(store.isEnabled('cell.gotoRef')).toBe(false);
  });
});

describe('右クリックメニュー（FR-CTX-01）', () => {
  it('セル・行番号・列ヘッダーの項目。登録されていない操作の項目は無効になる', async () => {
    const { store, sheet, col, select } = await open();
    const table = store.getState().activeTable!;
    select(0, col('skill_ids'));
    const cell = contextMenuExtension.contextMenu?.({ area: 'cell', table, row: 0, col: col('skill_ids'), clientX: 10, clientY: 10 }, store) ?? [];
    // セル色はサブメニュー（色ごとの項目）
    const commandIds = (entries: readonly MenuEntry[]): string[] =>
      entries.flatMap((e) => (e.kind === 'command' ? [e.command] : e.kind === 'submenu' ? commandIds(e.items) : []));
    const ids = commandIds(cell);
    expect(ids).toEqual(
      expect.arrayContaining(['edit.cut', 'edit.copy', 'edit.paste', 'edit.pasteValues', 'row.insertAbove', 'row.insertBelow', 'row.delete', 'cell.color', 'cell.comment', 'edit.clear', 'cell.gotoRef']),
    );
    // 参照先が 2 つあれば 2 項目
    const labels = menuEntriesToItems(store, cell).flatMap((i) => (i.kind === 'item' ? [i.label] : []));
    expect(labels).toContain('参照先へ移動: 1: ファイア');
    expect(labels).toContain('参照先へ移動: 3: ウィンド');

    const rowItems = contextMenuExtension.contextMenu?.({ area: 'rowHeader', table, row: 0, clientX: 0, clientY: 0 }, store) ?? [];
    expect(rowItems.flatMap((e) => (e.kind === 'command' ? [e.command] : []))).toEqual(['row.insertAbove', 'row.insertBelow', 'row.duplicate', 'row.delete']);

    const colItems = contextMenuExtension.contextMenu?.({ area: 'columnHeader', table, col: col('hp'), column: 'hp', clientX: 0, clientY: 0 }, store) ?? [];
    const colIds = colItems.flatMap((e) => (e.kind === 'command' ? [e.command] : []));
    expect(colIds).toEqual(
      expect.arrayContaining(['column.settings', 'column.insertLeft', 'column.insertRight', 'column.delete', 'column.freeze', 'column.unfreeze', 'column.hide', 'sort.asc', 'sort.desc', 'filter.open']),
    );
    const items = menuEntriesToItems(store, colItems);
    for (const item of items) {
      if (item.kind !== 'item') continue;
      const id = item.testId?.replace(/^menu-/, '') ?? '';
      if (!store.commands.has(id)) {
        expect(item.disabled, id).toBe(true);
        expect(item.label, id).not.toBe(id);
      }
    }
    expect(sheet().size.rows).toBe(3);
  });

  it('Shift+F10 と ContextMenu キーで、キーだけで右クリックメニューを開ける（NFR-40）', async () => {
    const { store } = await open();
    const key = (k: string, shift = false) => ({ key: k, code: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: shift });
    expect(resolveShortcut(key('F10', true), 'other')).toBe('contextMenu');
    expect(resolveShortcut(key('ContextMenu'), 'other')).toBe('contextMenu');
    expect(store.commands.byShortcut('contextMenu')?.id).toBe('grid.contextMenu');
    expect(store.commands.byShortcut('insertNote')?.id).toBe('cell.comment');
    expect(store.commands.byShortcut('hideColumns')?.id).toBe('column.hide');
  });
});
