// 並べ替えとフィルタ（FR-SRT-01〜06）: 表示だけの並べ替え（ファイルには保存しない）・並べ替えの適用（元に戻せる）・
// 列ごとのフィルタ・エラーと警告のある行だけの表示。条件から並びを作る処理は sheet/sortFilter.ts（version 列は semver で比べる）
import type { FilterCondition, SortDirection } from '@masterdata-maker/core';
import { applySortOrder } from '@masterdata-maker/core';
import { FilterIcon } from '../components/gridIcons';
import { columnHeaderRect, gridAnchorRect } from '../grid/domAnchors';
import type { AppStore } from '../store/AppStore';
import { gridReady } from './helpers';
import type { CommandDef } from './registry';

/** 操作の引数（右クリックメニューなどから。省略すれば表示中のテーブルの現在のセルの列） */
export interface ColumnArgs {
  table?: number;
  column?: string;
}

/** 対象のテーブルと列 */
export function columnTarget(store: AppStore, args?: unknown): { uid: number; column: string } | null {
  const a = (args ?? {}) as ColumnArgs;
  const uid = a.table ?? store.getState().activeTable;
  if (uid === null) return null;
  const sheet = store.sheet(uid);
  if (sheet === null) return null;
  if (a.column !== undefined) return sheet.allColumns.some((f) => f.name === a.column) ? { uid, column: a.column } : null;
  const col = sheet.columns[store.view(uid).selection.anchor.col];
  return col === undefined ? null : { uid, column: col.name };
}

/** 表示だけの並べ替えを 1 つの列で行う（direction が null なら解除）。Googleスプレッドシートのフィルタの並べ替えと同じく、前の並べ替えは置き換える */
export function setSort(store: AppStore, uid: number, column: string | null, direction: SortDirection | null): void {
  store.updateView(uid, () => ({ sort: column === null || direction === null ? [] : [{ column, direction }] }));
  store.applySortFilter(uid);
}

/** 列のフィルタの条件を置き換える（null なら外す） */
export function setColumnFilter(store: AppStore, uid: number, column: string, condition: FilterCondition | null): void {
  store.updateView(uid, (v) => ({
    filters: [...v.filters.filter((f) => f.column !== column), ...(condition === null ? [] : [{ column, condition }])],
  }));
  store.applySortFilter(uid);
}

function activeView(store: AppStore) {
  const uid = store.getState().activeTable;
  return uid === null || store.table(uid) === undefined ? null : { uid, view: store.view(uid) };
}

const canSort = (store: AppStore): boolean => gridReady(store) && columnTarget(store) !== null;

function sortCommand(id: string, direction: SortDirection, labelKey: string, order: number): CommandDef {
  return {
    id,
    labelKey,
    menu: { menu: 'data', group: 0, order },
    enabled: canSort,
    checked: (store) => {
      const t = columnTarget(store);
      const s = t === null ? undefined : store.view(t.uid).sort[0];
      return s !== undefined && s.column === t?.column && s.direction === direction;
    },
    run: (store, args) => {
      const t = columnTarget(store, args);
      if (t !== null) setSort(store, t.uid, t.column, direction);
    },
  };
}

/** フィルタの小さな画面を、列ヘッダーの下に開く */
export function openFilter(store: AppStore, args?: unknown): void {
  const t = columnTarget(store, args);
  const sheet = t === null ? null : store.sheet(t.uid);
  if (t === null || sheet === null) return;
  const anchor = columnHeaderRect(sheet.colOf(t.column)) ?? gridAnchorRect();
  if (anchor === null) return;
  store.openDialog('filter', { table: t.uid, column: t.column, anchor });
}

export const sortFilterCommands: CommandDef[] = [
  sortCommand('sort.asc', 'asc', 'ui.sort.asc', 0),
  sortCommand('sort.desc', 'desc', 'ui.sort.desc', 1),
  {
    id: 'sort.clear',
    labelKey: 'ui.sort.clear',
    menu: { menu: 'data', group: 0, order: 2 },
    enabled: (store) => gridReady(store) && (activeView(store)?.view.sort.length ?? 0) > 0,
    run: (store) => {
      const a = activeView(store);
      if (a !== null) setSort(store, a.uid, null, null);
    },
  },
  {
    // 今の並び（表示中の行）でファイル上の順序を書き換える。表示だけの並べ替えは解除する（ファイル上の順がその並びになるため）
    id: 'sort.apply',
    labelKey: 'ui.sort.apply',
    menu: { menu: 'data', group: 0, order: 3 },
    enabled: (store) => gridReady(store) && (activeView(store)?.view.sort.length ?? 0) > 0,
    run: (store) => {
      const a = activeView(store);
      const sheet = store.sheet();
      const project = store.project;
      if (a === null || sheet === null || project === null) return;
      const r = store.applyOrReport(applySortOrder(project, { table: a.uid, order: [...sheet.rowUids] }));
      if (!r.ok) return;
      setSort(store, a.uid, null, null);
      store.showStatus(store.t('ui.sort.applied'));
    },
  },
  {
    id: 'filter.open',
    labelKey: 'ui.filter.open',
    menu: { menu: 'data', group: 10, order: 0 },
    toolbar: { group: 30, order: 0, icon: FilterIcon },
    enabled: canSort,
    run: openFilter,
  },
  {
    id: 'filter.clear',
    labelKey: 'ui.filter.clear',
    menu: { menu: 'data', group: 10, order: 1 },
    enabled: (store) => {
      const v = activeView(store)?.view;
      return gridReady(store) && v !== undefined && (v.filters.length > 0 || v.onlyIssues);
    },
    run: (store) => {
      const a = activeView(store);
      if (a === null) return;
      store.updateView(a.uid, () => ({ filters: [], onlyIssues: false }));
      store.applySortFilter(a.uid);
    },
  },
  {
    id: 'filter.issuesOnly',
    labelKey: 'ui.filter.issuesOnly',
    menu: { menu: 'data', group: 10, order: 2 },
    enabled: gridReady,
    checked: (store) => activeView(store)?.view.onlyIssues === true,
    run: (store) => {
      const a = activeView(store);
      if (a === null) return;
      store.updateView(a.uid, (v) => ({ onlyIssues: !v.onlyIssues }));
      store.applySortFilter(a.uid);
    },
  },
];
