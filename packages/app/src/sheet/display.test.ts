import { describe, expect, it } from 'vitest';
import type { CellResult, FieldDef } from '@masterdata-maker/core';
import { DateTimeValue, EMPTY, FList, FormulaError } from '@masterdata-maker/core';
import { cellDisplay } from './display';

const field = (type: FieldDef['type']): FieldDef => ({ name: 'x', type });
const value = (raw: CellResult['raw'], v: CellResult['value'] = raw as CellResult['value']): CellResult => ({ value: v, raw, source: 'value' });

describe('セルの表示（FR-FML-13、P-16）', () => {
  it('数値は右寄せ。小数は有効数字 15 桁、int64 は桁を落とさない', () => {
    expect(cellDisplay(value(1200), field('int'), 'Asia/Tokyo')).toMatchObject({ text: '1200', align: 'right' });
    expect(cellDisplay(value(0.1 + 0.2), field('float'), 'Asia/Tokyo').text).toBe('0.3');
    expect(cellDisplay(value(9007199254740993n), field('int64'), 'Asia/Tokyo').text).toBe('9007199254740993');
  });

  it('真偽値の列はチェックボックス。未入力はチェックなし', () => {
    expect(cellDisplay(value(true), field('bool'), 'UTC')).toMatchObject({ checkbox: true, align: 'center' });
    expect(cellDisplay({ value: EMPTY, raw: undefined, source: 'empty' }, field('bool'), 'UTC').checkbox).toBe(false);
    // 型に合わない値はそのまま文字で出す（検査でエラーになる）
    expect(cellDisplay(value('abc'), field('bool'), 'UTC')).toMatchObject({ checkbox: null, text: 'abc' });
  });

  it('日時はプロジェクトのタイムゾーンで表示する。リストは「, 」でつなぐ', () => {
    const iso = '2026-10-13T12:00:00+09:00';
    expect(cellDisplay(value(iso, new DateTimeValue(Date.parse(iso))), field('datetime'), 'Asia/Tokyo')).toMatchObject({
      text: '2026-10-13 12:00:00',
      align: 'right',
    });
    expect(cellDisplay(value(iso, new DateTimeValue(Date.parse(iso))), field('datetime'), 'UTC').text).toBe('2026-10-13 03:00:00');
    expect(cellDisplay(value([1, 3], new FList([1, 3])), field('list<int>'), 'UTC')).toMatchObject({ text: '1, 3', align: 'left' });
    expect(cellDisplay(value(['a, b', 'c'], new FList(['a, b', 'c'])), field('list<string>'), 'UTC').text).toBe('"a, b", c');
  });

  it('式のエラーはエラー値を赤い文字で出す', () => {
    const e = new FormulaError('#DIV/0!', 'formula.divByZero');
    expect(cellDisplay({ value: e, raw: undefined, source: 'formula', error: e }, field('int'), 'UTC')).toMatchObject({
      text: '#DIV/0!',
      error: true,
      source: 'formula',
    });
  });
});
