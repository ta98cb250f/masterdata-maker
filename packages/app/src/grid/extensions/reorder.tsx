// 行・列のドラッグによる並べ替え（FR-ROW-04、FR-COL-05、P-42）。選択済みの行番号・列ヘッダーをつかんでドラッグすると
// 挿入位置の線を示し、離したら moveRows / moveColumns を当てる（ファイル上の順序も変わる）。共通列は動かせない。
// 動かさずに離したら、Googleスプレッドシートと同じく、その行（列）だけを選ぶ
import type { Patch } from '@sheetcraft/core';
import { moveColumns, moveRows, selectColRange, selectRowRange } from '@sheetcraft/core';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { AppStore } from '../../store/AppStore';
import '../../styles/gridDrag.css';
import { colBoundaryAt, dropBoundary, rowBoundaryAt } from '../dragMath';
import { setDragPreview, startPointerDrag, useDragPreview } from '../dragSession';
import type { GridExtension, GridOverlayProps, GridPointerEvent } from '../extensions';

/** ドラッグとみなす動きの大きさ（ピクセル） */
const THRESHOLD = 4;

/** 表示上の行 top〜bottom を、境目 boundary の位置へ移す */
export function moveDisplayedRows(store: AppStore, uid: number, top: number, bottom: number, boundary: number): boolean {
  const project = store.project;
  const sheet = store.sheet(uid);
  if (project === null || sheet === null) return false;
  // 表示だけの並べ替えの間は、ファイル上の順序を変えても表示の並びが変わらない
  if (store.view(uid).sort.length > 0) {
    store.showStatus(store.t('ui.reorder.sorted'), 'error');
    return false;
  }
  const records = sheet.rowUids.slice(top, bottom + 1);
  const before = boundary < sheet.size.rows ? sheet.rowUids[boundary] : null;
  const r = store.applyOrReport(moveRows(project, { table: uid, records, before }));
  if (!r.ok) return false;
  const after = store.sheet(uid);
  const rows = records.map((u) => after?.rowOf(u) ?? -1).filter((x) => x >= 0);
  if (after !== null && rows.length > 0) store.setSelection(selectRowRange(Math.min(...rows), Math.max(...rows), after.size), { reveal: true, table: uid });
  return true;
}

/** 表示上の列 left〜right を、境目 boundary の位置へ移す */
export function moveDisplayedColumns(store: AppStore, uid: number, left: number, right: number, boundary: number): boolean {
  const project = store.project;
  const sheet = store.sheet(uid);
  if (project === null || sheet === null) return false;
  const columns = sheet.columns.slice(left, right + 1);
  if (columns.some((c) => c.base)) {
    store.showStatus(store.t('ui.reorder.baseColumn'), 'error');
    return false;
  }
  const names = columns.map((c) => c.name);
  const before = boundary < sheet.size.cols ? sheet.columns[boundary].name : null;
  const r = store.applyOrReport(moveColumns(project, { table: uid, columns: names, before }));
  if (!r.ok) return false;
  const after = store.sheet(uid);
  const cols = names.map((n) => after?.colOf(n) ?? -1).filter((x) => x >= 0);
  if (after !== null && cols.length > 0) store.setSelection(selectColRange(Math.min(...cols), Math.max(...cols), after.size), { reveal: true, table: uid });
  return true;
}

function startRowDrag(e: GridPointerEvent, top: number, bottom: number, row: number): void {
  const { store, sheet, geometry, scroller } = e;
  const uid = sheet.table.uid;
  const startY = e.y;
  let moved = false;
  let boundary: number | null = null;
  startPointerDrag({
    scroller,
    geometry,
    event: e.event,
    axis: 'y',
    onMove: (p) => {
      if (!moved && Math.abs(p.y - startY) < THRESHOLD) return;
      moved = true;
      boundary = dropBoundary(rowBoundaryAt(geometry, p.y, p.scroll.top), top, bottom);
      setDragPreview({ kind: 'rows', table: uid, boundary });
    },
    onEnd: (_p, commit) => {
      setDragPreview(null);
      if (!commit) return;
      if (!moved) store.setSelection(selectRowRange(row, row, sheet.size));
      else if (boundary !== null) moveDisplayedRows(store, uid, top, bottom, boundary);
    },
  });
}

function startColDrag(e: GridPointerEvent, left: number, right: number, col: number): void {
  const { store, sheet, geometry, scroller } = e;
  const uid = sheet.table.uid;
  const startX = e.x;
  // 共通列（常に先頭）の前には置けない
  const firstTableColumn = Math.max(0, sheet.columns.findIndex((c) => !c.base));
  let moved = false;
  let boundary: number | null = null;
  startPointerDrag({
    scroller,
    geometry,
    event: e.event,
    axis: 'x',
    includeFrozen: true,
    onMove: (p) => {
      if (!moved && Math.abs(p.x - startX) < THRESHOLD) return;
      moved = true;
      boundary = dropBoundary(colBoundaryAt(geometry, p.x, p.scroll.left), left, right, firstTableColumn);
      setDragPreview({ kind: 'cols', table: uid, boundary });
    },
    onEnd: (_p, commit) => {
      setDragPreview(null);
      if (!commit) return;
      if (!moved) store.setSelection(selectColRange(col, col, sheet.size));
      else if (boundary !== null) moveDisplayedColumns(store, uid, left, right, boundary);
    },
  });
}

/**
 * フィルタで絞り込んでいる（並べ替えていない）テーブルの、ファイル上の行の順序が変わったら（行の移動・元に戻す）、
 * 表示中の行をファイル上の順に並べ直す（表示する行は変えない）
 */
function syncFilteredOrder(store: AppStore, patches: readonly Patch[]): void {
  const tables = new Set<number>();
  for (const p of patches) if (p.op === 'setRecordOrder') tables.add(p.table);
  for (const uid of tables) {
    const table = store.table(uid);
    const sheet = store.sheet(uid);
    const view = store.getState().views.get(uid);
    if (table === undefined || sheet === null || view === undefined || view.order === null || view.sort.length > 0) continue;
    const shown = new Set(sheet.rowUids);
    const order = table.records.map((r) => r.uid).filter((u) => shown.has(u));
    store.updateView(uid, () => ({ order, orderKnown: new Set(table.records.map((r) => r.uid)) }));
  }
}

function ReorderOverlay({ store, sheet, geometry, pane }: GridOverlayProps) {
  const preview = useDragPreview();
  const session = store.session;
  useEffect(() => {
    if (pane !== 'body' || session === null) return;
    return session.subscribe((event) => {
      if (event.kind !== 'saved') syncFilteredOrder(store, event.patches);
    });
  }, [store, session, pane]);

  if (preview === null || preview.table !== sheet.table.uid || (preview.kind !== 'rows' && preview.kind !== 'cols') || preview.boundary === null) return null;
  const b = preview.boundary;
  const out: ReactNode[] = [];
  if (preview.kind === 'rows') {
    const top = geometry.rowY(b) - 1;
    const left = pane === 'frozen' ? 0 : geometry.rowHeaderWidth;
    const width = pane === 'frozen' ? geometry.rowHeaderWidth + geometry.frozenWidth : geometry.contentWidth - geometry.rowHeaderWidth;
    out.push(<div key="line" className="sc-drop-line rows" style={{ left, top, width, height: 3 }} data-testid="drop-line" />);
  } else {
    // 固定列の中と境目の線は固定列のペインに、それより右は本体に描く
    const inFrozen = geometry.frozenCount > 0 && b <= geometry.frozenCount;
    if (inFrozen === (pane === 'frozen')) {
      let left = geometry.rowHeaderWidth + geometry.cols.start(b) - 1;
      if (inFrozen && b === geometry.frozenCount) left -= 2;
      out.push(<div key="line" className="sc-drop-line cols" style={{ left, top: 0, width: 3, height: geometry.bodyHeight }} data-testid="drop-line" />);
    }
  }
  return <>{out}</>;
}

export const reorderExtension: GridExtension = {
  id: 'reorder',
  overlay: ReorderOverlay,
  pointerDown(e) {
    const { event, hit, store, sheet } = e;
    if (event.shiftKey || event.ctrlKey || event.metaKey) return false;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-unhide], [data-filter-button]') != null) return false;
    const sel = store.view(sheet.table.uid).selection;
    const range = sel.ranges[0];
    if (hit.area === 'rowHeader' && sel.kind === 'rows' && hit.row >= range.top && hit.row <= range.bottom) {
      startRowDrag(e, range.top, range.bottom, hit.row);
      return true;
    }
    if (hit.area === 'colHeader' && sel.kind === 'cols' && hit.col >= range.left && hit.col <= range.right) {
      startColDrag(e, range.left, range.right, hit.col);
      return true;
    }
    return false;
  },
};
