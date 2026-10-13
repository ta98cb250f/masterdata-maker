import { describe, expect, test } from 'vitest';
import { parseIsoOffset } from '../util/datetime';
import { circularReference } from './errors';
import { evaluate } from './evaluate';
import { parseFormula } from './parser';
import { ev, makeScope } from './test-scope';
import { DateTimeValue, EMPTY, FList, FormulaError } from './values';
import type { TestTables } from './test-scope';
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

describe('受け入れ基準と要件書の例', () => {
  test('§5.17 の 8 番: rarity が SSR、hp が 1200 なら IF(rarity = "SSR", hp * 2, hp) は 2400', () => {
    expect(ev('=IF(rarity = "SSR", hp * 2, hp)', { rarity: 'SSR', hp: 1200 })).toBe(2400);
    expect(ev('=IF(rarity = "SSR", hp * 2, hp)', { rarity: 'SR', hp: 800 })).toBe(800);
    // 文字列の比較は大文字と小文字を区別しない
    expect(ev('=IF(rarity = "SSR", hp * 2, hp)', { rarity: 'ssr', hp: 1200 })).toBe(2400);
  });

  test('§7 の例: ROUND(hp * (1 + defense / 100))', () => {
    expect(ev('=ROUND(hp * (1 + defense / 100))', { hp: 800, defense: 30 })).toBe(1040);
    expect(ev('=ROUND(hp * (1 + defense / 100))', { hp: 333, defense: 15 })).toBe(383);
  });

  test('§9.1 の例: hp * (1 + defense / 100) は 1040', () => {
    expect(ev('hp * (1 + defense / 100)', { hp: 800, defense: 30 })).toBe(1040);
  });

  test('FR-FML-10: IF(1 = 1, 1, 1 / 0) は 1', () => {
    expect(ev('=IF(1 = 1, 1, 1 / 0)')).toBe(1);
    expectError(ev('=IF(1 = 2, 1, 1 / 0)'), '#DIV/0!');
  });

  test('列名は大文字と小文字を区別しない（P-30）', () => {
    expect(ev('=HP + Hp', { hp: 2 })).toBe(4);
  });
});

describe('演算子', () => {
  test('優先順位と結合', () => {
    expect(ev('=-2^2')).toBe(4);
    expect(ev('=2^-1')).toBe(0.5);
    expect(ev('=1+2&3')).toBe('33');
    expect(ev('=2^3^2')).toBe(64);
    expect(ev('=1+2*3')).toBe(7);
    expect(ev('=(1+2)*3')).toBe(9);
    expect(ev('=10-2-3')).toBe(5);
    expect(ev('=8/2/2')).toBe(2);
    expect(ev('=1&2+3')).toBe('15');
    expect(ev('=1+1=2')).toBe(true);
    expect(ev('="a"&"b"="ab"')).toBe(true);
    expect(ev('=--1')).toBe(1);
    expect(ev('=2^3%')).toBeCloseTo(Math.pow(2, 0.03), 15);
  });

  test('% は 100 で割る', () => {
    expect(ev('=50%')).toBe(0.5);
    expect(ev('=2*50%')).toBe(1);
    expect(ev('=-50%')).toBe(-0.5);
    expect(ev('=200%%')).toBe(0.02);
    expect(ev('="50"%')).toBe(0.5);
  });

  test('算術', () => {
    expect(ev('=7/2')).toBe(3.5);
    expect(ev('=2^10')).toBe(1024);
    expect(ev('=4^0.5')).toBe(2);
    expect(ev('=0.1+0.2')).toBeCloseTo(0.3, 15);
    expect(Object.is(ev('=0*-1'), 0)).toBe(true);
  });

  test('0 で割ると #DIV/0!、結果が数値で表せなければ #NUM!', () => {
    expectError(ev('=1/0'), '#DIV/0!', 'formula.divByZero');
    expectError(ev('=0/0'), '#DIV/0!');
    expectError(ev('=1/empty', { empty: EMPTY }), '#DIV/0!');
    expectError(ev('=0^-1'), '#DIV/0!');
    expectError(ev('=(-8)^(1/3)'), '#NUM!', 'formula.numInvalid');
    expectError(ev('=10^400'), '#NUM!', 'formula.numInvalid');
    expectError(ev('=1E308*10'), '#NUM!');
  });

  test('0^0 は 1（未検証: Googleスプレッドシートでの結果を確かめられなかった）', () => {
    expect(ev('=0^0')).toBe(1);
    expect(ev('=POWER(0, 0)')).toBe(1);
  });

  test('単項の + は値をそのまま返す（未検証）', () => {
    expect(ev('=+"abc"')).toBe('abc');
    expect(ev('=+5')).toBe(5);
  });
});

describe('数値への変換（算術）', () => {
  test('真偽値は 1/0、未入力は 0', () => {
    expect(ev('=TRUE+TRUE')).toBe(2);
    expect(ev('=FALSE*5')).toBe(0);
    expect(ev('=x+1', { x: EMPTY })).toBe(1);
    expect(ev('=-x', { x: EMPTY })).toBe(0);
  });

  test('文字列は数値として読めれば数値（前後の空白、指数、%）', () => {
    expect(ev('="3"+1')).toBe(4);
    expect(ev('=" 3 "+1')).toBe(4);
    expect(ev('="1e3"+0')).toBe(1000);
    expect(ev('="50%"*2')).toBe(1);
    expect(ev('="-.5"*2')).toBe(-1);
    expect(ev('=-"2"')).toBe(-2);
  });

  test('読めなければ #VALUE!', () => {
    const e = expectError(ev('="abc"+1'), '#VALUE!', 'formula.operandNotNumber');
    expect(e.messageArgs).toEqual({ op: '+', value: 'abc' });
    expectError(ev('="TRUE"+1'), '#VALUE!');
    expectError(ev('="1,000"+1'), '#VALUE!');
    // 空文字列は数値として読まない（未検証）
    expectError(ev('=""+1'), '#VALUE!');
    expectError(ev('=-"x"'), '#VALUE!');
    expectError(ev('="x"%'), '#VALUE!');
  });

  test('リストを単独の値として使うと #VALUE!（P-32）', () => {
    const costs = new FList([1, 2]);
    expectError(ev('=costs+1', { costs }), '#VALUE!', 'formula.listAsScalar');
    expectError(ev('=costs&""', { costs }), '#VALUE!', 'formula.listAsScalar');
    expectError(ev('=costs=1', { costs }), '#VALUE!', 'formula.listAsScalar');
    expectError(ev('=-costs', { costs }), '#VALUE!');
    expectError(ev('=costs%', { costs }), '#VALUE!');
  });
});

describe('文字列への変換（&。P-34）', () => {
  test('数値は有効数字 15 桁で末尾の 0 を除く', () => {
    expect(ev('=0.1+0.2&""')).toBe('0.3');
    expect(ev('=1/3&""')).toBe('0.333333333333333');
    expect(ev('=2/3&""')).toBe('0.666666666666667');
    expect(ev('=1.5&""')).toBe('1.5');
    expect(ev('=100&""')).toBe('100');
    expect(ev('=-0.25&""')).toBe('-0.25');
    expect(ev('=0&""')).toBe('0');
  });

  test('非常に大きい・小さい数は指数表記（1E+21。境界は JavaScript と同じにした。未検証）', () => {
    expect(ev('=10^21&""')).toBe('1E+21');
    expect(ev('=10^20&""')).toBe('100000000000000000000');
    expect(ev('=1.5*10^22&""')).toBe('1.5E+22');
    expect(ev('=0.000001&""')).toBe('0.000001');
    expect(ev('=0.0000001&""')).toBe('1E-7');
    expect(ev('=123456789012345678&""')).toBe('123456789012346000');
  });

  test('bigint は 10 進、真偽値は TRUE / FALSE、未入力は ""', () => {
    expect(ev('=big&""', { big: 9007199254740993n })).toBe('9007199254740993');
    expect(ev('=TRUE&FALSE')).toBe('TRUEFALSE');
    expect(ev('="a"&x&"b"', { x: EMPTY })).toBe('ab');
  });

  test('日時はシリアル値の文字列（P-15）', () => {
    expect(ev('=DATE(2026,10,13)&""')).toBe('46308');
    expect(ev('=d&""', { d: dt('2026-10-13T12:00:00+09:00') })).toBe('46308.5');
  });
});

describe('比較', () => {
  test('数値どうし', () => {
    expect(ev('=1<2')).toBe(true);
    expect(ev('=2<=2')).toBe(true);
    expect(ev('=3>=4')).toBe(false);
    expect(ev('=1<>1')).toBe(false);
  });

  test('文字列は大文字と小文字を区別しない', () => {
    expect(ev('="a"="A"')).toBe(true);
    expect(ev('="abc"<"abd"')).toBe(true);
    expect(ev('="B">"a"')).toBe(true);
    expect(ev('="a"<>"A"')).toBe(false);
  });

  test('型が違うときの順序は 数値 < 文字列 < 真偽値', () => {
    expect(ev('=1<"a"')).toBe(true);
    expect(ev('=99999<"0"')).toBe(true);
    expect(ev('="z"<TRUE')).toBe(true);
    expect(ev('=1<TRUE')).toBe(true);
    expect(ev('=FALSE<TRUE')).toBe(true);
    expect(ev('="1"=1')).toBe(false);
    expect(ev('=TRUE=1')).toBe(false);
  });

  test('未入力は相手の型に合わせる（文字列なら ""、真偽値なら FALSE、数値なら 0）', () => {
    const s = { x: EMPTY, y: EMPTY };
    expect(ev('=x=""', s)).toBe(true);
    expect(ev('=x=0', s)).toBe(true);
    expect(ev('=x=FALSE', s)).toBe(true);
    expect(ev('=x<1', s)).toBe(true);
    expect(ev('=x<"a"', s)).toBe(true);
    expect(ev('=x=y', s)).toBe(true);
    expect(ev('=x=TRUE', s)).toBe(false);
  });

  test('bigint と number を正確に比べる', () => {
    const s = { big: 9007199254740993n };
    expect(ev('=big>9007199254740992', s)).toBe(true);
    // 式の中の数値リテラルは通常の数値（9007199254740993 は 9007199254740992 になる）
    expect(ev('=big=9007199254740993', s)).toBe(false);
    expect(ev('=big=big', s)).toBe(true);
    expect(ev('=big>1.5', s)).toBe(true);
    expect(ev('=big<1E300', s)).toBe(true);
    expect(ev('=neg<-0.5', { neg: -1n })).toBe(true);
    expect(ev('=neg>-1.5', { neg: -1n })).toBe(true);
    expect(ev('=neg=-1', { neg: -1n })).toBe(true);
  });

  test('日時は数値（シリアル値）として比べる', () => {
    const s = { start_at: dt('2026-10-13T12:00:00+09:00') };
    expect(ev('=start_at>DATE(2026,10,13)', s)).toBe(true);
    expect(ev('=start_at<DATE(2026,10,14)', s)).toBe(true);
    expect(ev('=start_at=DATE(2026,10,13)+0.5', s)).toBe(true);
    expect(ev('=start_at>46308', s)).toBe(true);
    expect(ev('=start_at<"a"', s)).toBe(true);
  });
});

describe('エラーの伝わり方と位置', () => {
  test('エラーは左のオペランドから順に伝える', () => {
    const e = expectError(ev('=1/0+"a"*1'), '#DIV/0!');
    expect([e.start, e.end]).toEqual([0, 3]);
    expectError(ev('="a"*1+1/0'), '#VALUE!');
    expectError(ev('=1/0&"x"'), '#DIV/0!');
    expectError(ev('=1/0=1/0'), '#DIV/0!');
  });

  test('エラーは生じたノードの位置を持つ', () => {
    const e = expectError(ev('=1 + 2 / 0'), '#DIV/0!');
    expect([e.start, e.end, e.position]).toEqual([4, 9, 5]);
  });

  test('無い列は #NAME?', () => {
    const e = expectError(ev('=hp + mp', { hp: 1 }), '#NAME?', 'formula.unknownColumn');
    expect(e.messageArgs).toEqual({ name: 'mp' });
    expect([e.start, e.end]).toEqual([5, 7]);
  });

  test('参照先のセルのエラーには、この式の中の参照の位置を付ける', () => {
    const original = new FormulaError('#DIV/0!', 'formula.divByZero', {}, 10, 13);
    const e = expectError(ev('=1 + bad * 2', { bad: original }), '#DIV/0!', 'formula.divByZero');
    expect([e.start, e.end]).toEqual([4, 7]);
    expect(e.cause).toBe(original);
    expect(e.origin).toBe(original);
  });

  test('循環参照はホストが返すエラーをそのまま伝える（P-33: #REF!）', () => {
    const e = expectError(ev('=a + 1', { a: circularReference() }), '#REF!', 'formula.circular');
    expect([e.start, e.end]).toEqual([0, 1]);
  });

  test('構文エラーは #ERROR!', () => {
    expectError(ev('=1+'), '#ERROR!', 'formula.syntax.unexpectedEnd');
  });

  test('未知の関数は #NAME?、引数の数の誤りは #N/A（関数名の位置）', () => {
    const e = expectError(ev('=1 + FOO(1)'), '#NAME?', 'formula.unknownFunction');
    expect(e.messageArgs).toEqual({ name: 'FOO' });
    expect([e.start, e.end]).toEqual([4, 7]);
    expect(expectError(ev('=IF(1)'), '#N/A', 'formula.argCount.range').messageArgs).toEqual({
      name: 'IF',
      min: 2,
      max: 3,
      actual: 1,
    });
    expect(expectError(ev('=ABS()'), '#N/A', 'formula.argCount.exact').messageArgs).toEqual({
      name: 'ABS',
      expected: 1,
      actual: 0,
    });
    expect(expectError(ev('=SUM()'), '#N/A', 'formula.argCount.atLeast').messageArgs).toEqual({
      name: 'SUM',
      min: 1,
      actual: 0,
    });
    expectError(ev('=MID("a", 1)'), '#N/A', 'formula.argCount.exact');
    expectError(ev('=NOT(1, 2)'), '#N/A');
  });

  test('実行のたびに結果が変わる関数は使えない（FR-FML-06。#NAME? と専用のメッセージ）', () => {
    for (const f of ['=NOW()', '=TODAY()', '=RAND()', '=RANDBETWEEN(1, 10)', '=now()']) {
      const e = expectError(ev(f), '#NAME?', 'formula.volatileFunction');
      expect(e.messageArgs.name).toBe(f.slice(1, f.indexOf('(')).toUpperCase());
    }
  });
});

describe('列の参照', () => {
  test('未入力の列をそのまま返す式の結果は未入力（未検証: 第三者の解説では 0 になるとするものもある）', () => {
    expect(ev('=name', { name: EMPTY })).toBe(EMPTY);
    expect(ev('=(name)', { name: EMPTY })).toBe(EMPTY);
  });

  test('リストの列はリストのまま返す', () => {
    const tags = new FList(['a', 'b']);
    expect(ev('=tags', { tags })).toBe(tags);
  });

  test('構文木はキャッシュして何度でも評価できる', () => {
    const p = parseFormula('=hp * 2');
    if (!p.ok) throw new Error();
    expect(evaluate(p.ast, makeScope({ hp: 1 }))).toBe(2);
    expect(evaluate(p.ast, makeScope({ hp: 5 }))).toBe(10);
  });
});

describe('int64（FR-FML-07）', () => {
  const big = 9007199254740993n;
  const max = 9223372036854775807n;

  test('9007199254740993 + 1 は 9007199254740994n', () => {
    expect(ev('=big + 1', { big })).toBe(9007199254740994n);
    expect(ev('=1 + big', { big })).toBe(9007199254740994n);
  });

  test('相手は bigint・整数の number・真偽値・未入力・整数として読める文字列', () => {
    expect(ev('=big - big', { big })).toBe(0n);
    expect(ev('=big * TRUE', { big })).toBe(big);
    expect(ev('=big + e', { big, e: EMPTY })).toBe(big);
    expect(ev('=big + "2"', { big })).toBe(9007199254740995n);
    expect(ev('=big * 2 / 2', { big })).toBe(big);
    expect(ev('=-big', { big })).toBe(-big);
  });

  test('小数と混ぜたら #VALUE!', () => {
    const e = expectError(ev('=big + 1.5', { big }), '#VALUE!', 'formula.int64MixedWithFloat');
    expect(e.messageArgs).toEqual({ value: '1.5' });
    expectError(ev('=0.5 * big', { big }), '#VALUE!', 'formula.int64MixedWithFloat');
    expectError(ev('=big + "0.5"', { big }), '#VALUE!');
  });

  test('割り切れない割り算は #NUM!（P-14）、0 で割ると #DIV/0!', () => {
    expect(expectError(ev('=big / 2', { big }), '#NUM!', 'formula.int64NotDivisible').messageArgs).toEqual({
      dividend: '9007199254740993',
      divisor: '2',
    });
    expect(ev('=big / 3', { big })).toBe(3002399751580331n);
    expectError(ev('=big / 0', { big }), '#DIV/0!');
    expectError(ev('=big%', { big }), '#NUM!', 'formula.int64NotDivisible');
    expect(ev('=b%', { b: 1200n })).toBe(12n);
  });

  test('累乗は 0 以上の整数の指数なら bigint、負なら #NUM!', () => {
    expect(ev('=b ^ 3', { b: 1000n })).toBe(1000000000n);
    expect(ev('=b ^ 0', { b: 0n })).toBe(1n);
    expect(ev('=2 ^ b', { b: 62n })).toBe(4611686018427387904n);
    expect(ev('=b ^ 1000000', { b: -1n })).toBe(1n);
    expectError(ev('=b ^ -1', { b: 2n }), '#NUM!', 'formula.int64NegativeExponent');
    expectError(ev('=b ^ 0.5', { b: 4n }), '#VALUE!', 'formula.int64MixedWithFloat');
    expectError(ev('=b ^ 64', { b: 2n }), '#NUM!', 'formula.int64Overflow');
    expectError(ev('=b ^ 1000000', { b: 2n }), '#NUM!', 'formula.int64Overflow');
  });

  test('int64 の範囲（±9,223,372,036,854,775,807）を超えたら #NUM!', () => {
    expect(ev('=m - 1 + 1', { m: max })).toBe(max);
    expectError(ev('=m + 1', { m: max }), '#NUM!', 'formula.int64Overflow');
    expectError(ev('=-m - 1', { m: max }), '#NUM!', 'formula.int64Overflow');
    expectError(ev('=big * big', { big }), '#NUM!', 'formula.int64Overflow');
  });

  test('2^53 を超える整数の number は正確に BigInt にする', () => {
    expect(ev('=b + 2^60', { b: 0n })).toBe(1152921504606846976n);
  });
});

describe('日時の計算（P-15）', () => {
  test('日時 ± 数値は日時（日単位）', () => {
    expect(ev('=TO_TEXT(DATE(2026,10,13) + 1)')).toBe('2026-10-14 00:00:00');
    expect(ev('=TO_TEXT(DATE(2026,10,13) - 1)')).toBe('2026-10-12 00:00:00');
    expect(ev('=TO_TEXT(1 + DATE(2026,12,31))')).toBe('2027-01-01 00:00:00');
    expect(ev('=TO_TEXT(DATE(2026,10,13) + 0.75)')).toBe('2026-10-13 18:00:00');
    expect(ev('=TO_TEXT(DATE(2026,10,13) + TRUE)')).toBe('2026-10-14 00:00:00');
    expect(ev('=DATE(2026,10,13) + 1')).toBeInstanceOf(DateTimeValue);
  });

  test('日時 − 日時は日数', () => {
    expect(ev('=DATE(2026,10,13) - DATE(2026,1,1)')).toBe(285);
    expect(ev('=b - a', { a: dt('2026-10-13T00:00:00+09:00'), b: dt('2026-10-13T18:00:00+09:00') })).toBe(0.75);
  });

  test('数値 − 日時、日時の掛け算などはシリアル値として計算する', () => {
    expect(ev('=46310 - DATE(2026,10,13)')).toBe(2);
    expect(ev('=DATE(2026,10,13) * 1')).toBe(46308);
    expect(ev('=DATE(2026,10,13) / 2')).toBe(23154);
  });

  test('夏時間のあるタイムゾーンでも壁時計の日で数える（America/New_York）', () => {
    const o = { timeZone: 'America/New_York' };
    expect(ev('=TO_TEXT(DATE(2026,3,8) + 1)', {}, o)).toBe('2026-03-09 00:00:00');
    expect(ev('=DATE(2026,3,9) - DATE(2026,3,8)', {}, o)).toBe(1);
    expect(ev('=TO_TEXT(DATE(2026,11,1) + 1)', {}, o)).toBe('2026-11-02 00:00:00');
    // 存在しない 02:30 は 03:30 になる
    expect(ev('=TO_TEXT(DATE(2026,3,8) + 2.5/24)', {}, o)).toBe('2026-03-08 03:30:00');
    const d = ev('=DATE(2026,3,9)', {}, o) as DateTimeValue;
    const c = ev('=DATE(2026,3,8)', {}, o) as DateTimeValue;
    expect(d.epochMs - c.epochMs).toBe(23 * 3600_000);
  });

  test('日時と文字列の数値', () => {
    expect(ev('=TO_TEXT(DATE(2026,10,13) + "2")')).toBe('2026-10-15 00:00:00');
    expectError(ev('=DATE(2026,10,13) + "x"'), '#VALUE!', 'formula.operandNotNumber');
  });

  test('範囲外の日時は #NUM!', () => {
    expectError(ev('=DATE(2026,1,1) + 1E10'), '#NUM!', 'formula.dateOutOfRange');
  });
});

describe('REF（FR-FML-04、P-31）', () => {
  const tables: TestTables = {
    skill: {
      '1': { name: 'ファイア', cost: 10, element: '火', bigcost: 10n, tags: new FList(['a', 'b']) },
      '2': { name: 'ヒール', cost: 5, element: '光', bigcost: 5n, tags: new FList(['c']) },
      '3': { name: 'フレア', cost: 30, element: '火', bigcost: 30n, tags: new FList([]) },
      '4': {
        name: '壊れた技',
        cost: new FormulaError('#DIV/0!', 'formula.divByZero', {}, 0, 3),
        element: EMPTY,
        bigcost: 0n,
        tags: new FList([]),
      },
    },
  };
  const o = { tables };

  test('単一のキー', () => {
    expect(ev('=REF("skill", 1, "name")', {}, o)).toBe('ファイア');
    expect(ev('=REF("skill", skill_id, "cost") * 2', { skill_id: 2 }, o)).toBe(10);
    expect(ev('=REF("skill", 1, "NAME")', {}, o)).toBe('ファイア');
    expect(ev('=ref("skill", "3", "name")', {}, o)).toBe('フレア');
  });

  test('キーのリストならリスト', () => {
    const r = ev('=REF("skill", skill_ids, "cost")', { skill_ids: new FList([1, 3]) }, o);
    expect(r).toBeInstanceOf(FList);
    expect((r as FList).items).toEqual([10, 30]);
    expect(ev('=SUM(REF("skill", skill_ids, "cost"))', { skill_ids: new FList([1, 3]) }, o)).toBe(40);
    expect(ev('=SUM(REF("skill", skill_ids, "bigcost"))', { skill_ids: new FList([1, 3]) }, o)).toBe(40n);
    expect(ev('=COUNTIF(REF("skill", skill_ids, "element"), "火") > 0', { skill_ids: new FList([2, 3]) }, o)).toBe(
      true,
    );
    expect(ev('=COUNT(REF("skill", skill_ids, "cost"))', { skill_ids: new FList([]) }, o)).toBe(0);
  });

  test('参照先の値がリストなら平らにする', () => {
    const r = ev('=REF("skill", ids, "tags")', { ids: new FList([1, 2]) }, o) as FList;
    expect(r.items).toEqual(['a', 'b', 'c']);
    expect((ev('=REF("skill", 1, "tags")', {}, o) as FList).items).toEqual(['a', 'b']);
  });

  test('見つからないキーは #N/A、無いテーブルと列は #REF!（REF の位置）', () => {
    const e = expectError(ev('=1 + REF("skill", 9, "name")', {}, o), '#N/A', 'formula.ref.keyNotFound');
    expect(e.messageArgs).toEqual({ table: 'skill', key: '9' });
    expect([e.start, e.end]).toEqual([4, 27]);
    expectError(ev('=REF("skill", ids, "name")', { ids: new FList([1, 9]) }, o), '#N/A');
    expectError(ev('=REF("item", 1, "name")', {}, o), '#REF!', 'formula.ref.tableNotFound');
    expectError(ev('=REF("skill", 1, "hp")', {}, o), '#REF!', 'formula.ref.columnNotFound');
  });

  test('要素の 1 つでもエラーならそのエラー（参照の位置を付ける）', () => {
    const e = expectError(ev('=REF("skill", ids, "cost")', { ids: new FList([1, 4]) }, o), '#DIV/0!');
    expect([e.start, e.end]).toEqual([0, 25]);
    expect(e.cause?.start).toBe(0);
    expectError(ev('=REF("skill", 4, "cost")', {}, o), '#DIV/0!');
  });

  test('キーのエラーはそのまま伝える', () => {
    expectError(ev('=REF("skill", 1/0, "name")', {}, o), '#DIV/0!');
  });

  test('テーブル名と列名は文字列リテラルに限る', () => {
    expectError(ev('=REF(t, 1, "name")', { t: 'skill' }, o), '#ERROR!', 'formula.ref.literalRequired');
    const e = expectError(ev('=REF("skill", 1, "na" & "me")', {}, o), '#ERROR!', 'formula.ref.literalRequired');
    expect(e.messageArgs).toEqual({ index: 3 });
    expect([e.start, e.end]).toEqual([16, 27]);
  });
});
