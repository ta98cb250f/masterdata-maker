// 行・列の移動をキーとメニューで行う（FR-ROW-04、FR-COL-05、NFR-40。Googleスプレッドシートの「編集 > 移動」と同じ）。
// 選択範囲の行（列）を 1 つ上・下（左・右）へ移す。マウスのドラッグは grid/extensions/reorder.tsx
import { moveDisplayedColumns, moveDisplayedRows } from '../grid/extensions/reorder';
import type { AppStore } from '../store/AppStore';
import { gridReady } from './helpers';
import type { CommandDef } from './registry';

function range(store: AppStore) {
  const uid = store.getState().activeTable;
  const sheet = store.sheet(uid);
  if (uid === null || sheet === null || sheet.size.rows === 0 || sheet.size.cols === 0) return null;
  return { uid, sheet, range: store.view(uid).selection.ranges[0] };
}

/** 共通列を含まず、先頭のテーブルの列より前へは動かせない */
function firstTableColumn(store: AppStore): number {
  return store.sheet()?.columns.findIndex((c) => !c.base) ?? -1;
}

function canMoveColumns(store: AppStore, dir: -1 | 1): boolean {
  const r = range(store);
  if (r === null || !gridReady(store)) return false;
  const first = firstTableColumn(store);
  if (first < 0 || r.range.left < first) return false;
  return dir < 0 ? r.range.left > first : r.range.right < r.sheet.size.cols - 1;
}

export const moveRowsColsCommands: CommandDef[] = [
  {
    id: 'row.moveUp',
    labelKey: 'ui.move.rowUp',
    menu: { menu: 'edit', group: 45, order: 0 },
    enabled: (store) => gridReady(store) && (range(store)?.range.top ?? 0) > 0,
    run: (store) => {
      const r = range(store);
      if (r !== null && r.range.top > 0) moveDisplayedRows(store, r.uid, r.range.top, r.range.bottom, r.range.top - 1);
    },
  },
  {
    id: 'row.moveDown',
    labelKey: 'ui.move.rowDown',
    menu: { menu: 'edit', group: 45, order: 1 },
    enabled: (store) => {
      const r = range(store);
      return gridReady(store) && r !== null && r.range.bottom < r.sheet.size.rows - 1;
    },
    run: (store) => {
      const r = range(store);
      if (r !== null && r.range.bottom < r.sheet.size.rows - 1) moveDisplayedRows(store, r.uid, r.range.top, r.range.bottom, r.range.bottom + 2);
    },
  },
  {
    id: 'column.moveLeft',
    labelKey: 'ui.move.columnLeft',
    menu: { menu: 'edit', group: 45, order: 2 },
    enabled: (store) => canMoveColumns(store, -1),
    run: (store) => {
      const r = range(store);
      if (r !== null && canMoveColumns(store, -1)) moveDisplayedColumns(store, r.uid, r.range.left, r.range.right, r.range.left - 1);
    },
  },
  {
    id: 'column.moveRight',
    labelKey: 'ui.move.columnRight',
    menu: { menu: 'edit', group: 45, order: 3 },
    enabled: (store) => canMoveColumns(store, 1),
    run: (store) => {
      const r = range(store);
      if (r !== null && canMoveColumns(store, 1)) moveDisplayedColumns(store, r.uid, r.range.left, r.range.right, r.range.right + 2);
    },
  },
];
