// フィルハンドル（FR-FIL-01〜03）と範囲の枠のドラッグによる移動（FR-CLP-06）。
// フィル: 選択範囲の右下の四角をドラッグし、広げる先の枠を示して、離したら core の fillCells を 1 回の操作として当てる。
// 移動: 選択範囲の枠をつかんでドラッグし、移す先の枠を示して、離したら切り取りと貼り付けを 1 回の操作として当てる。
// どちらも表示中の行だけが対象（フィルタ中は隠れた行を飛ばす。FR-SRT-04）
import type { CellRange, CommandResult, FillArgs } from '@masterdata-maker/core';
import { copyCells, extendTo, fillCells, pasteCells, selectCell } from '@masterdata-maker/core';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { emptyCellTest } from '../../commands/helpers';
import type { AppStore } from '../../store/AppStore';
import '../../styles/gridDrag.css';
import type { FillPlan } from '../dragMath';
import { contentPoint, grabOffset, outsideOffset, planFill, planMove, sameRange } from '../dragMath';
import { setDragPreview, startPointerDrag, useDragPreview } from '../dragSession';
import type { GridExtension, GridOverlayProps, GridPointerEvent } from '../extensions';
import type { Rect } from '../layout';

function rectStyle(r: Rect) {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** 範囲を選ぶ（左上を現在のセルにする） */
function selectRange(store: AppStore, uid: number, range: CellRange): void {
  const sheet = store.sheet(uid);
  if (sheet === null) return;
  const sel = extendTo(selectCell({ row: range.top, col: range.left }, sheet.size), { row: range.bottom, col: range.right }, sheet.size);
  store.setSelection(sel, { reveal: true, table: uid });
}

function rowsOf(store: AppStore, uid: number, top: number, bottom: number): number[] {
  return store.sheet(uid)?.rowUids.slice(top, bottom + 1) ?? [];
}

function columnsOf(store: AppStore, uid: number, left: number, right: number): string[] {
  return store.sheet(uid)?.columns.slice(left, right + 1).map((c) => c.name) ?? [];
}

/** フィルを当てる。1 セルでも変換できなければ全体を取りやめ、失敗の一覧を出す（FR-CLP-04 と同じ） */
export function applyFill(store: AppStore, uid: number, source: CellRange, plan: FillPlan): boolean {
  const project = store.project;
  if (project === null) return false;
  const vertical = plan.direction === 'down' || plan.direction === 'up';
  const args: FillArgs = {
    table: uid,
    source: { rows: rowsOf(store, uid, source.top, source.bottom), columns: columnsOf(store, uid, source.left, source.right) },
    direction: plan.direction,
  };
  if (vertical) args.targetRows = rowsOf(store, uid, plan.target.top, plan.target.bottom);
  else args.targetColumns = columnsOf(store, uid, plan.target.left, plan.target.right);
  const r = store.apply(fillCells(project, args));
  if (!r.ok) {
    store.showFailures('ui.fill.failedTitle', r.failures);
    return false;
  }
  selectRange(store, uid, plan.extended);
  return true;
}

/** 範囲を移す（値・セル単位式・セル色・メモ。切り取りと貼り付けを 1 回の操作にする） */
export function moveRange(store: AppStore, uid: number, source: CellRange, dest: CellRange): boolean {
  const project = store.project;
  if (project === null) return false;
  const clip = copyCells(project, { table: uid, rows: rowsOf(store, uid, source.top, source.bottom), columns: columnsOf(store, uid, source.left, source.right), cut: true });
  if (clip === null) return false;
  const pasted = pasteCells(project, { table: uid, rows: rowsOf(store, uid, dest.top, dest.bottom), columns: columnsOf(store, uid, dest.left, dest.right), clip });
  // 元に戻すの名前は「セルの移動」にする
  const result: CommandResult = pasted.ok ? { ok: true, tx: { ...pasted.tx, label: 'ui.moveCells.op' } } : pasted;
  const r = store.apply(result);
  if (!r.ok) {
    store.showFailures('ui.moveCells.failedTitle', r.failures, (f) => (f.row === undefined ? undefined : dest.top + f.row + 1));
    return false;
  }
  selectRange(store, uid, dest);
  return true;
}

/**
 * フィルハンドルのダブルクリック: 隣の列（左、無ければ右）にデータが続く行まで下へフィルする（Googleスプレッドシートと同じ）。
 * 隣の列のすぐ下が空なら何もしない
 */
export function autoFillDown(store: AppStore, uid: number, source: CellRange): boolean {
  const sheet = store.sheet(uid);
  if (sheet === null || store.getState().activeTable !== uid) return false;
  const isEmpty = emptyCellTest(store);
  for (const col of [source.left - 1, source.right + 1]) {
    if (col < 0 || col >= sheet.size.cols) continue;
    let end = source.bottom;
    while (end + 1 < sheet.size.rows && !isEmpty(end + 1, col)) end++;
    if (end > source.bottom) {
      return applyFill(store, uid, source, { direction: 'down', target: { ...source, top: source.bottom + 1, bottom: end }, extended: { ...source, bottom: end } });
    }
  }
  return false;
}

function viewportOf(scroller: HTMLElement) {
  return { width: scroller.clientWidth, height: scroller.clientHeight };
}

function startFill(e: GridPointerEvent, source: CellRange): void {
  const { store, sheet, geometry, scroller } = e;
  const uid = sheet.table.uid;
  let plan: FillPlan | null = null;
  setDragPreview({ kind: 'fill', table: uid, source, target: null });
  startPointerDrag({
    scroller,
    geometry,
    event: e.event,
    onMove: (p) => {
      const pos = geometry.clampedCellAt(p.x, p.y, p.scroll, viewportOf(scroller));
      plan = planFill(source, pos, outsideOffset(geometry, source, contentPoint(geometry, p.x, p.y, p.scroll)));
      setDragPreview({ kind: 'fill', table: uid, source, target: plan?.target ?? null });
    },
    onEnd: (_p, commit) => {
      setDragPreview(null);
      if (commit && plan !== null) applyFill(store, uid, source, plan);
    },
  });
}

function startMove(e: GridPointerEvent, source: CellRange): void {
  const { store, sheet, geometry, scroller } = e;
  const uid = sheet.table.uid;
  const grab = grabOffset(source, geometry.clampedCellAt(e.x, e.y, e.scroll, viewportOf(scroller)));
  let dest = source;
  setDragPreview({ kind: 'move', table: uid, source, dest });
  startPointerDrag({
    scroller,
    geometry,
    event: e.event,
    onMove: (p) => {
      dest = planMove(source, grab, geometry.clampedCellAt(p.x, p.y, p.scroll, viewportOf(scroller)), sheet.size);
      setDragPreview({ kind: 'move', table: uid, source, dest });
    },
    onEnd: (_p, commit) => {
      setDragPreview(null);
      if (commit && !sameRange(dest, source)) moveRange(store, uid, source, dest);
    },
  });
}

/** 枠をつかむ帯の太さ（枠の線の内外に半分ずつ） */
const GRIP = 5;

function FillOverlay({ sheet, geometry, selection, editing, pane }: GridOverlayProps) {
  const preview = useDragPreview();
  useEffect(() => {
    if (pane !== 'body') return;
    const onDblClick = (e: MouseEvent) => {
      if (performance.now() < suppressDblClickUntil) e.stopPropagation();
    };
    window.addEventListener('dblclick', onDblClick, true);
    return () => window.removeEventListener('dblclick', onDblClick, true);
  }, [pane]);
  const uid = sheet.table.uid;
  const out: ReactNode[] = [];
  if (preview !== null && preview.table === uid && (preview.kind === 'fill' || preview.kind === 'move')) {
    // ドラッグ中: フィルは広げた後の範囲、移動は移す先の範囲を点線の枠で示す
    const range =
      preview.kind === 'fill'
        ? preview.target === null
          ? null
          : {
              top: Math.min(preview.source.top, preview.target.top),
              left: Math.min(preview.source.left, preview.target.left),
              bottom: Math.max(preview.source.bottom, preview.target.bottom),
              right: Math.max(preview.source.right, preview.target.right),
            }
        : preview.dest;
    if (range !== null) {
      const rects = geometry.rangeRects(range);
      const rect = pane === 'frozen' ? rects.frozen : rects.body;
      if (rect !== null) out.push(<div key="preview" className={`sc-drag-range ${preview.kind}`} style={rectStyle(rect)} data-testid={`drag-${preview.kind}`} />);
    }
    return <>{out}</>;
  }
  if (editing || preview !== null || selection.kind !== 'cells' || sheet.size.rows === 0 || sheet.size.cols === 0) return null;
  const range = selection.ranges[0];
  const rects = geometry.rangeRects(range);
  const rect = pane === 'frozen' ? rects.frozen : rects.body;
  if (rect === null) return null;
  const openLeft = pane === 'body' && rects.frozen !== null;
  const openRight = pane === 'frozen' && rects.body !== null;
  const half = Math.floor(GRIP / 2);
  const grips: Rect[] = [
    { left: rect.left, top: rect.top - half, width: rect.width, height: GRIP },
    { left: rect.left, top: rect.top + rect.height - half - 1, width: rect.width, height: GRIP },
  ];
  if (!openLeft) grips.push({ left: rect.left - half, top: rect.top, width: GRIP, height: rect.height });
  if (!openRight) grips.push({ left: rect.left + rect.width - half - 1, top: rect.top, width: GRIP, height: rect.height });
  grips.forEach((g, i) => out.push(<div key={`grip${i}`} className="sc-range-grip" style={rectStyle(g)} data-range-border="1" />));
  // フィルハンドルは範囲の右下（範囲の右端のあるペインに描く。固定列のペインの右端では内側に寄せる）
  if (!openRight) {
    const size = 7;
    let left = rect.left + rect.width - 4;
    if (pane === 'frozen' && left + size > geometry.rowHeaderWidth + geometry.frozenWidth) left = geometry.rowHeaderWidth + geometry.frozenWidth - size;
    out.push(
      <div
        key="handle"
        className="sc-fill-handle"
        style={{ left, top: rect.top + rect.height - 4, width: size, height: size }}
        data-fill-handle="1"
        data-testid="fill-handle"
      />,
    );
  }
  return <>{out}</>;
}

/** 直前にフィルハンドルを押した時刻と位置（ダブルクリックの判定） */
let lastHandleDown: { time: number; x: number; y: number } | null = null;
const DOUBLE_CLICK_MS = 450;
/** この時刻までの dblclick はグリッドに渡さない（フィルで選択範囲が動き、ダブルクリックがセルの編集の開始とみなされるため） */
let suppressDblClickUntil = 0;

export const fillHandleExtension: GridExtension = {
  id: 'fillHandle',
  overlay: FillOverlay,
  pointerDown(e) {
    const target = e.event.target instanceof Element ? e.event.target : null;
    const handle = target?.closest('[data-fill-handle]') ?? null;
    const border = handle === null ? (target?.closest('[data-range-border]') ?? null) : null;
    if (handle === null && border === null) return false;
    if (e.event.shiftKey || e.event.ctrlKey || e.event.metaKey) return false;
    const sel = e.store.view(e.sheet.table.uid).selection;
    if (sel.kind !== 'cells') return false;
    if (handle === null) {
      startMove(e, sel.ranges[0]);
      return true;
    }
    const now = performance.now();
    const last = lastHandleDown;
    if (last !== null && now - last.time < DOUBLE_CLICK_MS && Math.abs(last.x - e.x) < 4 && Math.abs(last.y - e.y) < 4) {
      lastHandleDown = null;
      suppressDblClickUntil = now + DOUBLE_CLICK_MS;
      autoFillDown(e.store, e.sheet.table.uid, sel.ranges[0]);
      return true;
    }
    lastHandleDown = { time: now, x: e.x, y: e.y };
    startFill(e, sel.ranges[0]);
    return true;
  },
};
