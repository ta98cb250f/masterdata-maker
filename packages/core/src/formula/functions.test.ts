// 関数のテスト。期待値に「公式」とあるものは Googleスプレッドシートの公式ヘルプの例（検索結果の要約で確認）。
// 「未検証」とあるものは、Googleスプレッドシートの挙動を確かめられず、Excel の規則などから決めたもの
import { describe, expect, test } from 'vitest';
import { parseIsoOffset } from '../util/datetime';
import { FUNCTION_NAMES } from './functions';
import { ev } from './test-scope';
import { DateTimeValue, EMPTY, FList, FormulaError } from './values';
import type { ErrorCode, FValue } from './values';

function expectError(v: FValue, code: ErrorCode, messageCode?: string): FormulaError {
  expect(v).toBeInstanceOf(FormulaError);
  const e = v as FormulaError;
  expect(e.code).toBe(code);
  if (messageCode !== undefined) expect(e.messageCode).toBe(messageCode);
  return e;
}

function dt(iso: string): DateTimeValue {
  const p = parseIsoOffset(iso);
  if (p === null) throw new Error(iso);
  return new DateTimeValue(p.epochMs);
}

const list = (...items: FList['items']) => new FList(items);

test('要件書 §7 の関数がすべてある', () => {
  expect(FUNCTION_NAMES).toEqual(
    [
      'IF', 'AND', 'OR', 'NOT',
      'SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'COUNTIF',
      'ABS', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'FLOOR', 'CEILING', 'INT', 'MOD', 'POWER', 'SQRT',
      'CONCATENATE', 'LEN', 'LEFT', 'RIGHT', 'MID', 'UPPER', 'LOWER', 'TRIM', 'SUBSTITUTE',
      'VALUE', 'TO_TEXT',
      'DATE', 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND',
      'REF',
    ].sort(),
  );
});

describe('IF', () => {
  test('選ばれなかった側を評価しない', () => {
    expect(ev('=IF(TRUE, 1, 1/0)')).toBe(1);
    expect(ev('=IF(FALSE, 1/0, 2)')).toBe(2);
    expect(ev('=IF(FALSE, 1/0)')).toBe(false);
  });

  test('偽を省略して条件が偽なら FALSE（公式ヘルプは「既定は空」と書くが、spec に従い FALSE。未検証）', () => {
    expect(ev('=IF(1 > 2, "yes")')).toBe(false);
    expect(ev('=IF(1 < 2, "yes")')).toBe('yes');
  });

  test('省略された引数は未入力', () => {
    expect(ev('=IF(TRUE,,1)')).toBe(EMPTY);
  });

  test('条件の変換: 数値は 0 以外が TRUE、未入力は FALSE、文字列は "TRUE" / "FALSE" だけ', () => {
    expect(ev('=IF(2, "t", "f")')).toBe('t');
    expect(ev('=IF(0, "t", "f")')).toBe('f');
    expect(ev('=IF(x, "t", "f")', { x: EMPTY })).toBe('f');
    expect(ev('=IF("true", "t", "f")')).toBe('t');
    expect(ev('=IF("False", "t", "f")')).toBe('f');
    expect(ev('=IF(b, "t", "f")', { b: 0n })).toBe('f');
    const e = expectError(ev('=IF("abc", 1, 2)'), '#VALUE!', 'formula.argNotBoolean');
    expect(e.messageArgs).toEqual({ name: 'IF', index: 1, value: 'abc' });
    expectError(ev('=IF(1/0, 1, 2)'), '#DIV/0!');
    expectError(ev('=IF(l, 1, 2)', { l: list(true) }), '#VALUE!', 'formula.listAsScalar');
  });
});

describe('AND / OR / NOT', () => {
  test('基本', () => {
    expect(ev('=AND(TRUE, TRUE)')).toBe(true);
    expect(ev('=AND(TRUE, FALSE)')).toBe(false);
    expect(ev('=OR(FALSE, TRUE)')).toBe(true);
    expect(ev('=OR(FALSE, FALSE)')).toBe(false);
    expect(ev('=AND(1, 2)')).toBe(true);
    expect(ev('=OR(0, 0)')).toBe(false);
    expect(ev('=NOT(TRUE)')).toBe(false);
    expect(ev('=NOT(0)')).toBe(true);
    expect(ev('=NOT(x)', { x: EMPTY })).toBe(true);
    expect(ev('=AND("TRUE", "true")')).toBe(true);
  });

  test('短絡しない: 全引数を評価し、エラーを伝える（未検証。Excel の規則）', () => {
    expectError(ev('=AND(FALSE, 1/0)'), '#DIV/0!');
    expectError(ev('=OR(TRUE, 1/0)'), '#DIV/0!');
  });

  test('範囲の中の文字列と空は無視し、直接の文字列は #VALUE!（未検証。Excel の規則）', () => {
    expect(ev('=AND(flags)', { flags: list(true, 'x', EMPTY, 1) })).toBe(true);
    expect(ev('=OR(flags)', { flags: list(false, 'TRUE', 0) })).toBe(false);
    expect(ev('=AND(name, TRUE)', { name: 'abc' })).toBe(true);
    const e = expectError(ev('=AND(TRUE, "abc")'), '#VALUE!', 'formula.argNotBoolean');
    expect(e.messageArgs).toEqual({ name: 'AND', index: 2, value: 'abc' });
    expectError(ev('=NOT("abc")'), '#VALUE!', 'formula.argNotBoolean');
    expectError(ev('=AND(flags)', { flags: list(true, new FormulaError('#N/A', 'formula.ref.keyNotFound')) }), '#N/A');
  });

  test('論理値が 1 つも無ければ #VALUE!（未検証。Excel の規則）', () => {
    expectError(ev('=AND(flags)', { flags: list('a', EMPTY) }), '#VALUE!', 'formula.noLogicalValues');
    expectError(ev('=OR(x)', { x: EMPTY }), '#VALUE!', 'formula.noLogicalValues');
    expectError(ev('=AND(flags)', { flags: list() }), '#VALUE!', 'formula.noLogicalValues');
  });
});

describe('SUM', () => {
  test('直接の引数: 数値、真偽値は 1/0、数値として読める文字列', () => {
    expect(ev('=SUM(1, 2, 3)')).toBe(6);
    expect(ev('=SUM(1, "2", TRUE)')).toBe(4);
    expect(ev('=SUM(x, 1)', { x: EMPTY })).toBe(1);
    const e = expectError(ev('=SUM(1, "abc")'), '#VALUE!', 'formula.argNotNumber');
    expect(e.messageArgs).toEqual({ name: 'SUM', index: 2, value: 'abc' });
  });

  test('範囲（リストと列の参照）の中では数値だけを足す', () => {
    expect(ev('=SUM(costs)', { costs: list(1, 2, 3) })).toBe(6);
    expect(ev('=SUM(costs, 10)', { costs: list(1, '2', true, EMPTY, 3) })).toBe(14);
    expect(ev('=SUM(costs)', { costs: list() })).toBe(0);
    // 列の参照はセル参照と同じに扱う（Googleスプレッドシートの SUM(A1) で A1 が文字列なら 0）
    expect(ev('=SUM(name)', { name: 'abc' })).toBe(0);
    expect(ev('=SUM((name))', { name: '5' })).toBe(0);
    expect(ev('=SUM(name & "")', { name: '5' })).toBe(5);
  });

  test('エラーは伝える', () => {
    expectError(ev('=SUM(1, 1/0)'), '#DIV/0!');
    expectError(ev('=SUM(costs)', { costs: list(1, new FormulaError('#N/A', 'formula.ref.keyNotFound')) }), '#N/A');
  });

  test('bigint が混ざれば BigInt で合計し、小数と混ざれば #VALUE!', () => {
    expect(ev('=SUM(a, b)', { a: 9007199254740993n, b: 1 })).toBe(9007199254740994n);
    expect(ev('=SUM(xs)', { xs: list(9007199254740993n, 9007199254740993n) })).toBe(18014398509481986n);
    expectError(ev('=SUM(a, 0.5)', { a: 1n }), '#VALUE!', 'formula.int64MixedWithFloat');
    expectError(ev('=SUM(xs)', { xs: list(9223372036854775807n, 1n) }), '#NUM!', 'formula.int64Overflow');
  });

  test('日時はシリアル値として足す', () => {
    expect(ev('=SUM(DATE(2026,10,13), 1)')).toBe(46309);
  });
});

describe('AVERAGE', () => {
  test('基本と範囲', () => {
    expect(ev('=AVERAGE(1, 2, 3, 4)')).toBe(2.5);
    expect(ev('=AVERAGE(xs)', { xs: list(1, 'a', EMPTY, true, 3) })).toBe(2);
    expect(ev('=AVERAGE(xs, TRUE)', { xs: list(2) })).toBe(1.5);
  });

  test('数値が無ければ #DIV/0!', () => {
    expectError(ev('=AVERAGE(xs)', { xs: list('a') }), '#DIV/0!', 'formula.noNumbers');
    expectError(ev('=AVERAGE(xs)', { xs: list() }), '#DIV/0!');
  });

  test('bigint は割り切れれば bigint、割り切れなければ #NUM!', () => {
    expect(ev('=AVERAGE(xs)', { xs: list(2n, 4n) })).toBe(3n);
    expectError(ev('=AVERAGE(xs)', { xs: list(1n, 2n) }), '#NUM!', 'formula.int64NotDivisible');
  });
});

describe('MIN / MAX', () => {
  test('基本', () => {
    expect(ev('=MIN(3, 1, 2)')).toBe(1);
    expect(ev('=MAX(3, 1, 2)')).toBe(3);
    expect(ev('=MAX(xs)', { xs: list(-5, 'zzz', true, -2) })).toBe(-2);
    expect(ev('=MIN(xs, 10)', { xs: list(20, 'a') })).toBe(10);
    expect(ev('=MAX(-1, TRUE)')).toBe(1);
  });

  test('数値が無ければ 0', () => {
    expect(ev('=MAX(xs)', { xs: list('a', EMPTY) })).toBe(0);
    expect(ev('=MIN(xs)', { xs: list() })).toBe(0);
  });

  test('bigint と number を正確に比べる', () => {
    expect(ev('=MAX(a, b)', { a: 9007199254740993n, b: 9007199254740992 })).toBe(9007199254740993n);
    expect(ev('=MIN(xs)', { xs: list(5n, 3n, 4n) })).toBe(3n);
    expect(ev('=MIN(a, 1.5)', { a: 2n })).toBe(1.5);
  });

  test('エラーと読めない文字列', () => {
    expectError(ev('=MAX(1, 1/0)'), '#DIV/0!');
    expectError(ev('=MIN(1, "x")'), '#VALUE!', 'formula.argNotNumber');
  });
});

describe('COUNT / COUNTA', () => {
  test('COUNT は数値を数える。範囲の中の文字列・真偽値・空・エラーは数えない', () => {
    expect(ev('=COUNT(xs)', { xs: list(1, 'a', true, EMPTY, 2n, new FormulaError('#N/A', 'formula.ref.keyNotFound')) })).toBe(2);
    expect(ev('=COUNT(1, 2, 3)')).toBe(3);
    expect(ev('=COUNT(DATE(2026,1,1))')).toBe(1);
    expect(ev('=COUNT(name)', { name: 'abc' })).toBe(0);
    expect(ev('=COUNT(x)', { x: EMPTY })).toBe(0);
  });

  test('COUNT の直接の引数の真偽値と数値の文字列は数え、エラーは数えない（未検証。Excel の規則）', () => {
    expect(ev('=COUNT(TRUE, "1", "a", 1/0)')).toBe(2);
  });

  test('COUNTA は空でない値を数える（エラーと "" も数える）', () => {
    expect(ev('=COUNTA(xs)', { xs: list(1, 'a', true, EMPTY, new FormulaError('#N/A', 'formula.ref.keyNotFound')) })).toBe(4);
    expect(ev('=COUNTA(x, y, "")', { x: EMPTY, y: 'v' })).toBe(2);
    expect(ev('=COUNTA(1/0)')).toBe(1);
    expect(ev('=COUNTA(xs)', { xs: list() })).toBe(0);
  });
});

describe('COUNTIF', () => {
  const elements = list('火', '水', '火', 'Fire', 'FIRE', EMPTY, '');
  const nums = list(1, 5, 10, 15, '10', true, EMPTY, 20n);

  test('文字列は大文字と小文字を区別しない', () => {
    expect(ev('=COUNTIF(elements, "火")', { elements })).toBe(2);
    expect(ev('=COUNTIF(elements, "fire")', { elements })).toBe(2);
    expect(ev('=COUNTIF(elements, "=FIRE")', { elements })).toBe(2);
    expect(ev('=COUNTIF(elements, "火") > 0', { elements })).toBe(true);
  });

  test('ワイルドカード * ? と ~ によるエスケープ', () => {
    const words = list('apple', 'apricot', 'banana', 'a*b', 'a?b', 'axb', 'ab');
    expect(ev('=COUNTIF(w, "ap*")', { w: words })).toBe(2);
    expect(ev('=COUNTIF(w, "*an*")', { w: words })).toBe(1);
    expect(ev('=COUNTIF(w, "a?b")', { w: words })).toBe(3);
    expect(ev('=COUNTIF(w, "a~*b")', { w: words })).toBe(1);
    expect(ev('=COUNTIF(w, "a~?b")', { w: words })).toBe(1);
    expect(ev('=COUNTIF(w, "*")', { w: words })).toBe(7);
    expect(ev('=COUNTIF(w, "a.b")', { w: words })).toBe(0);
  });

  test('数値の条件と比較演算子', () => {
    expect(ev('=COUNTIF(nums, 10)', { nums })).toBe(1);
    expect(ev('=COUNTIF(nums, ">10")', { nums })).toBe(2);
    expect(ev('=COUNTIF(nums, ">=10")', { nums })).toBe(3);
    expect(ev('=COUNTIF(nums, "<5")', { nums })).toBe(1);
    expect(ev('=COUNTIF(nums, "<=5")', { nums })).toBe(2);
    expect(ev('=COUNTIF(nums, "=20")', { nums })).toBe(1);
    expect(ev('=COUNTIF(nums, 20)', { nums })).toBe(1);
    // "<>10" は 10 以外のすべて（文字列・真偽値・空を含む）
    expect(ev('=COUNTIF(nums, "<>10")', { nums })).toBe(7);
  });

  test('"<>x" と空の条件', () => {
    expect(ev('=COUNTIF(elements, "<>火")', { elements })).toBe(5);
    expect(ev('=COUNTIF(elements, "")', { elements })).toBe(2);
    expect(ev('=COUNTIF(elements, "=")', { elements })).toBe(2);
    expect(ev('=COUNTIF(elements, "<>")', { elements })).toBe(5);
    expect(ev('=COUNTIF(elements, x)', { elements, x: EMPTY })).toBe(2);
  });

  test('文字列の大小の比較', () => {
    expect(ev('=COUNTIF(w, ">b")', { w: list('a', 'B', 'c', 1) })).toBe(1);
    expect(ev('=COUNTIF(w, "<=B")', { w: list('a', 'b', 'c') })).toBe(2);
  });

  test('真偽値の条件', () => {
    const flags = list(true, false, true, 'TRUE', 1);
    expect(ev('=COUNTIF(flags, TRUE)', { flags })).toBe(2);
    expect(ev('=COUNTIF(flags, "TRUE")', { flags })).toBe(2);
    expect(ev('=COUNTIF(flags, FALSE)', { flags })).toBe(1);
  });

  test('日時の条件', () => {
    const ds = list(dt('2026-01-01T00:00:00+09:00'), dt('2026-06-01T00:00:00+09:00'), dt('2026-12-01T00:00:00+09:00'));
    expect(ev('=COUNTIF(ds, ">2026-05-01")', { ds })).toBe(2);
    expect(ev('=COUNTIF(ds, DATE(2026,6,1))', { ds })).toBe(1);
  });

  test('範囲は単一の値でもよい。範囲の中のエラーは数えない', () => {
    expect(ev('=COUNTIF(rarity, "SSR")', { rarity: 'ssr' })).toBe(1);
    expect(ev('=COUNTIF(5, ">1")')).toBe(1);
    expect(ev('=COUNTIF(xs, "<>1")', { xs: list(new FormulaError('#N/A', 'formula.ref.keyNotFound'), 2) })).toBe(1);
    expect(ev('=COUNTIF(bad, "x")', { bad: new FormulaError('#N/A', 'formula.ref.keyNotFound') })).toBe(0);
  });

  test('条件のエラーとリストの条件', () => {
    expectError(ev('=COUNTIF(xs, 1/0)', { xs: list(1) }), '#DIV/0!');
    expectError(ev('=COUNTIF(xs, xs)', { xs: list(1) }), '#VALUE!', 'formula.listAsScalar');
    expectError(ev('=COUNTIF(1/0, 1)'), '#DIV/0!');
  });

  test('数値の条件は文字列の数値に一致しない（未検証）', () => {
    expect(ev('=COUNTIF(xs, 10)', { xs: list('10') })).toBe(0);
  });
});

describe('ABS / INT / MOD / POWER / SQRT', () => {
  test('ABS', () => {
    expect(ev('=ABS(-2.5)')).toBe(2.5);
    expect(ev('=ABS(3)')).toBe(3);
    expect(ev('=ABS(b)', { b: -9007199254740993n })).toBe(9007199254740993n);
    expectError(ev('=ABS("x")'), '#VALUE!', 'formula.argNotNumber');
  });

  test('INT は負の無限大の方向へ丸める', () => {
    expect(ev('=INT(8.9)')).toBe(8);
    expect(ev('=INT(-8.9)')).toBe(-9);
    expect(ev('=INT(-1.5)')).toBe(-2);
    expect(ev('=INT(5)')).toBe(5);
    expect(ev('=INT(b)', { b: 7n })).toBe(7n);
  });

  test('MOD は割る数の符号に合わせる', () => {
    expect(ev('=MOD(10, 4)')).toBe(2);
    expect(ev('=MOD(-1, 3)')).toBe(2);
    expect(ev('=MOD(1, -3)')).toBe(-2);
    expect(ev('=MOD(-7, -3)')).toBe(-1);
    expect(ev('=MOD(5.5, 2)')).toBe(1.5);
    expect(ev('=MOD(6, 3)')).toBe(0);
    expectError(ev('=MOD(1, 0)'), '#DIV/0!');
    expect(ev('=MOD(b, 10)', { b: 9007199254740993n })).toBe(3n);
    expect(ev('=MOD(b, 3)', { b: -1n })).toBe(2n);
    expectError(ev('=MOD(b, 0)', { b: 1n }), '#DIV/0!');
    expectError(ev('=MOD(b, 1.5)', { b: 1n }), '#VALUE!', 'formula.int64MixedWithFloat');
  });

  test('POWER は ^ と同じ', () => {
    expect(ev('=POWER(2, 10)')).toBe(1024);
    expect(ev('=POWER(4, 0.5)')).toBe(2);
    expect(ev('=POWER(b, 2)', { b: 3037000499n })).toBe(9223372030926249001n);
    expectError(ev('=POWER(-8, 1/3)'), '#NUM!');
  });

  test('SQRT の負の数は #NUM!', () => {
    expect(ev('=SQRT(16)')).toBe(4);
    expect(ev('=SQRT(2)')).toBe(Math.SQRT2);
    expect(ev('=SQRT(0)')).toBe(0);
    expect(expectError(ev('=SQRT(-1)'), '#NUM!', 'formula.sqrtNegative').messageArgs).toEqual({ value: '-1' });
    expect(ev('=SQRT(b)', { b: 16n })).toBe(4);
  });
});

describe('ROUND / ROUNDUP / ROUNDDOWN', () => {
  test('ROUND は 0 から遠い方へ丸め、2 進の誤差で結果を変えない', () => {
    expect(ev('=ROUND(1.005, 2)')).toBe(1.01);
    expect(ev('=ROUND(2.675, 2)')).toBe(2.68);
    expect(ev('=ROUND(0.285, 2)')).toBe(0.29);
    expect(ev('=ROUND(2.5)')).toBe(3);
    expect(ev('=ROUND(-2.5)')).toBe(-3);
    expect(ev('=ROUND(1.4)')).toBe(1);
    expect(ev('=ROUND(-0.4)')).toBe(0);
    expect(ev('=ROUND(1234.5678, -2)')).toBe(1200);
    expect(ev('=ROUND(1250, -2)')).toBe(1300);
    expect(ev('=ROUND(99.44, 1)')).toBe(99.4);
    expect(ev('=ROUND(1.23456, 10)')).toBe(1.23456);
    expect(ev('=ROUND(1E-7, 3)')).toBe(0);
    expect(ev('=ROUND(1.5E-7, 7)')).toBe(2e-7);
    expect(ev('=ROUND(123, -5)')).toBe(0);
    expect(ev('=ROUND(1.25, 1.9)')).toBe(1.3);
    expect(ev('=ROUND(0.1+0.2, 1)')).toBe(0.3);
  });

  test('ROUNDUP は 0 から遠い方、ROUNDDOWN は 0 の方へ', () => {
    expect(ev('=ROUNDUP(3.2)')).toBe(4);
    expect(ev('=ROUNDUP(-3.2)')).toBe(-4);
    expect(ev('=ROUNDUP(1.1, 1)')).toBe(1.1);
    expect(ev('=ROUNDUP(3.14159, 3)')).toBe(3.142);
    expect(ev('=ROUNDUP(31415.92654, -2)')).toBe(31500);
    expect(ev('=ROUNDDOWN(3.7)')).toBe(3);
    expect(ev('=ROUNDDOWN(-3.7)')).toBe(-3);
    expect(ev('=ROUNDDOWN(3.14159, 3)')).toBe(3.141);
    expect(ev('=ROUNDDOWN(31415.92654, -2)')).toBe(31400);
    expect(ev('=ROUNDDOWN(0.1*3, 1)')).toBe(0.3);
  });

  test('bigint は BigInt のまま丸める', () => {
    const b = 9007199254740995n;
    expect(ev('=ROUND(b)', { b })).toBe(b);
    expect(ev('=ROUND(b, -1)', { b })).toBe(9007199254741000n);
    expect(ev('=ROUND(b, -1)', { b: -15n })).toBe(-20n);
    expect(ev('=ROUND(b, -1)', { b: 14n })).toBe(10n);
    expect(ev('=ROUNDUP(b, -1)', { b: 11n })).toBe(20n);
    expect(ev('=ROUNDDOWN(b, -1)', { b: -19n })).toBe(-10n);
    expect(ev('=ROUND(b, -30)', { b })).toBe(0n);
    expectError(ev('=ROUND(b, -1)', { b: 9223372036854775807n }), '#NUM!', 'formula.int64Overflow');
  });

  test('引数の誤り', () => {
    expectError(ev('=ROUND("x")'), '#VALUE!', 'formula.argNotNumber');
    expectError(ev('=ROUND(1, "x")'), '#VALUE!', 'formula.argNotNumber');
  });
});

describe('FLOOR / CEILING', () => {
  test('公式の例: FLOOR(23.25, 0.18) は 23.22', () => {
    expect(ev('=FLOOR(23.25, 0.18)')).toBe(23.22);
  });

  test('正の数', () => {
    expect(ev('=FLOOR(2.5)')).toBe(2);
    expect(ev('=CEILING(2.1)')).toBe(3);
    expect(ev('=FLOOR(17, 5)')).toBe(15);
    expect(ev('=CEILING(17, 5)')).toBe(20);
    expect(ev('=FLOOR(0.3, 0.1)')).toBe(0.3);
    expect(ev('=CEILING(0.3, 0.1)')).toBe(0.3);
    expect(ev('=CEILING(1.01, 0.05)')).toBe(1.05);
    expect(ev('=FLOOR(0, 3)')).toBe(0);
  });

  test('負の数（未検証。Excel の規則: factor が正なら FLOOR は負の無限大の方向、CEILING は 0 の方向）', () => {
    expect(ev('=FLOOR(-2.5)')).toBe(-3);
    expect(ev('=FLOOR(-2.5, 2)')).toBe(-4);
    expect(ev('=CEILING(-2.5)')).toBe(-2);
    // 第三者の解説の例: CEILING(-2.5, 2) は -2
    expect(ev('=CEILING(-2.5, 2)')).toBe(-2);
    // factor も負なら FLOOR は 0 の方向、CEILING は 0 から遠い方へ
    expect(ev('=FLOOR(-2.5, -2)')).toBe(-2);
    expect(ev('=CEILING(-2.5, -2)')).toBe(-4);
  });

  test('値が正で factor が負なら #NUM!、factor が 0 なら FLOOR は #DIV/0!・CEILING は 0（未検証）', () => {
    expect(expectError(ev('=FLOOR(2.5, -2)'), '#NUM!', 'formula.signMismatch').messageArgs).toEqual({ name: 'FLOOR' });
    expectError(ev('=CEILING(4.3, -1)'), '#NUM!', 'formula.signMismatch');
    expectError(ev('=FLOOR(2.5, 0)'), '#DIV/0!');
    expect(ev('=CEILING(2.5, 0)')).toBe(0);
  });

  test('bigint は BigInt のまま', () => {
    expect(ev('=FLOOR(b, 10)', { b: 25n })).toBe(20n);
    expect(ev('=CEILING(b, 10)', { b: 25n })).toBe(30n);
    expect(ev('=FLOOR(b, 10)', { b: -25n })).toBe(-30n);
    expect(ev('=CEILING(b, 10)', { b: -25n })).toBe(-20n);
    expect(ev('=FLOOR(b, -10)', { b: -25n })).toBe(-20n);
    expect(ev('=CEILING(b, -10)', { b: -25n })).toBe(-30n);
    expect(ev('=CEILING(b, 10)', { b: 30n })).toBe(30n);
    expectError(ev('=FLOOR(b, 0.5)', { b: 1n }), '#VALUE!', 'formula.int64MixedWithFloat');
    expectError(ev('=FLOOR(b, -1)', { b: 1n }), '#NUM!');
  });
});

describe('文字列の関数', () => {
  test('CONCATENATE（公式の例）と範囲の展開', () => {
    expect(ev('=CONCATENATE("Welcome", " ", "to", " ", "Sheets!")')).toBe('Welcome to Sheets!');
    expect(ev('=CONCATENATE(tags, "-", 1.5, TRUE)', { tags: list('a', 'b', EMPTY, 3) })).toBe('ab3-1.5TRUE');
    expect(ev('=CONCATENATE(x)', { x: EMPTY })).toBe('');
    expectError(ev('=CONCATENATE("a", 1/0)'), '#DIV/0!');
  });

  test('LEN は UTF-16 の単位で数える（LEN("😀") は 2。第三者の解説で確認）', () => {
    expect(ev('=LEN("lorem ipsum")')).toBe(11);
    expect(ev('=LEN("勇者アルス")')).toBe(5);
    expect(ev('=LEN("😀")')).toBe(2);
    expect(ev('=LEN("")')).toBe(0);
    expect(ev('=LEN(x)', { x: EMPTY })).toBe(0);
    expect(ev('=LEN(0.1+0.2)')).toBe(3);
    expect(ev('=LEN(TRUE)')).toBe(4);
    expectError(ev('=LEN(tags)', { tags: list('a') }), '#VALUE!', 'formula.listAsScalar');
  });

  test('LEFT / RIGHT（n の既定は 1。負なら #VALUE!）', () => {
    expect(ev('=LEFT("abcdef")')).toBe('a');
    expect(ev('=LEFT("abcdef", 3)')).toBe('abc');
    expect(ev('=LEFT("abc", 10)')).toBe('abc');
    expect(ev('=LEFT("abc", 0)')).toBe('');
    expect(ev('=RIGHT("abcdef")')).toBe('f');
    expect(ev('=RIGHT("abcdef", 3)')).toBe('def');
    expect(ev('=RIGHT("abc", 10)')).toBe('abc');
    expect(ev('=RIGHT("abc", 0)')).toBe('');
    expect(ev('=LEFT(12345, 2)')).toBe('12');
    expect(ev('=LEFT("abc", 1.9)')).toBe('a');
    expect(expectError(ev('=LEFT("abc", -1)'), '#VALUE!', 'formula.argTooSmall').messageArgs).toEqual({
      name: 'LEFT',
      index: 2,
      value: -1,
      min: 0,
    });
    expectError(ev('=RIGHT("abc", -1)'), '#VALUE!', 'formula.argTooSmall');
  });

  test('MID は 1 から数える（J-01）', () => {
    expect(ev('=MID("abc", 1, 1)')).toBe('a');
    expect(ev('=MID("get this", 5, 4)')).toBe('this');
    expect(ev('=MID("abc", 2, 10)')).toBe('bc');
    expect(ev('=MID("abc", 4, 1)')).toBe('');
    expect(ev('=MID("abc", 10, 1)')).toBe('');
    expect(ev('=MID("abc", 1, 0)')).toBe('');
    expect(expectError(ev('=MID("abc", 0, 1)'), '#VALUE!', 'formula.argTooSmall').messageArgs).toEqual({
      name: 'MID',
      index: 2,
      value: 0,
      min: 1,
    });
    expectError(ev('=MID("abc", 1, -1)'), '#VALUE!', 'formula.argTooSmall');
  });

  test('UPPER / LOWER', () => {
    expect(ev('=UPPER("Fire ball")')).toBe('FIRE BALL');
    expect(ev('=LOWER("Fire BALL")')).toBe('fire ball');
    expect(ev('=UPPER(TRUE)')).toBe('TRUE');
  });

  test('TRIM は前後の空白を除き、連続する空白を 1 つにする（半角スペースだけ）', () => {
    expect(ev('=TRIM("  lorem  ipsum ")')).toBe('lorem ipsum');
    expect(ev('=TRIM("a   b   c")')).toBe('a b c');
    expect(ev('=TRIM("   ")')).toBe('');
    expect(ev('=TRIM("全角　スペース")')).toBe('全角　スペース');
  });

  test('SUBSTITUTE（大文字と小文字を区別する。occurrence でその回目だけ）', () => {
    expect(ev('=SUBSTITUTE("search for it", "search for", "Google")')).toBe('Google it');
    expect(ev('=SUBSTITUTE("aaa", "a", "b")')).toBe('bbb');
    expect(ev('=SUBSTITUTE("aaa", "a", "b", 2)')).toBe('aba');
    expect(ev('=SUBSTITUTE("aaa", "a", "b", 4)')).toBe('aaa');
    expect(ev('=SUBSTITUTE("aaa", "A", "b")')).toBe('aaa');
    expect(ev('=SUBSTITUTE("abab", "ab", "")')).toBe('');
    expect(ev('=SUBSTITUTE("abc", "", "x")')).toBe('abc');
    expect(ev('=SUBSTITUTE(1.5, ".", ",")')).toBe('1,5');
    // occurrence が 1 未満なら #VALUE!（未検証）
    expectError(ev('=SUBSTITUTE("aaa", "a", "b", 0)'), '#VALUE!', 'formula.argTooSmall');
  });
});

describe('VALUE / TO_TEXT', () => {
  test('VALUE は数値・%・指数・日時の文字列を数値にする', () => {
    expect(ev('=VALUE("123")')).toBe(123);
    expect(ev('=VALUE(" 1.5 ")')).toBe(1.5);
    expect(ev('=VALUE("50%")')).toBe(0.5);
    expect(ev('=VALUE("1e3")')).toBe(1000);
    expect(ev('=VALUE(42)')).toBe(42);
    expect(ev('=VALUE("2026-10-13")')).toBe(46308);
    expect(ev('=VALUE("2026/10/13 12:00")')).toBe(46308.5);
    expect(ev('=VALUE(DATE(2026,10,13))')).toBe(46308);
    expect(ev('=VALUE(x)', { x: EMPTY })).toBe(0);
    expect(ev('=VALUE(b)', { b: 5n })).toBe(5n);
    expectError(ev('=VALUE("abc")'), '#VALUE!', 'formula.argNotNumber');
  });

  test('VALUE の真偽値は 1/0（未検証）', () => {
    expect(ev('=VALUE(TRUE)')).toBe(1);
  });

  test('TO_TEXT', () => {
    expect(ev('=TO_TEXT(24)')).toBe('24');
    expect(ev('=TO_TEXT(0.1+0.2)')).toBe('0.3');
    expect(ev('=TO_TEXT(TRUE)')).toBe('TRUE');
    expect(ev('=TO_TEXT("abc")')).toBe('abc');
    expect(ev('=TO_TEXT(x)', { x: EMPTY })).toBe('');
    expect(ev('=TO_TEXT(b)', { b: 9007199254740993n })).toBe('9007199254740993');
    expect(ev('=TO_TEXT(d)', { d: dt('2026-10-13T12:34:56+09:00') })).toBe('2026-10-13 12:34:56');
    expect(ev('=TO_TEXT(d)', { d: dt('2026-10-13T12:34:56+09:00') }, { timeZone: 'America/New_York' })).toBe(
      '2026-10-12 23:34:56',
    );
    expectError(ev('=TO_TEXT(1/0)'), '#DIV/0!');
    expectError(ev('=TO_TEXT(l)', { l: list(1) }), '#VALUE!', 'formula.listAsScalar');
  });
});

describe('DATE', () => {
  test('scope.timeZone の 00:00:00', () => {
    const v = ev('=DATE(2026, 10, 13)');
    expect(v).toBeInstanceOf(DateTimeValue);
    expect((v as DateTimeValue).epochMs).toBe(Date.UTC(2026, 9, 12, 15));
    const ny = ev('=DATE(2026, 10, 13)', {}, { timeZone: 'America/New_York' }) as DateTimeValue;
    expect(ny.epochMs).toBe(Date.UTC(2026, 9, 13, 4));
    expect(ev('=TO_TEXT(DATE(1969, 7, 20))')).toBe('1969-07-20 00:00:00');
  });

  test('月や日のはみ出しを繰り上げる', () => {
    expect(ev('=TO_TEXT(DATE(2026, 13, 1))')).toBe('2027-01-01 00:00:00');
    expect(ev('=TO_TEXT(DATE(2026, 1, 0))')).toBe('2025-12-31 00:00:00');
    expect(ev('=TO_TEXT(DATE(2026, 0, 1))')).toBe('2025-12-01 00:00:00');
    expect(ev('=TO_TEXT(DATE(2026, 2, 29))')).toBe('2026-03-01 00:00:00');
    expect(ev('=TO_TEXT(DATE(2026, 1, 365))')).toBe('2026-12-31 00:00:00');
    expect(ev('=TO_TEXT(DATE(2026, -1, 1))')).toBe('2025-11-01 00:00:00');
  });

  test('年が 0〜1899 なら 1900 を足す。0 未満か 10000 以上なら #NUM!（公式）', () => {
    expect(ev('=TO_TEXT(DATE(119, 2, 1))')).toBe('2019-02-01 00:00:00');
    expect(ev('=TO_TEXT(DATE(0, 1, 1))')).toBe('1900-01-01 00:00:00');
    expect(ev('=TO_TEXT(DATE(1899, 12, 31))')).toBe('3799-12-31 00:00:00');
    expect(ev('=TO_TEXT(DATE(2019, 1, 2))')).toBe('2019-01-02 00:00:00');
    expect(ev('=TO_TEXT(DATE(9999, 12, 31))')).toBe('9999-12-31 00:00:00');
    expect(expectError(ev('=DATE(-1, 1, 1)'), '#NUM!', 'formula.dateYearOutOfRange').messageArgs).toEqual({ value: -1 });
    expectError(ev('=DATE(10000, 1, 1)'), '#NUM!', 'formula.dateYearOutOfRange');
  });

  test('小数は切り捨てる', () => {
    expect(ev('=TO_TEXT(DATE(2026.9, 12.75, 1.9))')).toBe('2026-12-01 00:00:00');
  });

  test('引数の誤り', () => {
    expectError(ev('=DATE("x", 1, 1)'), '#VALUE!', 'formula.argNotNumber');
    expectError(ev('=DATE(2026, 1E12, 1)'), '#NUM!', 'formula.dateOutOfRange');
  });
});

describe('YEAR / MONTH / DAY / HOUR / MINUTE / SECOND', () => {
  const d = dt('2026-10-13T12:34:56+09:00');

  test('scope.timeZone の現地時刻での値（Asia/Tokyo）', () => {
    expect(ev('=YEAR(d)', { d })).toBe(2026);
    expect(ev('=MONTH(d)', { d })).toBe(10);
    expect(ev('=DAY(d)', { d })).toBe(13);
    expect(ev('=HOUR(d)', { d })).toBe(12);
    expect(ev('=MINUTE(d)', { d })).toBe(34);
    expect(ev('=SECOND(d)', { d })).toBe(56);
  });

  test('夏時間のあるタイムゾーン（America/New_York）', () => {
    const o = { timeZone: 'America/New_York' };
    expect(ev('=DAY(d)', { d }, o)).toBe(12);
    expect(ev('=HOUR(d)', { d }, o)).toBe(23);
    const winter = dt('2026-01-13T12:00:00+09:00');
    expect(ev('=HOUR(d)', { d: winter }, o)).toBe(22);
    expect(ev('=HOUR(DATE(2026,3,8) + 2.5/24)', {}, o)).toBe(3);
  });

  test('シリアル値の数値と日時の文字列も受け付ける', () => {
    expect(ev('=YEAR(46308)')).toBe(2026);
    expect(ev('=MONTH(46308)')).toBe(10);
    expect(ev('=DAY(46308)')).toBe(13);
    expect(ev('=HOUR(46308.75)')).toBe(18);
    expect(ev('=MINUTE(0.5 + 1/24/60*7)')).toBe(7);
    expect(ev('=SECOND(1/24/60/60*42)')).toBe(42);
    expect(ev('=YEAR(0)')).toBe(1899);
    expect(ev('=DAY(1)')).toBe(31);
    expect(ev('=YEAR("2026-10-13")')).toBe(2026);
    expect(ev('=MONTH("2026/1/5 9:00")')).toBe(1);
    expect(ev('=YEAR("46308")')).toBe(2026);
    expect(ev('=DAY(DATE(2026,10,13)+1)')).toBe(14);
  });

  test('引数の誤り', () => {
    expectError(ev('=YEAR("abc")'), '#VALUE!', 'formula.argNotNumber');
    expectError(ev('=YEAR(1E9)'), '#NUM!', 'formula.dateOutOfRange');
    expectError(ev('=YEAR(l)', { l: list(1) }), '#VALUE!', 'formula.listAsScalar');
  });
});
