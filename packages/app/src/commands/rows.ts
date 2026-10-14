// 行の挿入・削除（FR-ROW-01〜02）。挿入メニューと、後の段階の右クリックメニューから呼ぶ
import { deleteRows, extendTo, insertRows, selectCell } from '@sheetcraft/core';
import type { AppStore } from '../store/AppStore';
import { gridReady, selectionTarget } from './helpers';
import type { CommandDef } from './registry';

/** 行の無いテーブルにも挿入できる（基準の行が無ければ末尾に足す） */
const canInsert = gridReady;

/** 選択範囲の行の数だけ、上（下）に行を挿入する。args に { count } を渡せば、その数 */
function insert(store: AppStore, position: 'above' | 'below', args?: unknown): void {
  const project = store.project;
  const sheet = store.sheet();
  if (project === null || sheet === null) return;
  const t = selectionTarget(store);
  const requested = (args as { count?: number } | undefined)?.count;
  const count = requested ?? (t === null ? 1 : t.records.length);
  // 表示上の先頭（下なら末尾）の行を基準にする。行が無ければ末尾に足す
  const anchor = t === null ? null : position === 'above' ? t.records[0] : t.records[t.records.length - 1];
  const r = store.applyOrReport(insertRows(project, { table: sheet.table.uid, anchor: anchor ?? null, position, count }));
  if (!r.ok) return;
  const after = store.sheet();
  const rows = (r.tx.focus?.records ?? []).map((uid) => after?.rowOf(uid) ?? -1).filter((x) => x >= 0);
  if (after === null || rows.length === 0) return;
  const col = store.selection()?.anchor.col ?? 0;
  const start = selectCell({ row: Math.min(...rows), col }, after.size);
  store.setSelection(extendTo(start, { row: Math.max(...rows), col }, after.size), { reveal: true });
}

export const rowCommands: CommandDef[] = [
  {
    id: 'row.insertAbove',
    labelKey: 'ui.command.insertRowsAbove',
    label: (store) => store.t('ui.command.insertRowsAbove', { count: selectionTarget(store)?.records.length ?? 1 }),
    menu: { menu: 'insert', group: 0, order: 0 },
    enabled: canInsert,
    run: (store, args) => insert(store, 'above', args),
  },
  {
    id: 'row.insertBelow',
    labelKey: 'ui.command.insertRowsBelow',
    label: (store) => store.t('ui.command.insertRowsBelow', { count: selectionTarget(store)?.records.length ?? 1 }),
    menu: { menu: 'insert', group: 0, order: 1 },
    enabled: canInsert,
    run: (store, args) => insert(store, 'below', args),
  },
  {
    id: 'row.delete',
    labelKey: 'ui.command.deleteRows',
    label: (store) => store.t('ui.command.deleteRows', { count: selectionTarget(store)?.records.length ?? 1 }),
    menu: { menu: 'edit', group: 40, order: 0 },
    enabled: (store) => selectionTarget(store) !== null && store.getState().editing === null,
    run: (store) => {
      const t = selectionTarget(store);
      const project = store.project;
      if (t === null || project === null) return;
      store.applyOrReport(deleteRows(project, { table: t.table.uid, records: t.records }));
    },
  },
];
