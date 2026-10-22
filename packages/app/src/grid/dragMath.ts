// グリッドのドラッグの計算（描画に依存しない。NFR-23）: フィルハンドルの向きと範囲（FR-FIL-01）、
// 範囲の枠のドラッグの移動先（FR-CLP-06）、行・列のドラッグの挿入位置（FR-ROW-04、FR-COL-05）
import type { CellPos, CellRange, FillDirection, GridSize } from '@masterdata-maker/core';
import type { GridGeometry, ScrollPos } from './layout';

/** 中身の座標（行は本体の上端から、列は列の並びの左端から。固定列の上なら固定列の位置）のピクセル */
export interface ContentPoint {
  x: number;
  y: number;
}

/** 画面上の点を中身の座標にする */
export function contentPoint(geometry: GridGeometry, x: number, y: number, scroll: ScrollPos): ContentPoint {
  const v = x - geometry.rowHeaderWidth;
  const cx = geometry.frozenCount > 0 && v >= 0 && v < geometry.frozenWidth ? v : v + scroll.left;
  return { x: cx, y: y - geometry.headerHeight + scroll.top };
}

/** 点が範囲の外にどれだけ出ているか（ピクセル。内側なら 0。上・左は負） */
export function outsideOffset(geometry: GridGeometry, range: CellRange, p: ContentPoint): { dx: number; dy: number } {
  const top = geometry.rowY(range.top);
  const bottom = geometry.rowY(range.bottom + 1);
  const left = geometry.cols.start(range.left);
  const right = geometry.cols.end(range.right);
  const dy = p.y > bottom ? p.y - bottom : p.y < top ? p.y - top : 0;
  const dx = p.x > right ? p.x - right : p.x < left ? p.x - left : 0;
  return { dx, dy };
}

export interface FillPlan {
  direction: FillDirection;
  /** 値を入れる範囲（元の範囲のすぐ外） */
  target: CellRange;
  /** 元の範囲と値を入れる範囲を合わせた範囲（フィルの後に選ぶ） */
  extended: CellRange;
}

/**
 * フィルハンドルのドラッグで値を入れる向きと範囲。pos はポインタに最も近いセル、offset は範囲の外に出た距離（outsideOffset）。
 * 上下と左右の両方に出ていれば、遠く出た方の向きにする（同じなら上下）。範囲の中、または広げる先が無ければ null
 */
export function planFill(range: CellRange, pos: CellPos, offset: { dx: number; dy: number }): FillPlan | null {
  const { dx, dy } = offset;
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dy) >= Math.abs(dx)) {
    if (dy > 0) {
      if (pos.row <= range.bottom) return null;
      return { direction: 'down', target: { ...range, top: range.bottom + 1, bottom: pos.row }, extended: { ...range, bottom: pos.row } };
    }
    if (pos.row >= range.top) return null;
    return { direction: 'up', target: { ...range, top: pos.row, bottom: range.top - 1 }, extended: { ...range, top: pos.row } };
  }
  if (dx > 0) {
    if (pos.col <= range.right) return null;
    return { direction: 'right', target: { ...range, left: range.right + 1, right: pos.col }, extended: { ...range, right: pos.col } };
  }
  if (pos.col >= range.left) return null;
  return { direction: 'left', target: { ...range, left: pos.col, right: range.left - 1 }, extended: { ...range, left: pos.col } };
}

/** 範囲の中でつかんだ位置（範囲の左上からの行・列の数。枠の外側をつかんだときも範囲の中に収める） */
export function grabOffset(range: CellRange, pos: CellPos): CellPos {
  const h = range.bottom - range.top;
  const w = range.right - range.left;
  return { row: Math.max(0, Math.min(h, pos.row - range.top)), col: Math.max(0, Math.min(w, pos.col - range.left)) };
}

/** 範囲の枠のドラッグの移動先。範囲の大きさを保ち、表の中に収める */
export function planMove(range: CellRange, grab: CellPos, pos: CellPos, size: GridSize): CellRange {
  const h = range.bottom - range.top;
  const w = range.right - range.left;
  const top = Math.max(0, Math.min(size.rows - 1 - h, pos.row - grab.row));
  const left = Math.max(0, Math.min(size.cols - 1 - w, pos.col - grab.col));
  return { top, left, bottom: top + h, right: left + w };
}

export function sameRange(a: CellRange, b: CellRange): boolean {
  return a.top === b.top && a.left === b.left && a.bottom === b.bottom && a.right === b.right;
}

/** 行の境目（0 なら先頭の行の上、rowCount なら最後の行の下）。画面上の y に最も近いもの */
export function rowBoundaryAt(geometry: GridGeometry, y: number, scrollTop: number): number {
  const v = y - geometry.headerHeight + scrollTop;
  return Math.max(0, Math.min(geometry.rowCount, Math.round(v / geometry.rowHeight)));
}

/** 列の境目（0 なら先頭の列の左、colCount なら最後の列の右）。画面上の x に最も近いもの */
export function colBoundaryAt(geometry: GridGeometry, x: number, scrollLeft: number): number {
  const c = geometry.colAtViewportX(x, scrollLeft);
  if (c < 0) return 0;
  if (c >= geometry.colCount) return geometry.colCount;
  const mid = geometry.colViewportX(c, scrollLeft) + geometry.cols.size(c) / 2;
  return x < mid ? c : c + 1;
}

/**
 * 行・列のドラッグで移す先の境目。動かす範囲（first〜last）の中や両端の境目なら動かないので null。
 * min より前には置けない（共通列の前に列を置けないなど）
 */
export function dropBoundary(boundary: number, first: number, last: number, min = 0): number | null {
  const b = Math.max(min, boundary);
  if (b >= first && b <= last + 1) return null;
  return b;
}
