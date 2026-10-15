// 操作（メニュー・キー操作）から開く小さな画面の位置を、描かれているグリッドの要素から求める（クライアント座標）
export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function toAnchor(r: DOMRect): AnchorRect {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function gridElement(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('[data-testid="grid"]');
}

/** 見えている範囲に収まっているか（スクロールで隠れた要素は使わない） */
function visibleIn(r: DOMRect, container: DOMRect): boolean {
  return r.width > 0 && r.bottom > container.top && r.top < container.bottom && r.right > container.left && r.left < container.right;
}

/** 現在のセルの枠 */
export function activeCellRect(): AnchorRect | null {
  const grid = gridElement();
  if (grid === null) return null;
  const el = grid.querySelector<HTMLElement>('[data-testid="active-cell"]');
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  return visibleIn(r, grid.getBoundingClientRect()) ? toAnchor(r) : null;
}

/** 列ヘッダー（表示上の列）の枠 */
export function columnHeaderRect(col: number): AnchorRect | null {
  const grid = gridElement();
  if (grid === null || col < 0) return null;
  const el = grid.querySelector<HTMLElement>(`.sc-colhead[data-col="${col}"]`);
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  return visibleIn(r, grid.getBoundingClientRect()) ? toAnchor(r) : null;
}

/** グリッドの左上の角（ほかの要素が見つからないとき） */
export function gridAnchorRect(): AnchorRect | null {
  const grid = gridElement();
  if (grid === null) return null;
  const r = grid.getBoundingClientRect();
  return { left: r.left + 48, top: r.top, right: r.left + 48, bottom: r.top + 40 };
}

/** 現在のセルの枠。見えていなければ、グリッドの左上 */
export function activeCellOrGridRect(): AnchorRect | null {
  return activeCellRect() ?? gridAnchorRect();
}
