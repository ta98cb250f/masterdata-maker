import { describe, expect, it } from 'vitest';
import { DEFAULT_HISTORY_LIMIT, UndoHistory } from './history';

describe('元に戻す履歴', () => {
  it('追加・元に戻す・やり直し', () => {
    const h = new UndoHistory<string>();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.undo()).toBeUndefined();
    h.push('A');
    h.push('B');
    expect(h.peekUndo()).toBe('B');
    expect(h.undo()).toBe('B');
    expect(h.peekUndo()).toBe('A');
    expect(h.peekRedo()).toBe('B');
    expect(h.canRedo()).toBe(true);
    expect(h.undo()).toBe('A');
    expect(h.canUndo()).toBe(false);
    expect(h.redo()).toBe('A');
    expect(h.redo()).toBe('B');
    expect(h.redo()).toBeUndefined();
    expect(h.undoCount).toBe(2);
    expect(h.redoCount).toBe(0);
  });

  it('追加するとやり直しの履歴は消える', () => {
    const h = new UndoHistory<number>();
    h.push(1);
    h.push(2);
    h.undo();
    h.push(3);
    expect(h.canRedo()).toBe(false);
    expect(h.undo()).toBe(3);
    expect(h.undo()).toBe(1);
  });

  it('受け入れ基準 6 の流れ: テーブル A、B の順に編集して 2 回戻すと B、A の順', () => {
    const h = new UndoHistory<{ table: string }>();
    h.push({ table: 'A' });
    h.push({ table: 'B' });
    expect(h.undo()?.table).toBe('B');
    expect(h.undo()?.table).toBe('A');
  });

  it('件数の上限（既定 200。P-44）を超えたら古いものから捨てる', () => {
    expect(DEFAULT_HISTORY_LIMIT).toBe(200);
    const h = new UndoHistory<number>();
    expect(h.limit).toBe(200);
    for (let i = 0; i < 250; i++) h.push(i);
    expect(h.undoCount).toBe(200);
    let last: number | undefined;
    while (h.canUndo()) last = h.undo();
    expect(last).toBe(50);
    const small = new UndoHistory<number>(2);
    small.push(1);
    small.push(2);
    small.push(3);
    expect(small.undo()).toBe(3);
    expect(small.undo()).toBe(2);
    expect(small.undo()).toBeUndefined();
  });

  it('clear と不正な上限', () => {
    const h = new UndoHistory<number>();
    h.push(1);
    h.undo();
    h.push(2);
    h.clear();
    expect(h.canUndo() || h.canRedo()).toBe(false);
    expect(() => new UndoHistory(0)).toThrow(RangeError);
  });

  it('some は元に戻す・やり直しの両方の項目を調べる', () => {
    const h = new UndoHistory<number>();
    h.push(1);
    h.push(2);
    h.undo();
    expect(h.some((n) => n === 2)).toBe(true);
    expect(h.some((n) => n === 1)).toBe(true);
    expect(h.some((n) => n === 3)).toBe(false);
  });
});
