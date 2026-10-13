// 選択範囲の計算（FR-SEL-01〜05）。座標はすべて表示上の座標（0 始まり）。

/** セルの位置 */
export interface CellPos {
  row: number;
  col: number;
}

/** 矩形の範囲。上下左右とも両端を含む */
export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** cells: 通常の範囲 / rows: 行全体 / cols: 列全体 / all: 全体 */
export type SelectionKind = 'cells' | 'rows' | 'cols' | 'all';

/**
 * 選択の状態。
 *
 * - `anchor`: 現在のセル（Googleスプレッドシートで白く表示される「アクティブなセル」）。
 *   入力・数式バー・編集の対象で、Shift で範囲を伸ばすときの固定端でもある
 * - `active`: Shift+矢印・ドラッグ・Shift+クリックで動く端。スクロールで見える位置に保つのはこのセル
 * - `ranges`: 選択範囲。通常は 1 つ（複数範囲は FR-SEL-06 で将来対応）。
 *   Enter / Tab で範囲の中を巡回している間は、`ranges[0]` が `anchor`〜`active` の矩形と一致しないことがある
 */
export interface Selection {
  ranges: CellRange[];
  anchor: CellPos;
  active: CellPos;
  kind: SelectionKind;
}

/** 表示中の行数・列数 */
export interface GridSize {
  rows: number;
  cols: number;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/** 表示上の (row, col) のセルが空かどうか */
export type IsEmpty = (row: number, col: number) => boolean;

const DELTAS: Record<Direction, CellPos> = {
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
};

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** 位置を表の中に収める。行数・列数が 0 のときは 0 を返す */
export function clampPos(pos: CellPos, size: GridSize): CellPos {
  return {
    row: clamp(pos.row, 0, Math.max(0, size.rows - 1)),
    col: clamp(pos.col, 0, Math.max(0, size.cols - 1)),
  };
}

/** 2 つのセルを角とする矩形 */
export function rangeOf(a: CellPos, b: CellPos): CellRange {
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

export function rangeContains(range: CellRange, pos: CellPos): boolean {
  return pos.row >= range.top && pos.row <= range.bottom && pos.col >= range.left && pos.col <= range.right;
}

export function rangeHeight(range: CellRange): number {
  return range.bottom - range.top + 1;
}

export function rangeWidth(range: CellRange): number {
  return range.right - range.left + 1;
}

export function isSingleCell(range: CellRange): boolean {
  return range.top === range.bottom && range.left === range.right;
}

/** 選択の種類に合わせて矩形を行全体・列全体に広げる */
function shapeRange(anchor: CellPos, active: CellPos, kind: SelectionKind, size: GridSize): CellRange {
  const r = rangeOf(anchor, active);
  const lastRow = Math.max(0, size.rows - 1);
  const lastCol = Math.max(0, size.cols - 1);
  if (kind === 'rows' || kind === 'all') {
    r.left = 0;
    r.right = lastCol;
  }
  if (kind === 'cols' || kind === 'all') {
    r.top = 0;
    r.bottom = lastRow;
  }
  return r;
}

function makeSelection(anchor: CellPos, active: CellPos, kind: SelectionKind, size: GridSize): Selection {
  return { ranges: [shapeRange(anchor, active, kind, size)], anchor, active, kind };
}

/** 主な範囲（複数範囲の選択は将来対応なので、常に先頭を使う） */
export function primaryRange(sel: Selection): CellRange {
  return sel.ranges[0];
}

/** 現在のセル（入力・数式バーの対象） */
export function currentCell(sel: Selection): CellPos {
  return sel.anchor;
}

/** 1 セルだけを選ぶ（クリック） */
export function selectCell(pos: CellPos, size: GridSize): Selection {
  const p = clampPos(pos, size);
  return makeSelection(p, p, 'cells', size);
}

/** 矢印キー: 現在のセルから 1 セル動かし、範囲を 1 セルに戻す */
export function moveCell(sel: Selection, dir: Direction, size: GridSize): Selection {
  const d = DELTAS[dir];
  return selectCell({ row: sel.anchor.row + d.row, col: sel.anchor.col + d.col }, size);
}

/** Shift+矢印: anchor を残して active を 1 セル動かす */
export function extendCell(sel: Selection, dir: Direction, size: GridSize): Selection {
  const d = DELTAS[dir];
  return extendTo(sel, { row: sel.active.row + d.row, col: sel.active.col + d.col }, size);
}

/** Shift+クリック・ドラッグ: anchor を残して active を pos にする。行全体・列全体の選択はその形を保つ */
export function extendTo(sel: Selection, pos: CellPos, size: GridSize): Selection {
  const p = clampPos(pos, size);
  return makeSelection(sel.anchor, p, sel.kind, size);
}

/**
 * Ctrl+矢印で移動する先（データの端）。
 * - 今のセルと隣のセルがどちらも空でなければ、連続する空でないセルの端まで
 * - そうでなければ（今のセルか隣のセルが空）、次の空でないセルまで。無ければ表の端まで
 */
export function findDataEdge(from: CellPos, dir: Direction, size: GridSize, isEmpty: IsEmpty): CellPos {
  const d = DELTAS[dir];
  const start = clampPos(from, size);
  const inside = (r: number, c: number) => r >= 0 && r < size.rows && c >= 0 && c < size.cols;
  let r = start.row + d.row;
  let c = start.col + d.col;
  if (!inside(r, c)) return start;
  if (!isEmpty(start.row, start.col) && !isEmpty(r, c)) {
    // 連続する空でないセルの端まで進む
    while (inside(r + d.row, c + d.col) && !isEmpty(r + d.row, c + d.col)) {
      r += d.row;
      c += d.col;
    }
    return { row: r, col: c };
  }
  // 次の空でないセルを探す
  while (inside(r, c)) {
    if (!isEmpty(r, c)) return { row: r, col: c };
    if (!inside(r + d.row, c + d.col)) break;
    r += d.row;
    c += d.col;
  }
  return { row: r, col: c };
}

/** Ctrl+矢印: 現在のセルからデータの端へ移動する */
export function moveToDataEdge(sel: Selection, dir: Direction, size: GridSize, isEmpty: IsEmpty): Selection {
  return selectCell(findDataEdge(sel.anchor, dir, size, isEmpty), size);
}

/** Ctrl+Shift+矢印: active をデータの端まで動かして範囲を伸ばす */
export function extendToDataEdge(sel: Selection, dir: Direction, size: GridSize, isEmpty: IsEmpty): Selection {
  return extendTo(sel, findDataEdge(sel.active, dir, size, isEmpty), size);
}

/** Ctrl+Home: 表の先頭へ */
export function moveToSheetStart(size: GridSize): Selection {
  return selectCell({ row: 0, col: 0 }, size);
}

/** Ctrl+End: 表の末尾（最後の行の最後の列）へ */
export function moveToSheetEnd(size: GridSize): Selection {
  return selectCell({ row: size.rows - 1, col: size.cols - 1 }, size);
}

/** Ctrl+Shift+Home: 表の先頭まで範囲を伸ばす */
export function extendToSheetStart(sel: Selection, size: GridSize): Selection {
  return extendTo(sel, { row: 0, col: 0 }, size);
}

/** Ctrl+Shift+End: 表の末尾まで範囲を伸ばす */
export function extendToSheetEnd(sel: Selection, size: GridSize): Selection {
  return extendTo(sel, { row: size.rows - 1, col: size.cols - 1 }, size);
}

/** Home: 行の先頭へ */
export function moveToRowStart(sel: Selection, size: GridSize): Selection {
  return selectCell({ row: sel.anchor.row, col: 0 }, size);
}

/** End: 行の末尾へ */
export function moveToRowEnd(sel: Selection, size: GridSize): Selection {
  return selectCell({ row: sel.anchor.row, col: size.cols - 1 }, size);
}

/**
 * Shift+Space: 今の範囲の行を行全体で選ぶ。現在のセルは変えない。
 * 列全体を選んでいるときは全体の選択になる
 */
export function selectRows(sel: Selection, size: GridSize): Selection {
  const r = primaryRange(sel);
  const kind: SelectionKind = sel.kind === 'cols' || sel.kind === 'all' ? 'all' : 'rows';
  const active = clampPos({ row: sel.anchor.row === r.top ? r.bottom : r.top, col: sel.active.col }, size);
  const range = shapeRange({ row: r.top, col: 0 }, { row: r.bottom, col: 0 }, kind, size);
  return { ranges: [range], anchor: sel.anchor, active, kind };
}

/**
 * Ctrl+Space: 今の範囲の列を列全体で選ぶ。現在のセルは変えない。
 * 行全体を選んでいるときは全体の選択になる
 */
export function selectCols(sel: Selection, size: GridSize): Selection {
  const r = primaryRange(sel);
  const kind: SelectionKind = sel.kind === 'rows' || sel.kind === 'all' ? 'all' : 'cols';
  const active = clampPos({ row: sel.active.row, col: sel.anchor.col === r.left ? r.right : r.left }, size);
  const range = shapeRange({ row: 0, col: r.left }, { row: 0, col: r.right }, kind, size);
  return { ranges: [range], anchor: sel.anchor, active, kind };
}

/** Ctrl+A: 全体を選ぶ。現在のセルは変えない */
export function selectAll(sel: Selection, size: GridSize): Selection {
  const anchor = clampPos(sel.anchor, size);
  return makeSelection(anchor, { row: Math.max(0, size.rows - 1), col: Math.max(0, size.cols - 1) }, 'all', size);
}

/**
 * 行番号のクリック・ドラッグ: anchorRow〜activeRow の行全体を選ぶ。
 * 現在のセルは anchorRow の先頭の列（Googleスプレッドシートと同じ）。
 * Shift+クリックで伸ばすときは `extendTo(sel, { row, col: sel.active.col }, size)` を使う
 */
export function selectRowRange(anchorRow: number, activeRow: number, size: GridSize): Selection {
  const anchor = clampPos({ row: anchorRow, col: 0 }, size);
  const active = clampPos({ row: activeRow, col: Math.max(0, size.cols - 1) }, size);
  return makeSelection(anchor, active, 'rows', size);
}

/** 列ヘッダーのクリック・ドラッグ: anchorCol〜activeCol の列全体を選ぶ。現在のセルは anchorCol の先頭の行 */
export function selectColRange(anchorCol: number, activeCol: number, size: GridSize): Selection {
  const anchor = clampPos({ row: 0, col: anchorCol }, size);
  const active = clampPos({ row: Math.max(0, size.rows - 1), col: activeCol }, size);
  return makeSelection(anchor, active, 'cols', size);
}

export function selectionContains(sel: Selection, pos: CellPos): boolean {
  return sel.ranges.some((r) => rangeContains(r, pos));
}

/** Enter / Shift+Enter / Tab / Shift+Tab */
export type AdvanceKey = 'enter' | 'shiftEnter' | 'tab' | 'shiftTab';

/**
 * Enter / Tab で現在のセルを進める。
 * - 範囲が 1 セルなら、Enter は下、Shift+Enter は上、Tab は右、Shift+Tab は左へ 1 セル動く（表の端では止まる）
 * - 2 セル以上の範囲なら、範囲を保ったまま範囲の中を巡回する。Enter は列ごとに上から下へ、
 *   列の末尾で次の列の先頭へ、範囲の最後で最初へ戻る。Tab は行ごとに左から右へ。Shift 付きは逆向き
 */
export function advanceInSelection(sel: Selection, key: AdvanceKey, size: GridSize): Selection {
  const r = primaryRange(sel);
  if (isSingleCell(r) || !rangeContains(r, sel.anchor)) {
    const dir: Direction = key === 'enter' ? 'down' : key === 'shiftEnter' ? 'up' : key === 'tab' ? 'right' : 'left';
    return moveCell(sel, dir, size);
  }
  const h = rangeHeight(r);
  const w = rangeWidth(r);
  const total = h * w;
  const rowOff = sel.anchor.row - r.top;
  const colOff = sel.anchor.col - r.left;
  const columnMajor = key === 'enter' || key === 'shiftEnter';
  const step = key === 'enter' || key === 'tab' ? 1 : -1;
  let index = columnMajor ? colOff * h + rowOff : rowOff * w + colOff;
  index = (index + step + total) % total;
  const anchor = columnMajor
    ? { row: r.top + (index % h), col: r.left + Math.floor(index / h) }
    : { row: r.top + Math.floor(index / w), col: r.left + (index % w) };
  return { ranges: sel.ranges.map((x) => ({ ...x })), anchor, active: sel.active, kind: sel.kind };
}

// ---- ドラッグ中の自動スクロール（FR-SEL-04） ----

export interface Point {
  x: number;
  y: number;
}

/** 表示領域の矩形（クライアント座標） */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface AutoScrollOptions {
  /** 表示領域の内側のこの幅に入ったらスクロールを始める（ピクセル）。既定 0 = 外に出たときだけ */
  margin?: number;
  /** 境界を越えた直後の速さ（ピクセル毎秒）。既定 60 */
  minSpeed?: number;
  /** 境界から 1 ピクセル離れるごとに増える速さ（ピクセル毎秒）。既定 30 */
  acceleration?: number;
  /** 速さの上限（ピクセル毎秒）。既定 6000 */
  maxSpeed?: number;
}

/** 自動スクロールの速さ（ピクセル毎秒）。正は右・下、負は左・上。0 ならスクロールしない */
export interface ScrollVelocity {
  x: number;
  y: number;
}

function axisVelocity(p: number, lo: number, hi: number, o: Required<AutoScrollOptions>): number {
  let dist = 0;
  if (p > hi - o.margin) dist = p - (hi - o.margin);
  else if (p < lo + o.margin) dist = p - (lo + o.margin);
  if (dist === 0) return 0;
  const speed = Math.min(o.maxSpeed, o.minSpeed + o.acceleration * Math.abs(dist));
  return dist > 0 ? speed : -speed;
}

/** ポインタの位置と表示領域の矩形から、自動スクロールの速さを求める。外に出た距離に比例して速くする */
export function autoScrollVelocity(pointer: Point, viewport: Rect, options: AutoScrollOptions = {}): ScrollVelocity {
  const o: Required<AutoScrollOptions> = {
    margin: options.margin ?? 0,
    minSpeed: options.minSpeed ?? 60,
    acceleration: options.acceleration ?? 30,
    maxSpeed: options.maxSpeed ?? 6000,
  };
  return {
    x: axisVelocity(pointer.x, viewport.left, viewport.right, o),
    y: axisVelocity(pointer.y, viewport.top, viewport.bottom, o),
  };
}
