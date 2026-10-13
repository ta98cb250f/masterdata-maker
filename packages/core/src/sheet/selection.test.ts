import { describe, expect, it } from 'vitest';
import {
  advanceInSelection,
  autoScrollVelocity,
  extendCell,
  extendTo,
  extendToDataEdge,
  extendToSheetEnd,
  findDataEdge,
  moveCell,
  moveToDataEdge,
  moveToRowEnd,
  moveToRowStart,
  moveToSheetEnd,
  moveToSheetStart,
  rangeOf,
  selectAll,
  selectCell,
  selectColRange,
  selectCols,
  selectRowRange,
  selectRows,
  selectionContains,
} from './selection';
import type { CellPos, GridSize, IsEmpty, Selection } from './selection';

const size: GridSize = { rows: 10, cols: 5 };

/** 文字列の図からセルが空かどうかを作る。'x' が空でないセル */
function grid(lines: string[]): { size: GridSize; isEmpty: IsEmpty } {
  return {
    size: { rows: lines.length, cols: lines[0].length },
    isEmpty: (r, c) => lines[r][c] !== 'x',
  };
}

describe('1 セルの移動と範囲の拡張', () => {
  it('矢印キーで 1 セル動き、表の端で止まる', () => {
    let s = selectCell({ row: 0, col: 0 }, size);
    s = moveCell(s, 'down', size);
    expect(s.anchor).toEqual({ row: 1, col: 0 });
    s = moveCell(s, 'left', size);
    expect(s.anchor).toEqual({ row: 1, col: 0 });
    s = moveCell(s, 'up', size);
    s = moveCell(s, 'up', size);
    expect(s.anchor).toEqual({ row: 0, col: 0 });
    expect(s.ranges).toEqual([{ top: 0, left: 0, bottom: 0, right: 0 }]);
  });

  it('Shift+矢印は anchor を残して active を動かす', () => {
    let s = selectCell({ row: 2, col: 2 }, size);
    s = extendCell(s, 'down', size);
    s = extendCell(s, 'down', size);
    s = extendCell(s, 'left', size);
    expect(s.anchor).toEqual({ row: 2, col: 2 });
    expect(s.active).toEqual({ row: 4, col: 1 });
    expect(s.ranges[0]).toEqual({ top: 2, left: 1, bottom: 4, right: 2 });
    // 反対側へ戻ると anchor を越えて伸びる
    s = extendCell(s, 'up', size);
    s = extendCell(s, 'up', size);
    s = extendCell(s, 'up', size);
    expect(s.ranges[0]).toEqual({ top: 1, left: 1, bottom: 2, right: 2 });
  });

  it('範囲を選んだ状態で矢印を押すと、現在のセル（anchor）から動いて 1 セルに戻る', () => {
    let s = selectCell({ row: 2, col: 2 }, size);
    s = extendTo(s, { row: 5, col: 4 }, size);
    s = moveCell(s, 'right', size);
    expect(s.anchor).toEqual({ row: 2, col: 3 });
    expect(s.ranges).toEqual([{ top: 2, left: 3, bottom: 2, right: 3 }]);
  });

  it('extendTo は表の外の位置を表の中に収める', () => {
    const s = extendTo(selectCell({ row: 1, col: 1 }, size), { row: 100, col: -3 }, size);
    expect(s.ranges[0]).toEqual({ top: 1, left: 0, bottom: 9, right: 1 });
  });

  it('rangeOf と selectionContains', () => {
    expect(rangeOf({ row: 3, col: 1 }, { row: 1, col: 4 })).toEqual({ top: 1, left: 1, bottom: 3, right: 4 });
    const s = extendTo(selectCell({ row: 1, col: 1 }, size), { row: 2, col: 2 }, size);
    expect(selectionContains(s, { row: 2, col: 1 })).toBe(true);
    expect(selectionContains(s, { row: 3, col: 1 })).toBe(false);
  });
});

describe('Ctrl+矢印（データの端）', () => {
  // Googleスプレッドシート・Excel と同じ規則（一般に知られた挙動。実物での突き合わせは未検証）
  const g = grid(['x', 'x', 'x', '.', '.', 'x', 'x', '.', 'x', '.']);
  const at = (row: number): CellPos => ({ row, col: 0 });

  it('今のセルと隣が空でなければ、連続する空でないセルの端まで', () => {
    expect(findDataEdge(at(0), 'down', g.size, g.isEmpty)).toEqual(at(2));
    expect(findDataEdge(at(5), 'down', g.size, g.isEmpty)).toEqual(at(6));
    expect(findDataEdge(at(6), 'up', g.size, g.isEmpty)).toEqual(at(5));
  });

  it('隣が空なら、次の空でないセルまで', () => {
    expect(findDataEdge(at(2), 'down', g.size, g.isEmpty)).toEqual(at(5));
    expect(findDataEdge(at(6), 'down', g.size, g.isEmpty)).toEqual(at(8));
    expect(findDataEdge(at(5), 'up', g.size, g.isEmpty)).toEqual(at(2));
  });

  it('今のセルが空なら、次の空でないセルまで', () => {
    expect(findDataEdge(at(3), 'down', g.size, g.isEmpty)).toEqual(at(5));
    expect(findDataEdge(at(4), 'up', g.size, g.isEmpty)).toEqual(at(2));
  });

  it('空でないセルが無ければ表の端まで。端にいれば動かない', () => {
    expect(findDataEdge(at(8), 'down', g.size, g.isEmpty)).toEqual(at(9));
    expect(findDataEdge(at(9), 'down', g.size, g.isEmpty)).toEqual(at(9));
    expect(findDataEdge(at(0), 'up', g.size, g.isEmpty)).toEqual(at(0));
  });

  it('横方向', () => {
    const h = grid(['xx..x.']);
    expect(findDataEdge({ row: 0, col: 0 }, 'right', h.size, h.isEmpty)).toEqual({ row: 0, col: 1 });
    expect(findDataEdge({ row: 0, col: 1 }, 'right', h.size, h.isEmpty)).toEqual({ row: 0, col: 4 });
    expect(findDataEdge({ row: 0, col: 4 }, 'right', h.size, h.isEmpty)).toEqual({ row: 0, col: 5 });
    expect(findDataEdge({ row: 0, col: 5 }, 'left', h.size, h.isEmpty)).toEqual({ row: 0, col: 4 });
  });

  it('Ctrl+Shift+矢印は active から端まで範囲を伸ばす', () => {
    let s = selectCell(at(0), g.size);
    s = extendToDataEdge(s, 'down', g.size, g.isEmpty);
    expect(s.ranges[0]).toEqual({ top: 0, left: 0, bottom: 2, right: 0 });
    s = extendToDataEdge(s, 'down', g.size, g.isEmpty);
    expect(s.ranges[0]).toEqual({ top: 0, left: 0, bottom: 5, right: 0 });
    expect(s.anchor).toEqual(at(0));
    const m = moveToDataEdge(s, 'down', g.size, g.isEmpty);
    expect(m.anchor).toEqual(at(2));
  });
});

describe('Ctrl+Home / Ctrl+End / Home / End', () => {
  it('表の先頭・末尾、行の先頭・末尾', () => {
    expect(moveToSheetStart(size).anchor).toEqual({ row: 0, col: 0 });
    expect(moveToSheetEnd(size).anchor).toEqual({ row: 9, col: 4 });
    const s = selectCell({ row: 3, col: 2 }, size);
    expect(moveToRowStart(s, size).anchor).toEqual({ row: 3, col: 0 });
    expect(moveToRowEnd(s, size).anchor).toEqual({ row: 3, col: 4 });
    expect(extendToSheetEnd(s, size).ranges[0]).toEqual({ top: 3, left: 2, bottom: 9, right: 4 });
  });
});

describe('行全体・列全体・全体の選択', () => {
  it('Shift+Space で行全体。現在のセルは変えない', () => {
    let s = extendTo(selectCell({ row: 2, col: 1 }, size), { row: 3, col: 2 }, size);
    s = selectRows(s, size);
    expect(s.kind).toBe('rows');
    expect(s.ranges[0]).toEqual({ top: 2, left: 0, bottom: 3, right: 4 });
    expect(s.anchor).toEqual({ row: 2, col: 1 });
    // 行全体の選択は Shift+↓ でも行全体のまま伸びる
    s = extendCell(s, 'down', size);
    expect(s.ranges[0]).toEqual({ top: 2, left: 0, bottom: 4, right: 4 });
  });

  it('Ctrl+Space で列全体', () => {
    const s = selectCols(selectCell({ row: 2, col: 1 }, size), size);
    expect(s.kind).toBe('cols');
    expect(s.ranges[0]).toEqual({ top: 0, left: 1, bottom: 9, right: 1 });
    // 列全体のあとに Shift+Space で全体
    expect(selectRows(s, size).kind).toBe('all');
  });

  it('Ctrl+A で全体', () => {
    const s = selectAll(selectCell({ row: 4, col: 3 }, size), size);
    expect(s.kind).toBe('all');
    expect(s.ranges[0]).toEqual({ top: 0, left: 0, bottom: 9, right: 4 });
    expect(s.anchor).toEqual({ row: 4, col: 3 });
  });

  it('行番号・列ヘッダーのクリックとドラッグ', () => {
    const r = selectRowRange(5, 2, size);
    expect(r.ranges[0]).toEqual({ top: 2, left: 0, bottom: 5, right: 4 });
    expect(r.anchor).toEqual({ row: 5, col: 0 });
    const c = selectColRange(1, 3, size);
    expect(c.ranges[0]).toEqual({ top: 0, left: 1, bottom: 9, right: 3 });
    // Shift+クリックで列を伸ばす
    const c2 = extendTo(c, { row: c.active.row, col: 4 }, size);
    expect(c2.ranges[0]).toEqual({ top: 0, left: 1, bottom: 9, right: 4 });
    expect(c2.kind).toBe('cols');
  });
});

describe('Enter / Tab による範囲の中での移動', () => {
  // Excel と同じ巡回の規則。Googleスプレッドシートでの挙動は未検証
  const range = (): Selection => extendTo(selectCell({ row: 1, col: 1 }, size), { row: 2, col: 3 }, size);

  it('1 セルなら Enter で下、Tab で右、Shift 付きは逆へ', () => {
    const s = selectCell({ row: 1, col: 1 }, size);
    expect(advanceInSelection(s, 'enter', size).anchor).toEqual({ row: 2, col: 1 });
    expect(advanceInSelection(s, 'shiftEnter', size).anchor).toEqual({ row: 0, col: 1 });
    expect(advanceInSelection(s, 'tab', size).anchor).toEqual({ row: 1, col: 2 });
    expect(advanceInSelection(s, 'shiftTab', size).anchor).toEqual({ row: 1, col: 0 });
  });

  it('Enter は列ごとに上から下へ巡回し、範囲は変わらない', () => {
    let s = range();
    const seen: CellPos[] = [];
    for (let i = 0; i < 7; i++) {
      s = advanceInSelection(s, 'enter', size);
      seen.push(s.anchor);
    }
    expect(seen).toEqual([
      { row: 2, col: 1 },
      { row: 1, col: 2 },
      { row: 2, col: 2 },
      { row: 1, col: 3 },
      { row: 2, col: 3 },
      { row: 1, col: 1 },
      { row: 2, col: 1 },
    ]);
    expect(s.ranges[0]).toEqual({ top: 1, left: 1, bottom: 2, right: 3 });
  });

  it('Tab は行ごとに左から右へ巡回し、Shift+Tab は逆', () => {
    let s = range();
    const seen: CellPos[] = [];
    for (let i = 0; i < 6; i++) {
      s = advanceInSelection(s, 'tab', size);
      seen.push(s.anchor);
    }
    expect(seen).toEqual([
      { row: 1, col: 2 },
      { row: 1, col: 3 },
      { row: 2, col: 1 },
      { row: 2, col: 2 },
      { row: 2, col: 3 },
      { row: 1, col: 1 },
    ]);
    expect(advanceInSelection(range(), 'shiftTab', size).anchor).toEqual({ row: 2, col: 3 });
    expect(advanceInSelection(range(), 'shiftEnter', size).anchor).toEqual({ row: 2, col: 3 });
  });
});

describe('自動スクロールの速さ（FR-SEL-04）', () => {
  const viewport = { left: 0, top: 0, right: 800, bottom: 600 };

  it('表示領域の中では 0、外に出たら外に出た距離に応じて速くなる', () => {
    expect(autoScrollVelocity({ x: 400, y: 300 }, viewport)).toEqual({ x: 0, y: 0 });
    expect(autoScrollVelocity({ x: 400, y: 600 }, viewport)).toEqual({ x: 0, y: 0 });
    const near = autoScrollVelocity({ x: 400, y: 610 }, viewport);
    const far = autoScrollVelocity({ x: 400, y: 700 }, viewport);
    expect(near.y).toBeGreaterThan(0);
    expect(far.y).toBeGreaterThan(near.y);
    const up = autoScrollVelocity({ x: -50, y: -20 }, viewport);
    expect(up.x).toBeLessThan(0);
    expect(up.y).toBeLessThan(0);
  });

  it('上限を超えない。margin を指定すると内側から始まる', () => {
    expect(autoScrollVelocity({ x: 400, y: 1e6 }, viewport).y).toBe(6000);
    expect(autoScrollVelocity({ x: 400, y: 590 }, viewport, { margin: 20 }).y).toBeGreaterThan(0);
  });
});

describe('受け入れ基準 1: 1,000 行 × 20 列で下端を越えてドラッグし、500 行目で離す', () => {
  it('スクロールしながら範囲が伸び、1〜500 行目が選択される', () => {
    const big: GridSize = { rows: 1000, cols: 20 };
    const rowHeight = 21;
    const viewport = { left: 0, top: 0, right: 1200, bottom: 600 };
    const maxScroll = big.rows * rowHeight - (viewport.bottom - viewport.top);
    let scrollTop = 0;
    // 1 行目の B 列を押してドラッグを始める
    let sel = selectCell({ row: 0, col: 1 }, big);
    const pointer = { x: 150, y: 640 }; // グリッドの下端を越えた位置
    const rowAt = (y: number) => Math.min(big.rows - 1, Math.floor((Math.min(y, viewport.bottom) + scrollTop) / rowHeight));
    const dt = 1 / 60;
    let frames = 0;
    while (rowAt(pointer.y) < 499 && frames < 10000) {
      const v = autoScrollVelocity(pointer, viewport);
      scrollTop = Math.min(maxScroll, scrollTop + v.y * dt);
      sel = extendTo(sel, { row: rowAt(pointer.y), col: 1 }, big);
      expect(sel.ranges[0].top).toBe(0);
      frames++;
    }
    // 500 行目まで来たので、ポインタを表示領域に戻して 500 行目の上で離す
    const y500 = 499 * rowHeight - scrollTop + 1;
    expect(y500).toBeGreaterThanOrEqual(viewport.top);
    expect(y500).toBeLessThanOrEqual(viewport.bottom);
    expect(autoScrollVelocity({ x: 150, y: y500 }, viewport)).toEqual({ x: 0, y: 0 });
    sel = extendTo(sel, { row: rowAt(y500), col: 1 }, big);
    expect(frames).toBeGreaterThan(1);
    expect(sel.anchor).toEqual({ row: 0, col: 1 });
    expect(sel.ranges).toEqual([{ top: 0, left: 1, bottom: 499, right: 1 }]);
  });
});
