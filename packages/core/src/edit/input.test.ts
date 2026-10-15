import { describe, expect, it } from 'vitest';
import type { FieldDef, FieldType } from '../model/field';
import { RichCell } from '../model/cell';
import { EditCode } from './codes';
import type { InputContext, ParsedInput } from './input';
import { cellEditText, convertValue, formatValueText, keepSameInstant, parseCellInput } from './input';

const ctx: InputContext = {
  enums: [
    { name: 'rarity', values: ['N', 'R', 'SR', 'SSR'] },
    { name: 'element', values: ['火', '水'] },
    { name: 'mixed', values: ['Ab', 'aB'] },
  ],
  timeZone: 'Asia/Tokyo',
};

function f(type: FieldType, enum_ref?: string): FieldDef {
  return enum_ref === undefined ? { name: 'x', type } : { name: 'x', type, enum_ref };
}

function value(r: ParsedInput): unknown {
  if (!r.ok) throw new Error(`失敗: ${r.error.code} ${JSON.stringify(r.error.params)}`);
  return r.kind === 'value' ? r.value : r.kind;
}

function code(r: ParsedInput): string {
  if (r.ok) throw new Error(`成功してしまった: ${JSON.stringify(r)}`);
  return r.error.code;
}

describe('共通の規則（FR-EDT-04、DR-15）', () => {
  it('空のテキストは未入力。string 以外は空白だけでも未入力', () => {
    for (const type of ['int', 'float', 'bool', 'enum', 'datetime', 'list<int>', 'list<string>'] as FieldType[]) {
      expect(parseCellInput('', f(type, 'rarity'), ctx)).toEqual({ ok: true, kind: 'empty' });
      expect(parseCellInput('  ', f(type, 'rarity'), ctx)).toEqual({ ok: true, kind: 'empty' });
    }
    expect(parseCellInput('', f('string'), ctx)).toEqual({ ok: true, kind: 'empty' });
    expect(value(parseCellInput('  ', f('string'), ctx))).toBe('  ');
  });

  it('= で始まればセル単位式（= を除いて保存する）。構文エラーの式も受け付ける', () => {
    expect(parseCellInput('=hp * 2', f('int'), ctx)).toEqual({ ok: true, kind: 'formula', formula: 'hp * 2' });
    expect(parseCellInput('=IF(', f('string'), ctx)).toEqual({ ok: true, kind: 'formula', formula: 'IF(' });
    expect(code(parseCellInput('=', f('int'), ctx))).toBe(EditCode.emptyFormula);
    expect(code(parseCellInput('=  ', f('int'), ctx))).toBe(EditCode.emptyFormula);
  });

  it("先頭の ' は式ではない文字列の印。string 列ではそのまま、他の型では後ろを変換する", () => {
    expect(value(parseCellInput("'=hp*2", f('string'), ctx))).toBe('=hp*2');
    expect(value(parseCellInput("''abc", f('string'), ctx))).toBe("'abc");
    expect(parseCellInput("'", f('string'), ctx)).toEqual({ ok: true, kind: 'empty' });
    expect(value(parseCellInput("'12", f('int'), ctx))).toBe(12);
    expect(code(parseCellInput("'=1", f('int'), ctx))).toBe(EditCode.notInt);
    expect(value(parseCellInput("'=a, b", f('list<string>'), ctx))).toEqual(['=a', 'b']);
  });

  it('value モードでは = と \' を特別に扱わない', () => {
    expect(value(parseCellInput('=hp', f('string'), ctx, 'value'))).toBe('=hp');
    expect(value(parseCellInput("'abc", f('string'), ctx, 'value'))).toBe("'abc");
  });
});

describe('int（DR-36）', () => {
  it('整数を受け付ける', () => {
    expect(value(parseCellInput('12', f('int'), ctx))).toBe(12);
    expect(value(parseCellInput(' -7 ', f('int'), ctx))).toBe(-7);
    expect(value(parseCellInput('+3', f('int'), ctx))).toBe(3);
    expect(value(parseCellInput('1,000', f('int'), ctx))).toBe(1000);
    expect(value(parseCellInput('1.0', f('int'), ctx))).toBe(1);
    expect(value(parseCellInput('1e3', f('int'), ctx))).toBe(1000);
    expect(value(parseCellInput('1.5e1', f('int'), ctx))).toBe(15);
    expect(Object.is(value(parseCellInput('-0', f('int'), ctx)), 0)).toBe(true);
    expect(value(parseCellInput('9007199254740991', f('int'), ctx))).toBe(9007199254740991);
  });

  it('FR-EDT-05: 12a は「整数を入力してください」', () => {
    const r = parseCellInput('12a', f('int'), ctx);
    expect(r).toEqual({
      ok: false,
      error: { code: EditCode.notInt, hint: EditCode.hintInt, params: { input: '12a' } },
    });
    expect(code(parseCellInput('1.5', f('int'), ctx))).toBe(EditCode.notInt);
    expect(code(parseCellInput('abc', f('int'), ctx))).toBe(EditCode.notInt);
    expect(code(parseCellInput('TRUE', f('int'), ctx))).toBe(EditCode.notInt);
    expect(code(parseCellInput('50%', f('int'), ctx))).toBe(EditCode.notInt);
    expect(code(parseCellInput('1,00', f('int'), ctx))).toBe(EditCode.notInt);
  });

  it('安全な整数の範囲を超えたら失敗（int64 の列にする）', () => {
    expect(code(parseCellInput('9007199254740992', f('int'), ctx))).toBe(EditCode.intOutOfRange);
    expect(code(parseCellInput('-9007199254740992', f('int'), ctx))).toBe(EditCode.intOutOfRange);
    expect(code(parseCellInput('1e400', f('int'), ctx))).toBe(EditCode.intOutOfRange);
  });
});

describe('int64（DR-19）', () => {
  it('BigInt で精度を落とさずに受け付ける', () => {
    expect(value(parseCellInput('9007199254740993', f('int64'), ctx))).toBe(9007199254740993n);
    expect(value(parseCellInput('9223372036854775807', f('int64'), ctx))).toBe(9223372036854775807n);
    expect(value(parseCellInput('-9223372036854775807', f('int64'), ctx))).toBe(-9223372036854775807n);
    expect(value(parseCellInput('12', f('int64'), ctx))).toBe(12n);
    expect(value(parseCellInput('1.234567890123456789e18', f('int64'), ctx))).toBe(1234567890123456789n);
  });

  it('範囲外・整数でないものは失敗', () => {
    expect(code(parseCellInput('9223372036854775808', f('int64'), ctx))).toBe(EditCode.int64OutOfRange);
    expect(code(parseCellInput('-9223372036854775808', f('int64'), ctx))).toBe(EditCode.int64OutOfRange);
    expect(code(parseCellInput('1.5', f('int64'), ctx))).toBe(EditCode.notInt);
    expect(code(parseCellInput('x', f('int64'), ctx))).toBe(EditCode.notInt);
  });
});

describe('float（DR-35）', () => {
  it('小数・指数・百分率を受け付ける', () => {
    expect(value(parseCellInput('1.5', f('float'), ctx))).toBe(1.5);
    expect(value(parseCellInput('.5', f('float'), ctx))).toBe(0.5);
    expect(value(parseCellInput('1e-3', f('float'), ctx))).toBe(0.001);
    expect(value(parseCellInput('50%', f('float'), ctx))).toBe(0.5);
    expect(value(parseCellInput('1,234.5', f('float'), ctx))).toBe(1234.5);
    expect(Object.is(value(parseCellInput('-0', f('float'), ctx)), 0)).toBe(true);
  });

  it('NaN と無限大は拒否する', () => {
    expect(code(parseCellInput('NaN', f('float'), ctx))).toBe(EditCode.notNumber);
    expect(code(parseCellInput('Infinity', f('float'), ctx))).toBe(EditCode.notNumber);
    expect(code(parseCellInput('1e400', f('float'), ctx))).toBe(EditCode.numberOutOfRange);
    expect(code(parseCellInput('1.2.3', f('float'), ctx))).toBe(EditCode.notNumber);
  });
});

describe('bool（P-17）', () => {
  it('TRUE / FALSE（大文字と小文字は問わない）と 1 / 0', () => {
    expect(value(parseCellInput('TRUE', f('bool'), ctx))).toBe(true);
    expect(value(parseCellInput('true', f('bool'), ctx))).toBe(true);
    expect(value(parseCellInput('False', f('bool'), ctx))).toBe(false);
    expect(value(parseCellInput('1', f('bool'), ctx))).toBe(true);
    expect(value(parseCellInput(' 0 ', f('bool'), ctx))).toBe(false);
    expect(code(parseCellInput('yes', f('bool'), ctx))).toBe(EditCode.notBool);
    expect(code(parseCellInput('2', f('bool'), ctx))).toBe(EditCode.notBool);
  });
});

describe('enum（P-18）', () => {
  it('完全に一致するか、大文字と小文字を無視して 1 つだけ一致すれば、定義された値にする', () => {
    expect(value(parseCellInput('SSR', f('enum', 'rarity'), ctx))).toBe('SSR');
    expect(value(parseCellInput('ssr', f('enum', 'rarity'), ctx))).toBe('SSR');
    expect(value(parseCellInput(' sr ', f('enum', 'rarity'), ctx))).toBe('SR');
    expect(value(parseCellInput('Ab', f('enum', 'mixed'), ctx))).toBe('Ab');
  });

  it('一致しない・複数に一致するなら失敗', () => {
    const r = parseCellInput('UR', f('enum', 'rarity'), ctx);
    expect(r).toEqual({
      ok: false,
      error: { code: EditCode.notEnum, hint: EditCode.hintEnum, params: { input: 'UR', enum: 'rarity', values: 'N, R, SR, SSR' } },
    });
    expect(code(parseCellInput('ab', f('enum', 'mixed'), ctx))).toBe(EditCode.enumAmbiguous);
  });

  it('列挙型が定義されていなければ照合できないので、そのまま受け付ける', () => {
    expect(value(parseCellInput(' x ', f('enum', 'nothing'), ctx))).toBe('x');
  });
});

describe('datetime（P-19、DR-18）', () => {
  it('時差が無ければプロジェクトのタイムゾーンで解釈し、その時差を付ける', () => {
    expect(value(parseCellInput('2026-10-13', f('datetime'), ctx))).toBe('2026-10-13T00:00:00+09:00');
    expect(value(parseCellInput('2026-10-13 12:00', f('datetime'), ctx))).toBe('2026-10-13T12:00:00+09:00');
    expect(value(parseCellInput('2026/10/13 12:34:56', f('datetime'), ctx))).toBe('2026-10-13T12:34:56+09:00');
    const ny: InputContext = { ...ctx, timeZone: 'America/New_York' };
    expect(value(parseCellInput('2026-07-01 09:00', f('datetime'), ny))).toBe('2026-07-01T09:00:00-04:00');
    expect(value(parseCellInput('2026-12-01 09:00', f('datetime'), ny))).toBe('2026-12-01T09:00:00-05:00');
  });

  it('時差付きの ISO 8601 はその時差のまま保存する', () => {
    expect(value(parseCellInput('2026-10-13T12:00:00+05:30', f('datetime'), ctx))).toBe('2026-10-13T12:00:00+05:30');
    expect(value(parseCellInput('2026-10-13T12:00:00Z', f('datetime'), ctx))).toBe('2026-10-13T12:00:00+00:00');
    expect(value(parseCellInput('2026-10-13T12:00:00.000Z', f('datetime'), ctx))).toBe('2026-10-13T12:00:00+00:00');
  });

  it('日時でない・秒未満を含むものは失敗', () => {
    expect(code(parseCellInput('2026-02-30', f('datetime'), ctx))).toBe(EditCode.notDateTime);
    expect(code(parseCellInput('tomorrow', f('datetime'), ctx))).toBe(EditCode.notDateTime);
    expect(code(parseCellInput('2026-10-13T12:00:00.5Z', f('datetime'), ctx))).toBe(EditCode.dateTimeSubsecond);
  });

  it('同じ瞬間なら既存の値の時差を保つ', () => {
    expect(keepSameInstant('2026-10-13T12:00:00+09:00', '2026-10-13T03:00:00+00:00', 'datetime')).toBe('2026-10-13T03:00:00+00:00');
    expect(keepSameInstant('2026-10-13T12:00:01+09:00', '2026-10-13T03:00:00+00:00', 'datetime')).toBe('2026-10-13T12:00:01+09:00');
    expect(keepSameInstant('x', 'y', 'string')).toBe('x');
  });
});

describe('リスト（P-16）', () => {
  it('要素を , で区切り、要素ごとに変換する', () => {
    expect(value(parseCellInput('1, 3, 7', f('list<int>'), ctx))).toEqual([1, 3, 7]);
    expect(value(parseCellInput('1,3', f('list<int>'), ctx))).toEqual([1, 3]);
    expect(value(parseCellInput('0.5, 2', f('list<float>'), ctx))).toEqual([0.5, 2]);
    expect(value(parseCellInput('"a, b", c, " d "', f('list<string>'), ctx))).toEqual(['a, b', 'c', ' d ']);
    expect(value(parseCellInput('火, 水', f('list<enum>', 'element'), ctx))).toEqual(['火', '水']);
    expect(value(parseCellInput('5', f('list<int>'), ctx))).toEqual([5]);
  });

  it('要素の失敗は位置付きで返す', () => {
    const r = parseCellInput('1, x, 3', f('list<int>'), ctx);
    expect(r).toEqual({ ok: false, error: { code: EditCode.notInt, hint: EditCode.hintInt, params: { input: 'x' }, index: 2 } });
    const e = parseCellInput('火, 土', f('list<enum>', 'element'), ctx);
    expect(e.ok ? null : [e.error.code, e.error.index]).toEqual([EditCode.notEnum, 2]);
  });
});

describe('値 → テキスト', () => {
  it('datetime はタイムゾーンの表示形式、リストは P-16 の表記、真偽値は TRUE / FALSE', () => {
    expect(formatValueText('2026-10-13T12:00:00+09:00', 'datetime', 'Asia/Tokyo')).toBe('2026-10-13 12:00:00');
    expect(formatValueText('2026-10-13T03:00:00+00:00', 'datetime', 'Asia/Tokyo')).toBe('2026-10-13 12:00:00');
    expect(formatValueText([1, 3, 7], 'list<int>', 'Asia/Tokyo')).toBe('1, 3, 7');
    expect(formatValueText(['a, b', 'c'], 'list<string>', 'Asia/Tokyo')).toBe('"a, b", c');
    expect(formatValueText(true, 'bool', 'Asia/Tokyo')).toBe('TRUE');
    expect(formatValueText(9007199254740993n, 'int64', 'Asia/Tokyo')).toBe('9007199254740993');
    expect(formatValueText(0.1, 'float', 'Asia/Tokyo')).toBe('0.1');
    expect(formatValueText('not a date', 'datetime', 'Asia/Tokyo')).toBe('not a date');
  });

  it('編集用のテキスト: 式は = 付き、= や \' で始まる値には \' を付ける', () => {
    const tz = 'Asia/Tokyo';
    expect(cellEditText(undefined, f('int'), tz)).toBe('');
    expect(cellEditText(12, f('int'), tz)).toBe('12');
    expect(cellEditText(new RichCell({ override: 'hp * 2' }), f('int'), tz)).toBe('=hp * 2');
    // 値があれば値が優先される（FR-FML-01）
    expect(cellEditText(new RichCell({ value: 800, override: 'hp * 2' }), f('int'), tz)).toBe('800');
    expect(cellEditText(new RichCell({ value: 800, color: 'red' }), f('int'), tz)).toBe('800');
    expect(cellEditText('=abc', f('string'), tz)).toBe("'=abc");
    expect(cellEditText("'abc", f('string'), tz)).toBe("''abc");
    expect(cellEditText(['=a'], f('list<string>'), tz)).toBe("'=a");
  });

  it('編集用のテキストを入力し直すと同じ値に戻る', () => {
    const tz = 'Asia/Tokyo';
    const cases: [unknown, FieldDef][] = [
      [12, f('int')],
      [9007199254740993n, f('int64')],
      [0.30000000000000004, f('float')],
      [1e21, f('float')],
      [false, f('bool')],
      ['SSR', f('enum', 'rarity')],
      ['2026-10-13T12:00:00+09:00', f('datetime')],
      [[1, 3, 7], f('list<int>')],
      [['a, b', ' c', '"q"', ''], f('list<string>')],
      ['=abc', f('string')],
      ["'x", f('string')],
      ['line1\nline2', f('string')],
    ];
    for (const [v, field] of cases) {
      const text = cellEditText(v as never, field, tz);
      expect(value(parseCellInput(text, field, { ...ctx, timeZone: tz })), text).toEqual(v);
    }
  });
});

describe('convertValue（型の変換）', () => {
  it('同じ型ならそのまま（型に合わない値も保つ）', () => {
    expect(convertValue('abc', f('int'), f('int'), ctx)).toEqual({ ok: true, value: 'abc' });
    expect(convertValue('2026-10-13T03:00:00+00:00', f('datetime'), f('datetime'), ctx)).toEqual({
      ok: true,
      value: '2026-10-13T03:00:00+00:00',
    });
  });

  it('違う型なら表示用のテキストを経て変換する', () => {
    expect(convertValue(12, f('int'), f('float'), ctx)).toEqual({ ok: true, value: 12 });
    expect(convertValue(12, f('int'), f('string'), ctx)).toEqual({ ok: true, value: '12' });
    expect(convertValue('12', f('string'), f('int64'), ctx)).toEqual({ ok: true, value: 12n });
    expect(convertValue(5, f('int'), f('list<int>'), ctx)).toEqual({ ok: true, value: [5] });
    expect(convertValue([5], f('list<int>'), f('int'), ctx)).toEqual({ ok: true, value: 5 });
    expect(convertValue('2026-10-13T12:00:00+09:00', f('datetime'), f('string'), ctx)).toEqual({ ok: true, value: '2026-10-13 12:00:00' });
    expect(convertValue('=x', f('string'), f('list<string>'), ctx)).toEqual({ ok: true, value: ['=x'] });
    expect(convertValue('ssr', f('string'), f('enum', 'rarity'), ctx)).toEqual({ ok: true, value: 'SSR' });
  });

  it('変換できなければ失敗とテキスト', () => {
    expect(convertValue(1.5, f('float'), f('int'), ctx)).toEqual({
      ok: false,
      text: '1.5',
      error: { code: EditCode.notInt, hint: EditCode.hintInt, params: { input: '1.5' } },
    });
    const r = convertValue([1, 2], f('list<int>'), f('int'), ctx);
    expect(r.ok ? null : r.text).toBe('1, 2');
    expect(convertValue('SSR', f('enum', 'rarity'), f('enum', 'element'), ctx).ok).toBe(false);
  });
});
