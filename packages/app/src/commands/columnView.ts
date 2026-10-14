// 列の固定・非表示（FR-COL-07、08）。表示設定のパッチとして当てるので、元に戻せる（FR-HIS-01）
import { setColumnsHidden, setFrozenColumns } from '@sheetcraft/core';
import type { AppStore } from '../store/AppStore';
import { gridReady } from './helpers';
import type { CommandDef } from './registry';
import { columnTarget } from './sortFilter';

/** 非表示にする列: 引数の列が選択範囲の中なら選択範囲の列、そうでなければ引数の列（省略時は選択範囲の列） */
function columnsToHide(store: AppStore, args?: unknown): { uid: number; columns: string[] } | null {
  const uid = store.getState().activeTable;
  const sheet = store.sheet(uid);
  if (uid === null || sheet === null || sheet.size.cols === 0) return null;
  const range = store.view(uid).selection.ranges[0];
  const selected = sheet.columns.slice(range.left, range.right + 1).map((c) => c.name);
  const column = (args as { column?: string } | undefined)?.column;
  if (column === undefined || selected.includes(column)) return { uid, columns: selected };
  return sheet.colOf(column) >= 0 ? { uid, columns: [column] } : null;
}

function frozenCount(store: AppStore): number {
  return store.table()?.view.frozen_columns ?? 0;
}

export const columnViewCommands: CommandDef[] = [
  {
    // この列（共通列を含む全列の中の位置）までを固定する
    id: 'column.freeze',
    labelKey: 'ui.colView.freeze',
    menu: { menu: 'view', group: 10, order: 0 },
    enabled: (store) => gridReady(store) && columnTarget(store) !== null,
    run: (store, args) => {
      const t = columnTarget(store, args);
      const project = store.project;
      const sheet = t === null ? null : store.sheet(t.uid);
      if (t === null || project === null || sheet === null) return;
      const index = sheet.allColumns.findIndex((f) => f.name === t.column);
      if (index >= 0) store.applyOrReport(setFrozenColumns(project, { table: t.uid, count: index + 1 }));
    },
  },
  {
    id: 'column.unfreeze',
    labelKey: 'ui.colView.unfreeze',
    menu: { menu: 'view', group: 10, order: 1 },
    enabled: (store) => gridReady(store) && frozenCount(store) > 0,
    run: (store) => {
      const project = store.project;
      const uid = store.getState().activeTable;
      if (project !== null && uid !== null) store.applyOrReport(setFrozenColumns(project, { table: uid, count: 0 }));
    },
  },
  {
    id: 'column.hide',
    labelKey: 'ui.colView.hide',
    label: (store) => store.t('ui.colView.hideCount', { count: columnsToHide(store)?.columns.length ?? 1 }),
    shortcut: 'hideColumns',
    menu: { menu: 'view', group: 10, order: 2 },
    enabled: (store) => gridReady(store) && columnsToHide(store) !== null,
    run: (store, args) => {
      const t = columnsToHide(store, args);
      const project = store.project;
      const sheet = store.sheet();
      if (t === null || project === null || sheet === null) return;
      // すべての列を隠すと、グリッドに何も出せなくなる
      if (t.columns.length >= sheet.columns.length) {
        store.showStatus(store.t('ui.colView.cannotHideAll'), 'error');
        return;
      }
      store.applyOrReport(setColumnsHidden(project, { table: t.uid, columns: t.columns, hidden: true }));
    },
  },
  {
    // 非表示の列をすべて表示する（args に { columns } を渡せば、その列だけ）
    id: 'column.showHidden',
    labelKey: 'ui.colView.showHidden',
    menu: { menu: 'view', group: 10, order: 3 },
    enabled: (store) => gridReady(store) && (store.table()?.view.hidden_columns?.length ?? 0) > 0,
    run: (store, args) => {
      const table = store.table();
      const project = store.project;
      if (table === undefined || project === null) return;
      const columns = (args as { columns?: string[] } | undefined)?.columns ?? [...(table.view.hidden_columns ?? [])];
      if (columns.length > 0) store.applyOrReport(setColumnsHidden(project, { table: table.uid, columns, hidden: false }));
    },
  },
];
