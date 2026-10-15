import { describe, expect, it } from 'vitest';
import { AxisLayout, GridGeometry, rowHeaderWidthFor } from './layout';

describe('AxisLayout', () => {
  it('累積と二分探索', () => {
    const a = new AxisLayout([100, 50, 200]);
    expect(a.count).toBe(3);
    expect(a.total).toBe(350);
    expect([a.start(0), a.start(1), a.start(2), a.start(3)]).toEqual([0, 100, 150, 350]);
    expect(a.size(2)).toBe(200);
    expect(a.indexAt(-5)).toBe(0);
    expect(a.indexAt(0)).toBe(0);
    expect(a.indexAt(99.9)).toBe(0);
    expect(a.indexAt(100)).toBe(1);
    expect(a.indexAt(149)).toBe(1);
    expect(a.indexAt(150)).toBe(2);
    expect(a.indexAt(1000)).toBe(2);
    expect(new AxisLayout([]).indexAt(10)).toBe(-1);
  });

  it('1 万項目でも正しく引ける', () => {
    const sizes = Array.from({ length: 10_000 }, (_, i) => 20 + (i % 7));
    const a = new AxisLayout(sizes);
    for (const i of [0, 1, 5000, 9999]) {
      expect(a.indexAt(a.start(i))).toBe(i);
      expect(a.indexAt(a.end(i) - 0.5)).toBe(i);
    }
  });
});

describe('GridGeometry', () => {
  // 行番号の列 50px、列ヘッダー 40px、行 20px。列は 100, 100, 100, 100（左 1 列を固定）
  const g = new GridGeometry({ widths: [100, 100, 100, 100], frozenCount: 1, rowCount: 100, rowHeight: 20, headerHeight: 40, rowHeaderWidth: 50 });
  const viewport = { width: 300, height: 240 };

  it('大きさ', () => {
    expect(g.contentWidth).toBe(450);
    expect(g.contentHeight).toBe(40 + 2000);
    expect(g.frozenWidth).toBe(100);
    expect(rowHeaderWidthFor(9)).toBe(46);
    expect(rowHeaderWidthFor(10_000)).toBeGreaterThan(46);
  });

  it('当たり判定: 角・列ヘッダー・行番号・セル・表の外。固定列はスクロールしても同じ位置', () => {
    const s0 = { left: 0, top: 0 };
    expect(g.hitTest(10, 10, s0)).toEqual({ area: 'corner' });
    expect(g.hitTest(60, 10, s0)).toEqual({ area: 'colHeader', col: 0 });
    expect(g.hitTest(160, 10, s0)).toEqual({ area: 'colHeader', col: 1 });
    expect(g.hitTest(10, 45, s0)).toEqual({ area: 'rowHeader', row: 0 });
    expect(g.hitTest(160, 65, s0)).toEqual({ area: 'cell', row: 1, col: 1 });
    const s = { left: 150, top: 100 };
    // 固定列は動かない
    expect(g.hitTest(60, 45, s)).toEqual({ area: 'cell', row: 5, col: 0 });
    // 固定列の右（画面上 150 = 列の位置 100 + スクロール 150 = 250 → 列 2）
    expect(g.hitTest(150, 45, s)).toEqual({ area: 'cell', row: 5, col: 2 });
    expect(g.hitTest(10, 45 + 20 * 95, s)).toEqual({ area: 'none' });
    const narrow = new GridGeometry({ widths: [100], frozenCount: 0, rowCount: 1, rowHeight: 20, headerHeight: 40, rowHeaderWidth: 50 });
    expect(narrow.hitTest(200, 45, s0)).toEqual({ area: 'none' });
  });

  it('列の境界の当たり判定（列幅のドラッグ）', () => {
    const s0 = { left: 0, top: 0 };
    expect(g.hitTest(149, 10, s0)).toEqual({ area: 'resize', col: 0 });
    expect(g.hitTest(152, 10, s0)).toEqual({ area: 'resize', col: 0 });
    expect(g.hitTest(250, 10, s0)).toEqual({ area: 'resize', col: 1 });
    expect(g.hitTest(200, 10, s0)).toEqual({ area: 'colHeader', col: 1 });
  });

  it('見えるようにするスクロール（固定列の右に出す・下端に合わせる）', () => {
    const s0 = { left: 0, top: 0 };
    expect(g.revealScroll({ row: 0, col: 0 }, s0, viewport)).toEqual(s0);
    // 本体の高さは 200（10 行）。行 15 の下端 320 を下端に
    expect(g.revealScroll({ row: 15, col: 0 }, s0, viewport)).toEqual({ left: 0, top: 120 });
    // 上に戻る
    expect(g.revealScroll({ row: 2, col: 0 }, { left: 0, top: 120 }, viewport)).toEqual({ left: 0, top: 40 });
    // 列 3（100..400 の 300..400）: 見える幅は 250 なので left = 400 - 250 = 150
    expect(g.revealScroll({ row: 0, col: 3 }, s0, viewport)).toEqual({ left: 150, top: 0 });
    // 列 1 は固定列（幅 100）の右に出す: 100 - 100 = 0
    expect(g.revealScroll({ row: 0, col: 1 }, { left: 150, top: 0 }, viewport)).toEqual({ left: 0, top: 0 });
    // 固定列はスクロールしない
    expect(g.revealScroll({ row: 0, col: 0 }, { left: 150, top: 0 }, viewport)).toEqual({ left: 150, top: 0 });
  });

  it('ドラッグで外に出たときは端のセルに収める', () => {
    expect(g.clampedCellAt(-100, -100, { left: 0, top: 0 }, viewport)).toEqual({ row: 0, col: 0 });
    expect(g.clampedCellAt(1000, 1000, { left: 0, top: 0 }, viewport)).toEqual({ row: 9, col: 2 });
  });

  it('範囲の矩形を固定列とスクロールする列に分ける', () => {
    expect(g.rangeRects({ top: 1, left: 0, bottom: 2, right: 2 })).toEqual({
      frozen: { left: 50, top: 20, width: 100, height: 40 },
      body: { left: 150, top: 20, width: 200, height: 40 },
    });
    expect(g.rangeRects({ top: 0, left: 0, bottom: 0, right: 0 })).toEqual({ frozen: { left: 50, top: 0, width: 100, height: 20 }, body: null });
    expect(g.rangeRects({ top: 0, left: 2, bottom: 0, right: 3 })).toEqual({ frozen: null, body: { left: 250, top: 0, width: 200, height: 20 } });
  });

  it('固定列のキャンバス上の位置はスクロール量だけずらす', () => {
    expect(g.colCanvasX(0, 150)).toBe(200);
    expect(g.colViewportX(0, 150)).toBe(50);
    expect(g.colCanvasX(2, 150)).toBe(250);
    expect(g.colViewportX(2, 150)).toBe(100);
  });
});
