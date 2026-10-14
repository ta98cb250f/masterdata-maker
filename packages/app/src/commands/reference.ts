// 参照先へ移動（FR-REF-01）: 参照列のセルから、参照先のテーブルのレコードへ移る（右クリックの「参照先へ移動」・Ctrl+クリック）
import type { FValue } from '@sheetcraft/core';
import { selectCell } from '@sheetcraft/core';
import type { RefTarget } from '../sheet/references';
import { findRefRecord, refKeyText, refKeys, refNamesText, refTargetOf } from '../sheet/references';
import type { AppStore } from '../store/AppStore';
import { gridReady } from './helpers';
import type { CommandDef } from './registry';

/** 参照のあるセル（省略時は表示中のテーブルの現在のセル） */
export interface RefCellArgs {
  table?: number;
  record?: number;
  column?: string;
  /** リストの何番目のキーへ移るか（既定は先頭） */
  index?: number;
}

export interface RefCell {
  target: RefTarget;
  keys: FValue[];
}

/** セルの参照先とキー。参照列でない・キーが無ければ null */
export function refCellOf(store: AppStore, args?: RefCellArgs): RefCell | null {
  const calc = store.calc;
  const uid = args?.table ?? store.getState().activeTable;
  const sheet = store.sheet(uid);
  if (calc === null || uid === null || sheet === null || sheet.size.rows === 0) return null;
  let record = args?.record;
  let column = args?.column;
  if (record === undefined || column === undefined) {
    const sel = store.view(uid).selection;
    record = sheet.rowUids[sel.anchor.row];
    column = sheet.columns[sel.anchor.col]?.name;
  }
  const field = sheet.allColumns.find((f) => f.name === column);
  if (record === undefined || column === undefined || field === undefined) return null;
  const target = refTargetOf(calc, field);
  if (target === null) return null;
  const keys = refKeys(calc.getCell(sheet.table, record, column));
  return keys.length === 0 ? null : { target, keys };
}

/** メニューに出す、キーと名前（例: 「1: ファイア」） */
export function refKeyLabel(store: AppStore, cell: RefCell, index: number): string {
  const calc = store.calc;
  const key = cell.keys[index];
  if (calc === null || key === undefined) return '';
  const name = refNamesText(calc, cell.target, [key], store.getState().revision);
  const text = refKeyText(key, calc.timeZone);
  return name === '' ? text : `${text}: ${name}`;
}

/** 参照先のレコードへ移る。見つからなければ知らせて false */
export function gotoReference(store: AppStore, args?: RefCellArgs): boolean {
  const cell = refCellOf(store, args);
  const calc = store.calc;
  if (cell === null || calc === null) return false;
  const key = cell.keys[Math.max(0, Math.min(cell.keys.length - 1, args?.index ?? 0))];
  const { table, column } = cell.target;
  const record = findRefRecord(calc, cell.target, key, store.getState().revision);
  if (record === undefined) {
    store.showStatus(store.t('ui.ref.notFound', { table: table.name, key: refKeyText(key, calc.timeZone) }), 'error');
    return false;
  }
  store.setActiveTable(table.uid);
  if (store.getState().activeTable !== table.uid) return false;
  let sheet = store.sheet(table.uid);
  // フィルタで隠れていれば、フィルタを外して見せる
  if (sheet !== null && sheet.rowOf(record.uid) < 0) {
    store.updateView(table.uid, () => ({ filters: [], onlyIssues: false }));
    store.applySortFilter(table.uid);
    sheet = store.sheet(table.uid);
  }
  const row = sheet?.rowOf(record.uid) ?? -1;
  if (sheet === null || row < 0) return false;
  const col = Math.max(0, sheet.colOf(column.name));
  store.setSelection(selectCell({ row, col }, sheet.size), { reveal: true, table: table.uid });
  store.focusGrid();
  return true;
}

export const referenceCommands: CommandDef[] = [
  {
    id: 'cell.gotoRef',
    labelKey: 'ui.ref.goto',
    enabled: (store) => gridReady(store) && refCellOf(store) !== null,
    run: (store, args) => {
      gotoReference(store, args as RefCellArgs | undefined);
    },
  },
];
