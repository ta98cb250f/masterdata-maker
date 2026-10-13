import { describe, expect, it } from 'vitest';
import { matchesCondition, visibleRows } from './filter';
import type { FilterCell } from './filter';

const text = (t: string): FilterCell => ({ text: t, empty: t === '' });
const numCell = (v: number | bigint): FilterCell => ({ text: String(v), value: v, empty: false });
const EMPTY: FilterCell = { text: '', value: null, empty: true };

describe('1 つのセルの判定', () => {
  it('値の一覧から選ぶ。空欄を含めるかどうか', () => {
    const cond = { type: 'values', values: new Set(['SSR', 'SR']), includeEmpty: false } as const;
    expect(matchesCondition(text('SSR'), cond)).toBe(true);
    expect(matchesCondition(text('R'), cond)).toBe(false);
    expect(matchesCondition(text('ssr'), cond)).toBe(false);
    expect(matchesCondition(EMPTY, cond)).toBe(false);
    expect(matchesCondition(EMPTY, { ...cond, includeEmpty: true })).toBe(true);
    // 配列でも指定できる
    expect(matchesCondition(text('SR'), { type: 'values', values: ['SR'], includeEmpty: false })).toBe(true);
  });

  it('等しい: 既定は大文字と小文字を区別しない（Googleスプレッドシートでは未検証）', () => {
    expect(matchesCondition(text('Fire'), { type: 'equals', value: 'fire' })).toBe(true);
    expect(matchesCondition(text('Fire'), { type: 'equals', value: 'fire', caseSensitive: true })).toBe(false);
    expect(matchesCondition(text('Fire'), { type: 'equals', value: 'Fir' })).toBe(false);
  });

  it('等しい: 数値のセルは数値として比べる', () => {
    expect(matchesCondition(numCell(1200), { type: 'equals', value: '1200.0' })).toBe(true);
    expect(matchesCondition(numCell(9007199254740993n), { type: 'equals', value: '9007199254740993' })).toBe(true);
    expect(matchesCondition(numCell(9007199254740993n), { type: 'equals', value: '9007199254740992' })).toBe(false);
    expect(matchesCondition(numCell(5), { type: 'equals', value: 'abc' })).toBe(false);
  });

  it('含む', () => {
    expect(matchesCondition(text('勇者アルス'), { type: 'contains', value: 'アルス' })).toBe(true);
    expect(matchesCondition(text('Stage_01'), { type: 'contains', value: 'stage' })).toBe(true);
    expect(matchesCondition(text('Stage_01'), { type: 'contains', value: 'stage', caseSensitive: true })).toBe(false);
    expect(matchesCondition(EMPTY, { type: 'contains', value: 'a' })).toBe(false);
  });

  it('範囲（最小・最大を含む。片側だけでもよい）', () => {
    const cond = { type: 'range', min: 100, max: 200 } as const;
    expect(matchesCondition(numCell(100), cond)).toBe(true);
    expect(matchesCondition(numCell(200), cond)).toBe(true);
    expect(matchesCondition(numCell(201), cond)).toBe(false);
    expect(matchesCondition(numCell(150n), cond)).toBe(true);
    expect(matchesCondition(numCell(-5), { type: 'range', max: 0 })).toBe(true);
    expect(matchesCondition(text('abc'), cond)).toBe(false);
    expect(matchesCondition(EMPTY, { type: 'range' })).toBe(false);
  });

  it('空欄 / 空欄以外', () => {
    expect(matchesCondition(EMPTY, { type: 'empty' })).toBe(true);
    expect(matchesCondition(text('a'), { type: 'empty' })).toBe(false);
    expect(matchesCondition(text('a'), { type: 'notEmpty' })).toBe(true);
    expect(matchesCondition(EMPTY, { type: 'notEmpty' })).toBe(false);
  });
});

describe('表示中の行', () => {
  const data = [
    { rarity: 'SSR', hp: 1200 },
    { rarity: 'SR', hp: 800 },
    { rarity: '', hp: 950 },
    { rarity: 'SSR', hp: 700 },
  ];
  const getCell = (row: number, col: number): FilterCell =>
    col === 0 ? text(data[row].rarity) : numCell(data[row].hp);

  it('複数の列の条件は AND。並べ替えた順を保つ', () => {
    const rows = [3, 2, 1, 0];
    expect(
      visibleRows(rows, [
        { col: 0, condition: { type: 'values', values: ['SSR'], includeEmpty: true } },
        { col: 1, condition: { type: 'range', min: 900 } },
      ], getCell),
    ).toEqual([2, 0]);
  });

  it('条件が無ければすべての行', () => {
    expect(visibleRows([0, 1, 2, 3], [], getCell)).toEqual([0, 1, 2, 3]);
  });

  it('エラー・警告のある行だけに絞る（FR-SRT-06）', () => {
    const issues = new Set([1, 3]);
    expect(visibleRows([0, 1, 2, 3], [], getCell, { onlyRowsWithIssues: true, rowHasIssue: (r) => issues.has(r) })).toEqual([1, 3]);
    expect(
      visibleRows([0, 1, 2, 3], [{ col: 1, condition: { type: 'range', max: 750 } }], getCell, {
        onlyRowsWithIssues: true,
        rowHasIssue: (r) => issues.has(r),
      }),
    ).toEqual([3]);
  });
});
