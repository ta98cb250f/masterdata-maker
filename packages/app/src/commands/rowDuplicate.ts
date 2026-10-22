// 行の複製（FR-ROW-03）。主キーと自動採番の列は採番し直し、複製した行を選ぶ
import { duplicateRows, selectRowRange } from '@masterdata-maker/core';
import type { AppStore } from '../store/AppStore';
import { selectionTarget } from './helpers';
import type { CommandDef } from './registry';

function duplicate(store: AppStore): void {
  const t = selectionTarget(store);
  const project = store.project;
  if (t === null || project === null) return;
  const r = store.applyOrReport(duplicateRows(project, { table: t.table.uid, records: t.records }));
  if (!r.ok) return;
  const after = store.sheet();
  const rows = (r.tx.focus?.records ?? []).map((uid) => after?.rowOf(uid) ?? -1).filter((x) => x >= 0);
  if (after === null || rows.length === 0) return;
  store.setSelection(selectRowRange(Math.min(...rows), Math.max(...rows), after.size), { reveal: true });
}

export const rowDuplicateCommands: CommandDef[] = [
  {
    id: 'row.duplicate',
    labelKey: 'ui.rowDup.command',
    label: (store) => store.t('ui.rowDup.command', { count: selectionTarget(store)?.records.length ?? 1 }),
    menu: { menu: 'edit', group: 40, order: 1 },
    enabled: (store) => selectionTarget(store) !== null && store.getState().editing === null,
    run: duplicate,
  },
];
