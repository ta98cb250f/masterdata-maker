// 拡張（フィルハンドル・範囲の移動・行と列の移動）のドラッグ。ポインタのキャプチャ、表示領域の外に出たときの自動スクロール（FR-SEL-04）、
// ドラッグ中に重ねて描く印（移す先の枠・挿入位置の線）の状態を受け持つ
import type { CellRange } from '@masterdata-maker/core';
import { autoScrollVelocity } from '@masterdata-maker/core';
import { useSyncExternalStore } from 'react';
import type { GridGeometry, ScrollPos } from './layout';

/** ドラッグ中に描く印 */
export type DragPreview =
  /** フィルで値を入れる範囲（target が null なら広げていない） */
  | { kind: 'fill'; table: number; source: CellRange; target: CellRange | null }
  /** 範囲の移動先 */
  | { kind: 'move'; table: number; source: CellRange; dest: CellRange }
  /** 行・列を移す先の境目（null なら動かない位置） */
  | { kind: 'rows' | 'cols'; table: number; boundary: number | null };

let preview: DragPreview | null = null;
const listeners = new Set<() => void>();

export function setDragPreview(next: DragPreview | null): void {
  if (next === preview) return;
  preview = next;
  for (const l of [...listeners]) l();
}

export function getDragPreview(): DragPreview | null {
  return preview;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** ドラッグ中の印を購読する（重ねて描く部品から） */
export function useDragPreview(): DragPreview | null {
  return useSyncExternalStore(subscribe, getDragPreview, getDragPreview);
}

/** ドラッグ中のポインタの位置（x / y はスクロールする容器の左上から） */
export interface DragPoint {
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  scroll: ScrollPos;
}

export interface PointerDragOptions {
  scroller: HTMLElement;
  geometry: GridGeometry;
  event: PointerEvent;
  /** 自動スクロールする向き（行のドラッグは縦だけ、列のドラッグは横だけ） */
  axis?: 'both' | 'x' | 'y';
  /** 自動スクロールを始める左端に固定列を含める（列のドラッグ） */
  includeFrozen?: boolean;
  onMove(p: DragPoint): void;
  /** commit が false なら取りやめ（Esc・ポインタの取り消し） */
  onEnd(p: DragPoint, commit: boolean): void;
}

/** ドラッグを始める。ポインタを離すか取りやめるまで、onMove を呼び続ける（自動スクロールの間も） */
export function startPointerDrag(o: PointerDragOptions): void {
  const { scroller, geometry } = o;
  const pointerId = o.event.pointerId;
  const axis = o.axis ?? 'both';
  const pointAt = (clientX: number, clientY: number): DragPoint => {
    const r = scroller.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top, clientX, clientY, scroll: { left: scroller.scrollLeft, top: scroller.scrollTop } };
  };
  let last = pointAt(o.event.clientX, o.event.clientY);
  let raf: { id: number; time: number } | null = null;
  let done = false;

  const tick = (now: number) => {
    if (done) return;
    const r = scroller.getBoundingClientRect();
    const v = autoScrollVelocity(
      { x: last.clientX, y: last.clientY },
      {
        left: r.left + geometry.rowHeaderWidth + (o.includeFrozen === true ? 0 : geometry.frozenWidth),
        top: r.top + geometry.headerHeight,
        right: r.left + scroller.clientWidth,
        bottom: r.top + scroller.clientHeight,
      },
    );
    const vx = axis === 'y' ? 0 : v.x;
    const vy = axis === 'x' ? 0 : v.y;
    if (vx === 0 && vy === 0) {
      raf = null;
      return;
    }
    const dt = Math.min(100, now - (raf?.time ?? now)) / 1000;
    scroller.scrollLeft += vx * dt;
    scroller.scrollTop += vy * dt;
    last = pointAt(last.clientX, last.clientY);
    o.onMove(last);
    raf = { id: requestAnimationFrame(tick), time: now };
  };
  const startTick = () => {
    if (raf === null && !done) raf = { id: requestAnimationFrame(tick), time: performance.now() };
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    last = pointAt(e.clientX, e.clientY);
    o.onMove(last);
    startTick();
  };
  const finish = (commit: boolean, e?: PointerEvent) => {
    if (done) return;
    done = true;
    if (raf !== null) cancelAnimationFrame(raf.id);
    raf = null;
    scroller.removeEventListener('pointermove', onMove);
    scroller.removeEventListener('pointerup', onUp);
    scroller.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    if (scroller.hasPointerCapture(pointerId)) scroller.releasePointerCapture(pointerId);
    if (e !== undefined) last = pointAt(e.clientX, e.clientY);
    o.onEnd(last, commit);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId === pointerId) finish(true, e);
  };
  const onCancel = (e: PointerEvent) => {
    if (e.pointerId === pointerId) finish(false, e);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    finish(false);
  };

  try {
    scroller.setPointerCapture(pointerId);
  } catch {
    // キャプチャできなくても、容器の上の動きは受け取れる
  }
  scroller.addEventListener('pointermove', onMove);
  scroller.addEventListener('pointerup', onUp);
  scroller.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
}
