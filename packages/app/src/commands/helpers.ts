// 操作で共通に使う処理（選択範囲の行・列など）
import type { Calculator, CellRange, IsEmpty, Selection, Table } from '@masterdata-maker/core';
import type { SheetModel } from '../sheet/model';
import type { AppStore } from '../store/AppStore';

export interface SelectionTarget {
  table: Table;
  sheet: SheetModel;
  calc: Calculator;
  sel: Selection;
  /** 主な範囲（表示上の座標） */
  range: CellRange;
  /** 範囲の行（表示順）のレコードの uid */
  records: number[];
  /** 範囲の列（表示順）の列名 */
  columns: string[];
}

/** 表示中のテーブルの選択範囲。表示中が編集できるテーブルでない・行か列が無ければ null */
export function selectionTarget(store: AppStore): SelectionTarget | null {
  const table = store.table();
  const sheet = store.sheet();
  const sel = store.selection();
  const calc = store.calc;
  if (table === undefined || sheet === null || sel === null || calc === null) return null;
  if (sheet.size.rows === 0 || sheet.size.cols === 0) return null;
  const range = sel.ranges[0];
  const records: number[] = [];
  for (let r = range.top; r <= range.bottom; r++) {
    const uid = sheet.rowUids[r];
    if (uid !== undefined) records.push(uid);
  }
  const columns: string[] = [];
  for (let c = range.left; c <= range.right; c++) {
    const col = sheet.columns[c];
    if (col !== undefined) columns.push(col.name);
  }
  return { table, sheet, calc, sel, range, records, columns };
}

/** グリッド（編集できるテーブル）を表示しているか */
export function hasSheet(store: AppStore): boolean {
  return store.sheet() !== null;
}

/** グリッドを表示していて、編集中でない */
export function gridReady(store: AppStore): boolean {
  return hasSheet(store) && store.getState().editing === null;
}

/** 表示上の (row, col) のセルが空か（Ctrl+矢印のデータの端の判定） */
export function emptyCellTest(store: AppStore): IsEmpty {
  const sheet = store.sheet();
  const calc = store.calc;
  if (sheet === null || calc === null) return () => true;
  return (row, col) => {
    const record = sheet.recordAt(row);
    const column = sheet.columns[col];
    if (record === undefined || column === undefined) return true;
    const r = calc.getCell(sheet.table, record.uid, column.name);
    return r.error === undefined && r.raw === undefined;
  };
}
