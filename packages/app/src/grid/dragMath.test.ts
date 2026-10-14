import { describe, expect, it } from 'vitest';
import { colBoundaryAt, contentPoint, dropBoundary, grabOffset, outsideOffset, planFill, planMove, rowBoundaryAt } from './dragMath';
import { GridGeometry } from './layout';

// 列幅 100 が 5 列、行の高さ 21、列ヘッダー 40、行番号の列 46
const geometry = (frozenCount = 0) => new GridGeometry({ widths: [100, 100, 100, 100, 100], frozenCount, rowCount: 20, rowHeaderWidth: 46 });
const range = { top: 2, left: 1, bottom: 3, right: 2 };

describe('フィルハンドルの向きと範囲（FR-FIL-01）', () => {
  it('下へ: 範囲の下の行まで、同じ列に広げる', () => {
    expect(planFill(range, { row: 6, col: 2 }, { dx: 0, dy: 40 })).toEqual({
      direction: 'down',
      target: { top: 4, left: 1, bottom: 6, right: 2 },
      extended: { top: 2, left: 1, bottom: 6, right: 2 },
    });
  });

  it('上へ・左へ・右へ', () => {
    expect(planFill(range, { row: 0, col: 1 }, { dx: 0, dy: -30 })).toMatchObject({ direction: 'up', target: { top: 0, bottom: 1, left: 1, right: 2 } });
    expect(planFill(range, { row: 3, col: 0 }, { dx: -50, dy: 0 })).toMatchObject({ direction: 'left', target: { top: 2, bottom: 3, left: 0, right: 0 } });
    expect(planFill(range, { row: 2, col: 4 }, { dx: 150, dy: 0 })).toMatchObject({ direction: 'right', extended: { top: 2, bottom: 3, left: 1, right: 4 } });
  });

  it('斜めに出たら、遠く出た方の向き（同じなら上下）', () => {
    expect(planFill(range, { row: 5, col: 4 }, { dx: 150, dy: 30 })?.direction).toBe('right');
    expect(planFill(range, { row: 8, col: 3 }, { dx: 20, dy: 100 })?.direction).toBe('down');
    expect(planFill(range, { row: 5, col: 3 }, { dx: 30, dy: 30 })?.direction).toBe('down');
  });

  it('範囲の中、または広げる先が無ければ null', () => {
    expect(planFill(range, { row: 3, col: 2 }, { dx: 0, dy: 0 })).toBeNull();
    // 最後の行で下へ出ても、セルは範囲の中のまま
    expect(planFill(range, { row: 3, col: 2 }, { dx: 0, dy: 15 })).toBeNull();
  });

  it('範囲の外に出た距離（中身の座標）', () => {
    const g = geometry();
    // 範囲は y が 42〜84、x が 100〜300
    expect(outsideOffset(g, range, { x: 150, y: 90 })).toEqual({ dx: 0, dy: 6 });
    expect(outsideOffset(g, range, { x: 320, y: 50 })).toEqual({ dx: 20, dy: 0 });
    expect(outsideOffset(g, range, { x: 90, y: 30 })).toEqual({ dx: -10, dy: -12 });
    // 画面座標から: スクロールした分を足す。固定列の上はスクロールしない
    expect(contentPoint(g, 146, 61, { left: 30, top: 21 })).toEqual({ x: 130, y: 42 });
    expect(contentPoint(geometry(1), 96, 61, { left: 30, top: 0 })).toEqual({ x: 50, y: 21 });
  });
});

describe('範囲の枠のドラッグの移動先（FR-CLP-06）', () => {
  it('つかんだ位置を保って動かし、表の中に収める', () => {
    const grab = grabOffset(range, { row: 3, col: 1 });
    expect(grab).toEqual({ row: 1, col: 0 });
    expect(planMove(range, grab, { row: 8, col: 3 }, { rows: 20, cols: 5 })).toEqual({ top: 7, left: 3, bottom: 8, right: 4 });
    expect(planMove(range, grab, { row: 0, col: 4 }, { rows: 20, cols: 5 })).toEqual({ top: 0, left: 3, bottom: 1, right: 4 });
    // 枠の外側をつかんでも、範囲の中の位置とみなす
    expect(grabOffset(range, { row: 1, col: 5 })).toEqual({ row: 0, col: 1 });
  });
});

describe('行・列のドラッグの挿入位置（FR-ROW-04、FR-COL-05）', () => {
  it('行の境目は y に最も近いもの', () => {
    const g = geometry();
    expect(rowBoundaryAt(g, 40 + 21 * 3 + 5, 0)).toBe(3);
    expect(rowBoundaryAt(g, 40 + 21 * 3 + 15, 0)).toBe(4);
    expect(rowBoundaryAt(g, 40 + 5, 210)).toBe(10);
    expect(rowBoundaryAt(g, 10_000, 0)).toBe(20);
    expect(rowBoundaryAt(g, 0, 0)).toBe(0);
  });

  it('列の境目は列の中央で分ける。固定列の上はスクロールしない', () => {
    const g = geometry();
    expect(colBoundaryAt(g, 46 + 130, 0)).toBe(1);
    expect(colBoundaryAt(g, 46 + 160, 0)).toBe(2);
    expect(colBoundaryAt(g, 46 + 160, 100)).toBe(3);
    expect(colBoundaryAt(g, 20, 0)).toBe(0);
    expect(colBoundaryAt(g, 46 + 600, 0)).toBe(5);
    expect(colBoundaryAt(geometry(1), 46 + 20, 300)).toBe(0);
  });

  it('動かす範囲の中や両端の境目では動かない。min より前には置けない', () => {
    expect(dropBoundary(2, 2, 3)).toBeNull();
    expect(dropBoundary(4, 2, 3)).toBeNull();
    expect(dropBoundary(3, 2, 3)).toBeNull();
    expect(dropBoundary(1, 2, 3)).toBe(1);
    expect(dropBoundary(5, 2, 3)).toBe(5);
    expect(dropBoundary(0, 4, 5, 2)).toBe(2);
    expect(dropBoundary(1, 2, 3, 2)).toBeNull();
  });
});
