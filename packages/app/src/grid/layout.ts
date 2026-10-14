// グリッドの配置の計算（NFR-21: 座標は自前で計算し、仮想スクロールのライブラリの内部の DOM に依存しない）。
// 座標系:
// - 画面座標（viewport）: スクロールする容器の左上を原点とする（スクロールバーは含まない）
// - キャンバス座標: スクロールする中身の左上を原点とする。列ヘッダーの行と行番号の列を含む
// - 本体座標（body）: キャンバスから列ヘッダーの行を除いた部分。y は行の上端（row * rowHeight）
// 固定列（左から frozenCount 個）は横にスクロールしても動かず、スクロールする列はその下に隠れる
import type { CellPos, CellRange } from '@sheetcraft/core';

export const ROW_HEIGHT = 21;
export const HEADER_HEIGHT = 40;
export const MIN_COLUMN_WIDTH = 24;
/** 列の境界のドラッグを受け付ける幅（境界の左右それぞれ） */
export const RESIZE_HANDLE = 4;

/** 行番号の列の幅（行数の桁に合わせる） */
export function rowHeaderWidthFor(rowCount: number): number {
  const digits = String(Math.max(1, rowCount)).length;
  return Math.max(46, 14 + 8 * digits);
}

/** 1 方向の項目の並び（列幅の累積）。位置からの検索は二分探索 */
export class AxisLayout {
  private readonly starts: Float64Array;

  constructor(sizes: readonly number[]) {
    this.starts = new Float64Array(sizes.length + 1);
    for (let i = 0; i < sizes.length; i++) this.starts[i + 1] = this.starts[i] + sizes[i];
  }

  get count(): number {
    return this.starts.length - 1;
  }

  get total(): number {
    return this.starts[this.starts.length - 1];
  }

  start(i: number): number {
    if (i <= 0) return 0;
    if (i >= this.count) return this.total;
    return this.starts[i];
  }

  end(i: number): number {
    return this.start(i + 1);
  }

  size(i: number): number {
    return this.end(i) - this.start(i);
  }

  /** offset を含む項目。0 より前は 0、末尾より後は最後の項目。項目が無ければ -1 */
  indexAt(offset: number): number {
    const n = this.count;
    if (n === 0) return -1;
    if (offset <= 0) return 0;
    if (offset >= this.total) return n - 1;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}

export type GridHit =
  | { area: 'corner' }
  | { area: 'colHeader'; col: number }
  /** 列の境界（col の右端）。列幅のドラッグ */
  | { area: 'resize'; col: number }
  | { area: 'rowHeader'; row: number }
  | { area: 'cell'; row: number; col: number }
  /** 表の外（最後の行より下・最後の列より右） */
  | { area: 'none' };

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 範囲を描く矩形。固定列の部分（左のペイン）とスクロールする列の部分（本体）に分ける */
export interface RangeRects {
  frozen: Rect | null;
  body: Rect | null;
}

export interface GeometryInput {
  widths: readonly number[];
  frozenCount: number;
  rowCount: number;
  rowHeight?: number;
  headerHeight?: number;
  rowHeaderWidth?: number;
}

export interface ScrollPos {
  left: number;
  top: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export class GridGeometry {
  readonly cols: AxisLayout;
  readonly rowHeight: number;
  readonly headerHeight: number;
  readonly rowHeaderWidth: number;
  readonly frozenCount: number;
  readonly frozenWidth: number;
  readonly rowCount: number;

  constructor(input: GeometryInput) {
    this.cols = new AxisLayout(input.widths);
    this.rowHeight = input.rowHeight ?? ROW_HEIGHT;
    this.headerHeight = input.headerHeight ?? HEADER_HEIGHT;
    this.rowCount = input.rowCount;
    this.rowHeaderWidth = input.rowHeaderWidth ?? rowHeaderWidthFor(input.rowCount);
    this.frozenCount = Math.max(0, Math.min(input.frozenCount, this.cols.count));
    this.frozenWidth = this.cols.start(this.frozenCount);
  }

  get colCount(): number {
    return this.cols.count;
  }

  /** スクロールする中身の幅（行番号の列を含む） */
  get contentWidth(): number {
    return this.rowHeaderWidth + this.cols.total;
  }

  get bodyHeight(): number {
    return this.rowCount * this.rowHeight;
  }

  /** スクロールする中身の高さ（列ヘッダーの行を含む） */
  get contentHeight(): number {
    return this.headerHeight + this.bodyHeight;
  }

  isFrozen(col: number): boolean {
    return col < this.frozenCount;
  }

  /** 列の左端のキャンバス上の x（固定列は、横にスクロールしても画面上で動かないようにスクロール量を足す） */
  colCanvasX(col: number, scrollLeft: number): number {
    const x = this.rowHeaderWidth + this.cols.start(col);
    return this.isFrozen(col) ? x + scrollLeft : x;
  }

  /** 列の左端の画面上の x */
  colViewportX(col: number, scrollLeft: number): number {
    return this.colCanvasX(col, scrollLeft) - scrollLeft;
  }

  /** 行の上端の本体座標の y */
  rowY(row: number): number {
    return row * this.rowHeight;
  }

  /** 行の上端の画面上の y */
  rowViewportY(row: number, scrollTop: number): number {
    return this.headerHeight + row * this.rowHeight - scrollTop;
  }

  /** 画面上の x の列。行番号の列なら -1、最後の列より右なら colCount */
  colAtViewportX(x: number, scrollLeft: number): number {
    const v = x - this.rowHeaderWidth;
    if (v < 0) return -1;
    const offset = this.frozenCount > 0 && v < this.frozenWidth ? v : v + scrollLeft;
    if (offset >= this.cols.total) return this.colCount;
    return this.cols.indexAt(offset);
  }

  /** 画面上の y の行。列ヘッダーなら -1、最後の行より下なら rowCount */
  rowAtViewportY(y: number, scrollTop: number): number {
    const v = y - this.headerHeight;
    if (v < 0) return -1;
    const row = Math.floor((v + scrollTop) / this.rowHeight);
    return row >= this.rowCount ? this.rowCount : row;
  }

  /** 画面上の点が何を指しているか */
  hitTest(x: number, y: number, scroll: ScrollPos): GridHit {
    const col = this.colAtViewportX(x, scroll.left);
    const row = this.rowAtViewportY(y, scroll.top);
    if (row === -1) {
      if (col === -1) return { area: 'corner' };
      const resize = this.resizeColAt(x, scroll.left, col);
      if (resize !== null) return { area: 'resize', col: resize };
      return col >= this.colCount ? { area: 'none' } : { area: 'colHeader', col };
    }
    if (col === -1) return row >= this.rowCount ? { area: 'none' } : { area: 'rowHeader', row };
    if (row >= this.rowCount || col >= this.colCount) return { area: 'none' };
    return { area: 'cell', row, col };
  }

  /** 列ヘッダーの上の x が列の境界の近くなら、その境界の左の列 */
  private resizeColAt(x: number, scrollLeft: number, col: number): number | null {
    if (this.colCount === 0) return null;
    const c = Math.min(col, this.colCount - 1);
    const right = this.colViewportX(c, scrollLeft) + this.cols.size(c);
    if (Math.abs(x - right) <= RESIZE_HANDLE) return c;
    if (c > 0 && col < this.colCount) {
      const left = this.colViewportX(c, scrollLeft);
      // スクロールしてきた列の左端が固定列の下に隠れている間は、境界として扱わない
      const prevRight = this.colViewportX(c - 1, scrollLeft) + this.cols.size(c - 1);
      if (Math.abs(x - left) <= RESIZE_HANDLE && Math.abs(prevRight - left) < 1) return c - 1;
    }
    return null;
  }

  /** 画面上の点に最も近いセル（ドラッグ中に、表示領域の外に出たときも表の中に収める） */
  clampedCellAt(x: number, y: number, scroll: ScrollPos, viewport: ViewportSize): CellPos {
    const cx = Math.max(this.rowHeaderWidth, Math.min(viewport.width - 1, x));
    const cy = Math.max(this.headerHeight, Math.min(viewport.height - 1, y));
    const col = Math.max(0, Math.min(this.colCount - 1, this.colAtViewportX(cx, scroll.left)));
    const row = Math.max(0, Math.min(this.rowCount - 1, this.rowAtViewportY(cy, scroll.top)));
    return { row, col };
  }

  /** セルが見えるようにするスクロールの位置（見えていればそのまま） */
  revealScroll(pos: CellPos, scroll: ScrollPos, viewport: ViewportSize): ScrollPos {
    let { left, top } = scroll;
    const bodyHeight = viewport.height - this.headerHeight;
    if (pos.row >= 0 && pos.row < this.rowCount && bodyHeight > 0) {
      const y0 = this.rowY(pos.row);
      const y1 = y0 + this.rowHeight;
      if (y0 < top) top = y0;
      else if (y1 > top + bodyHeight) top = y1 - bodyHeight;
    }
    if (pos.col >= this.frozenCount && pos.col < this.colCount) {
      const x0 = this.cols.start(pos.col) - this.frozenWidth;
      const x1 = this.cols.end(pos.col);
      const width = viewport.width - this.rowHeaderWidth;
      if (x0 < left) left = x0;
      else if (x1 > left + width) left = Math.min(x0, x1 - width);
    }
    const maxLeft = Math.max(0, this.contentWidth - viewport.width);
    const maxTop = Math.max(0, this.contentHeight - viewport.height);
    return { left: Math.max(0, Math.min(maxLeft, left)), top: Math.max(0, Math.min(maxTop, top)) };
  }

  /**
   * 範囲を描く矩形（x はキャンバス座標から固定列のスクロールの補正を除いたもの = 行番号の列の左端からの位置、y は本体座標）。
   * 固定列の部分は左のペインに、スクロールする列の部分は本体に描く
   */
  rangeRects(range: CellRange): RangeRects {
    const top = this.rowY(range.top);
    const height = this.rowY(range.bottom + 1) - top;
    const x = (col: number) => this.rowHeaderWidth + this.cols.start(col);
    let frozen: Rect | null = null;
    let body: Rect | null = null;
    if (range.left < this.frozenCount) {
      const right = Math.min(range.right, this.frozenCount - 1);
      frozen = { left: x(range.left), top, width: x(right + 1) - x(range.left), height };
    }
    if (range.right >= this.frozenCount) {
      const left = Math.max(range.left, this.frozenCount);
      body = { left: x(left), top, width: x(range.right + 1) - x(left), height };
    }
    return { frozen, body };
  }
}
