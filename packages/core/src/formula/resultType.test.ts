import { describe, expect, test } from 'vitest';
import { parseIsoOffset } from '../util/datetime';
import { checkResultType, rawToValue } from './resultType';
import { ev } from './test-scope';
import { DateTimeValue, EMPTY, FList, FormulaError } from './values';
import type { FieldType, ResultTypeCheck, ResultTypeOptions } from './resultType';
import type { FValue } from './values';

const TZ: ResultTypeOptions = { timeZone: 'Asia/Tokyo', enumValues: ['N', 'R', 'SR', 'SSR'] };

function ok(v: FValue, t: FieldType, o: ResultTypeOptions = TZ): unknown {
  const r = checkResultType(v, t, o);
  if (!r.ok) throw new Error(`${r.error.messageCode} ${JSON.stringify(r.error.messageArgs)}`);
  return r.raw;
}

function ng(v: FValue, t: FieldType, o: ResultTypeOptions = TZ): FormulaError {
  const r: ResultTypeCheck = checkResultType(v, t, o);
  if (r.ok) throw new Error(`expected an error: ${String(r.raw)}`);
  return r.error;
}

const list = (...items: FList['items']) => new FList(items);

describe('checkResultType', () => {
  test('int: 安全な整数の number。1.5 はエラーにし、丸めない（FR-FML-12）', () => {
    expect(ok(1200, 'int')).toBe(1200);
    expect(ok(ev('=IF(rarity = "SSR", hp * 2, hp)', { rarity: 'SSR', hp: 1200 }), 'int')).toBe(2400);
    expect(ng(1.5, 'int')).toMatchObject({ code: '#VALUE!', messageCode: 'formula.result.notInteger', messageArgs: { expected: 'int', value: '1.5' } });
    expect(ng(2 ** 53, 'int')).toMatchObject({ code: '#NUM!', messageCode: 'formula.result.outOfRange' });
    expect(ng('1', 'int')).toMatchObject({ messageCode: 'formula.result.typeMismatch', messageArgs: { expected: 'int', actual: 'string' } });
    expect(ng(true, 'int')).toMatchObject({ messageArgs: { actual: 'bool' } });
    expect(Object.is(ok(-0, 'int'), 0)).toBe(true);
  });

  test('int: 安全な範囲の bigint は number にして受け入れる（判断）', () => {
    expect(ok(5n, 'int')).toBe(5);
    expect(ng(9007199254740993n, 'int')).toMatchObject({ messageCode: 'formula.result.outOfRange' });
  });

  test('int64: bigint か、安全な整数の number（bigint にする。P-13）', () => {
    expect(ok(9007199254740993n, 'int64')).toBe(9007199254740993n);
    expect(ok(1000, 'int64')).toBe(1000n);
    expect(ng(1.5, 'int64')).toMatchObject({ messageCode: 'formula.result.notInteger' });
    expect(ng(2 ** 60, 'int64')).toMatchObject({ messageCode: 'formula.result.outOfRange' });
    expect(ng(9223372036854775808n, 'int64')).toMatchObject({ code: '#NUM!', messageCode: 'formula.result.outOfRange' });
    expect(ng('1', 'int64')).toMatchObject({ messageCode: 'formula.result.typeMismatch' });
  });

  test('float: number（安全な範囲の bigint は number にする）', () => {
    expect(ok(1.5, 'float')).toBe(1.5);
    expect(ok(ev('hp * (1 + defense / 100)', { hp: 800, defense: 30 }), 'float')).toBe(1040);
    expect(ok(3n, 'float')).toBe(3);
    expect(ng(9007199254740993n, 'float')).toMatchObject({ messageCode: 'formula.result.outOfRange' });
    expect(ng('1.5', 'float')).toMatchObject({ messageCode: 'formula.result.typeMismatch' });
  });

  test('string: 文字列だけ（数値はエラー。TO_TEXT で包む）。"" は未入力', () => {
    expect(ok('勇者', 'string')).toBe('勇者');
    expect(ng(1, 'string')).toMatchObject({ messageCode: 'formula.result.typeMismatch', messageArgs: { expected: 'string', actual: 'int' } });
    expect(ok(ev('=TO_TEXT(1)'), 'string')).toBe('1');
    expect(ok('', 'string')).toBeUndefined();
  });

  test('bool: 真偽値だけ', () => {
    expect(ok(true, 'bool')).toBe(true);
    expect(ok(ev('=AND(1 < 2, TRUE)'), 'bool')).toBe(true);
    expect(ng(1, 'bool')).toMatchObject({ messageCode: 'formula.result.typeMismatch' });
    expect(ng('TRUE', 'bool')).toMatchObject({ messageCode: 'formula.result.typeMismatch' });
  });

  test('enum: 値の一覧に含まれる文字列（完全一致）', () => {
    expect(ok('SSR', 'enum')).toBe('SSR');
    expect(ng('ssr', 'enum')).toMatchObject({ messageCode: 'formula.result.notInEnum', messageArgs: { value: 'ssr' } });
    expect(ng('UR', 'enum')).toMatchObject({ code: '#VALUE!', messageCode: 'formula.result.notInEnum' });
    expect(ng('SSR', 'enum', { timeZone: 'UTC' })).toMatchObject({ messageCode: 'formula.result.notInEnum' });
    expect(ng(1, 'enum')).toMatchObject({ messageCode: 'formula.result.typeMismatch' });
  });

  test('datetime: 時差付きの ISO 8601（秒まで。options.timeZone の時差）', () => {
    expect(ok(ev('=DATE(2026, 10, 13) + 0.5'), 'datetime')).toBe('2026-10-13T12:00:00+09:00');
    expect(ok(ev('=DATE(2026, 7, 1)', {}, { timeZone: 'America/New_York' }), 'datetime', { timeZone: 'America/New_York' })).toBe(
      '2026-07-01T00:00:00-04:00',
    );
    expect(ng(46308, 'datetime')).toMatchObject({ messageCode: 'formula.result.typeMismatch', messageArgs: { actual: 'int' } });
    expect(ng('2026-10-13T12:00:00+09:00', 'datetime')).toMatchObject({ messageCode: 'formula.result.typeMismatch' });
  });

  test('list<T>: FList で、各要素が T', () => {
    expect(ok(list(1, 2, 3), 'list<int>')).toEqual([1, 2, 3]);
    expect(ok(list(1.5, 2n), 'list<float>')).toEqual([1.5, 2]);
    expect(ok(list('a', 'b'), 'list<string>')).toEqual(['a', 'b']);
    expect(ok(list('N', 'SSR'), 'list<enum>')).toEqual(['N', 'SSR']);
    expect(ng(list(1, 1.5), 'list<int>')).toMatchObject({
      messageCode: 'formula.result.listElementNotInteger',
      messageArgs: { index: 2, expected: 'int', value: '1.5' },
    });
    expect(ng(list('a', 1), 'list<string>')).toMatchObject({
      messageCode: 'formula.result.listElementTypeMismatch',
      messageArgs: { index: 2, expected: 'string', actual: 'int' },
    });
    expect(ng(list('N', 'X'), 'list<enum>')).toMatchObject({
      messageCode: 'formula.result.listElementNotInEnum',
      messageArgs: { index: 2, value: 'X' },
    });
    expect(ng(list(1, 2 ** 53), 'list<int>')).toMatchObject({ messageCode: 'formula.result.listElementOutOfRange' });
    expect(ng(list(1, EMPTY), 'list<int>')).toMatchObject({ messageCode: 'formula.result.listElementEmpty', messageArgs: { index: 2 } });
    expect(ng(list('a', ''), 'list<string>')).toMatchObject({ messageCode: 'formula.result.listElementEmpty' });
    const inner = new FormulaError('#N/A', 'formula.ref.keyNotFound');
    expect(ng(list(1, inner), 'list<int>')).toBe(inner);
  });

  test('list<T> に単独の値、単独の型にリストはエラー', () => {
    expect(ng(1, 'list<int>')).toMatchObject({ messageCode: 'formula.result.typeMismatch', messageArgs: { expected: 'list<int>', actual: 'int' } });
    expect(ng(list(1), 'int')).toMatchObject({ messageCode: 'formula.result.typeMismatch', messageArgs: { expected: 'int', actual: 'list' } });
  });

  test('空のリストと EMPTY は未入力', () => {
    expect(ok(list(), 'list<int>')).toBeUndefined();
    for (const t of ['int', 'int64', 'float', 'string', 'bool', 'enum', 'datetime', 'list<int>'] as const) {
      expect(ok(EMPTY, t)).toBeUndefined();
    }
  });

  test('FormulaError はそのエラー', () => {
    const e = new FormulaError('#DIV/0!', 'formula.divByZero', {}, 0, 3);
    expect(ng(e, 'int')).toBe(e);
    expect(ng(ev('=1/0'), 'float')).toMatchObject({ code: '#DIV/0!' });
  });
});

describe('rawToValue', () => {
  test('未入力は EMPTY、配列は FList', () => {
    expect(rawToValue(undefined, 'int')).toBe(EMPTY);
    const l = rawToValue([1, 3], 'list<int>');
    expect(l).toBeInstanceOf(FList);
    expect((l as FList).items).toEqual([1, 3]);
  });

  test('datetime 列の文字列は DateTimeValue', () => {
    const v = rawToValue('2026-10-13T12:00:00+09:00', 'datetime');
    expect(v).toBeInstanceOf(DateTimeValue);
    expect((v as DateTimeValue).epochMs).toBe(parseIsoOffset('2026-10-13T12:00:00+09:00')?.epochMs);
    expect(rawToValue('2026-10-13', 'datetime')).toMatchObject({ code: '#VALUE!', messageCode: 'formula.invalidDateTime' });
  });

  test('int64 列の整数の number は bigint。型に合わない値はそのまま', () => {
    expect(rawToValue(5, 'int64')).toBe(5n);
    expect(rawToValue(9007199254740993n, 'int64')).toBe(9007199254740993n);
    expect(rawToValue('abc', 'int')).toBe('abc');
    expect(rawToValue('SSR', 'enum')).toBe('SSR');
  });

  test('評価に使える', () => {
    expect(ev('=SUM(costs) + base', { costs: rawToValue([1, 2], 'list<int>'), base: rawToValue(9007199254740993n, 'int64') })).toBe(
      9007199254740996n,
    );
  });
});
