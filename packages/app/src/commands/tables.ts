// テーブル（シート）の管理（FR-TBL-01〜02）: 新規作成・名前の変更・複製・削除。
// シートタブの右クリックメニューからは args に { table } を渡す。args が無ければ表示中のテーブル
import { duplicateTable, formatInputError, suggestTableName } from '@masterdata-maker/core';
import type { AppStore } from '../store/AppStore';
import type { CommandDef } from './registry';

function tableArg(store: AppStore, args: unknown): number | null {
  const table = typeof args === 'object' && args !== null ? (args as { table?: number }).table : undefined;
  return table ?? store.getState().activeTable;
}

/** 編集できるテーブル（読み込みエラーのテーブルは名前の変更・複製・削除もできない。P-40） */
function editableTable(store: AppStore, args: unknown): number | null {
  const uid = tableArg(store, args);
  if (uid === null) return null;
  if (store.table(uid) !== undefined) return uid;
  const entry = store.entry(uid);
  store.showStatus(store.t('edit.error.tableBroken', { table: entry?.name ?? '' }), 'error');
  return null;
}

const hasTables = (store: AppStore): boolean => store.project !== null && store.project.tables.length > 0 && store.getState().editing === null;

/** テーブルを複製して、複製したテーブルを表示する（Googleスプレッドシートと同じく、名前は自動で付ける） */
export function duplicateAndShow(store: AppStore, uid: number): boolean {
  const project = store.project;
  const table = store.table(uid);
  if (project === null || table === undefined) return false;
  const name = suggestTableName(project, table.name);
  const display = table.display_name === undefined ? undefined : store.t('ui.table.copyOf', { name: table.display_name });
  const r = store.apply(duplicateTable(project, { table: uid, name, display_name: display }));
  if (!r.ok) {
    store.showStatus(r.failures.map((f) => formatInputError(f, store.getState().locale)).join(' / '), 'error');
    return false;
  }
  store.setActiveTable(r.tx.tables[0]);
  return true;
}

export const tableCommands: CommandDef[] = [
  {
    id: 'table.create',
    labelKey: 'ui.command.newSheet',
    menu: { menu: 'insert', group: 20, order: 0 },
    enabled: (store) => store.project !== null && store.getState().editing === null,
    run: (store) => {
      store.openDialog('table.form', { mode: 'create' });
    },
  },
  {
    id: 'table.rename',
    labelKey: 'ui.command.renameSheet',
    menu: { menu: 'edit', group: 70, order: 0 },
    enabled: hasTables,
    run: (store, args) => {
      const uid = editableTable(store, args);
      if (uid !== null) store.openDialog('table.form', { mode: 'rename', table: uid });
    },
  },
  {
    id: 'table.duplicate',
    labelKey: 'ui.command.duplicateSheet',
    menu: { menu: 'edit', group: 70, order: 1 },
    enabled: hasTables,
    run: (store, args) => {
      const uid = editableTable(store, args);
      if (uid !== null) duplicateAndShow(store, uid);
    },
  },
  {
    id: 'table.delete',
    labelKey: 'ui.command.deleteSheet',
    menu: { menu: 'edit', group: 70, order: 2 },
    enabled: hasTables,
    run: (store, args) => {
      const uid = editableTable(store, args);
      if (uid !== null) store.openDialog('table.delete', { table: uid });
    },
  },
];
