// 列の操作: 列の設定（FR-COL-02〜04）、左・右に挿入、削除（FR-COL-01）。
// 列ヘッダーの右クリックメニューからは args に { table, column } を渡す。args が無ければ選択中の列
import { deleteColumns } from '@sheetcraft/core';
import { columnTarget } from '../dialogs/columnSettings';
import type { AppStore } from '../store/AppStore';
import { gridReady } from './helpers';
import type { CommandDef } from './registry';

interface ColumnArgs {
  table?: number;
  column?: string;
}

function argsOf(args: unknown): ColumnArgs | undefined {
  return typeof args === 'object' && args !== null ? (args as ColumnArgs) : undefined;
}

function hasColumn(store: AppStore): boolean {
  return gridReady(store) && columnTarget(store) !== null;
}

/**
 * 削除する列。列全体（または範囲）を選んでいて、その中の列を指したなら選んだ列すべて（Googleスプレッドシートと同じ）。
 * 共通列は消せないので base に分ける
 */
export function columnsToDelete(store: AppStore, rawArgs?: unknown): { table: number; columns: string[]; base: string[] } | null {
  const args = argsOf(rawArgs);
  const target = columnTarget(store, args);
  if (target === null) return null;
  const sheet = store.sheet(target.table.uid);
  const sel = store.selection(target.table.uid);
  let names = [target.column];
  if (sheet !== null && sel !== null) {
    const range = sel.ranges[0];
    const inRange = sheet.columns.slice(range.left, range.right + 1).map((c) => c.name);
    if (args?.column === undefined || inRange.includes(args.column)) names = inRange;
  }
  const own = new Set(target.table.fields.map((f) => f.name));
  return { table: target.table.uid, columns: names.filter((n) => own.has(n)), base: names.filter((n) => !own.has(n)) };
}

function openInsert(store: AppStore, side: 'left' | 'right', rawArgs: unknown): void {
  const target = columnTarget(store, argsOf(rawArgs));
  if (target === null) return;
  store.openDialog('column.insert', { table: target.table.uid, column: target.column, side });
}

export const columnCommands: CommandDef[] = [
  {
    id: 'column.settings',
    labelKey: 'ui.command.columnSettings',
    menu: { menu: 'data', group: 60, order: 0 },
    enabled: hasColumn,
    run: (store, args) => {
      const target = columnTarget(store, argsOf(args));
      if (target !== null) store.openDialog('column.settings', { table: target.table.uid, column: target.column });
    },
  },
  {
    id: 'column.insertLeft',
    labelKey: 'ui.command.insertColumnLeft',
    menu: { menu: 'insert', group: 10, order: 0 },
    enabled: hasColumn,
    run: (store, args) => openInsert(store, 'left', args),
  },
  {
    id: 'column.insertRight',
    labelKey: 'ui.command.insertColumnRight',
    menu: { menu: 'insert', group: 10, order: 1 },
    enabled: hasColumn,
    run: (store, args) => openInsert(store, 'right', args),
  },
  {
    id: 'column.delete',
    labelKey: 'ui.command.deleteColumn',
    label: (store) => {
      const n = columnsToDelete(store)?.columns.length ?? 1;
      return n > 1 ? store.t('ui.command.deleteColumns', { count: n }) : store.t('ui.command.deleteColumn');
    },
    menu: { menu: 'edit', group: 40, order: 10 },
    enabled: hasColumn,
    run: (store, args) => {
      const target = columnsToDelete(store, args);
      const project = store.project;
      if (target === null || project === null) return;
      if (target.columns.length === 0) {
        store.showStatus(store.t('edit.error.columnIsBaseField', { column: target.base[0] ?? '' }), 'error');
        return;
      }
      let message = store.t('ui.column.deleteMessage', { columns: target.columns.join(', '), count: target.columns.length });
      if (target.base.length > 0) message += ` ${store.t('ui.column.deleteSkipsBase', { columns: target.base.join(', ') })}`;
      store.openDialog('confirm', {
        titleKey: target.columns.length > 1 ? 'ui.column.deleteTitleMany' : 'ui.column.deleteTitle',
        message,
        confirmKey: 'ui.column.deleteConfirm',
        danger: true,
        onConfirm: () => {
          const current = store.project;
          if (current !== null) store.applyOrReport(deleteColumns(current, { table: target.table, columns: target.columns }));
        },
      });
    },
  },
];
