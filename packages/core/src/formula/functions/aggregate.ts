// 集計: SUM AVERAGE MIN MAX COUNT COUNTA COUNTIF。
// 直接の引数と範囲（リストと列の参照）とで扱いを分ける。範囲の中では数値だけを使い、
// 文字列・真偽値・空は無視する。直接の引数の真偽値は 1/0、文字列は数値として読めれば数値

import { parseUserDateTime } from '../../util/datetime';
import { checkInt64, checkNumber, int64MixedError, listAsScalarError, toBigInt } from '../arith';
import { compareNumeric, compareText, dateTimeToSerial, parseNumericString } from '../coerce';
import { formulaError } from '../errors';
import { DateTimeValue, EmptyValue, FList, FormulaError } from '../values';
import { argNotNumber } from './helpers';
import type { EvalContext, FnArg, FunctionDef } from '../context';
import type { Scalar } from '../values';

type Num = number | bigint;

/** 範囲の要素の数値。数値でなければ undefined */
function rangeItemNumber(v: Exclude<Scalar, FormulaError>, ctx: EvalContext): Num | undefined {
  if (typeof v === 'number' || typeof v === 'bigint') return v;
  if (v instanceof DateTimeValue) return dateTimeToSerial(v, ctx.timeZone);
  return undefined;
}

/** 引数の各値を、範囲の中のものかどうかとともに渡す。エラーは呼び出し側で扱う */
function forEachValue(
  args: readonly FnArg[],
  visit: (v: Scalar, inRange: boolean, index: number) => FormulaError | void,
): FormulaError | undefined {
  for (let i = 0; i < args.length; i++) {
    const v = args[i].value();
    if (v instanceof FList) {
      for (const item of v.items) {
        const r = visit(item, true, i + 1);
        if (r !== undefined) return r;
      }
    } else {
      const r = visit(v, args[i].isReference, i + 1);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

/** SUM・AVERAGE・MIN・MAX が使う数値を集める。エラーは伝える */
function collectNumbers(args: readonly FnArg[], ctx: EvalContext, name: string): Num[] | FormulaError {
  const out: Num[] = [];
  const err = forEachValue(args, (v, inRange, index) => {
    if (v instanceof FormulaError) return v;
    if (inRange) {
      const n = rangeItemNumber(v, ctx);
      if (n !== undefined) out.push(n);
      return;
    }
    if (v instanceof EmptyValue) return;
    if (typeof v === 'boolean') {
      out.push(v ? 1 : 0);
      return;
    }
    if (typeof v === 'string') {
      const n = parseNumericString(v);
      if (n === undefined) return argNotNumber(name, index, v, ctx);
      out.push(n);
      return;
    }
    const n = rangeItemNumber(v, ctx);
    if (n !== undefined) out.push(n);
    return undefined;
  });
  return err ?? out;
}

/** 合計。bigint が混ざれば BigInt で合計し、小数と混ざれば #VALUE! */
function sumOf(values: readonly Num[]): Num | FormulaError {
  if (values.some((v) => typeof v === 'bigint')) {
    let total = 0n;
    for (const v of values) {
      const b = toBigInt(v);
      if (b === undefined) return int64MixedError(v as number);
      total += b;
    }
    return checkInt64(total);
  }
  let total = 0;
  for (const v of values) total += v as number;
  return checkNumber(total);
}

const SUM: FunctionDef = {
  minArgs: 1,
  maxArgs: Infinity,
  call(args, ctx, _node, name) {
    const values = collectNumbers(args, ctx, name);
    return values instanceof FormulaError ? values : sumOf(values);
  },
};

const AVERAGE: FunctionDef = {
  minArgs: 1,
  maxArgs: Infinity,
  call(args, ctx, _node, name) {
    const values = collectNumbers(args, ctx, name);
    if (values instanceof FormulaError) return values;
    if (values.length === 0) return formulaError('#DIV/0!', 'formula.noNumbers', { name });
    const total = sumOf(values);
    if (total instanceof FormulaError) return total;
    if (typeof total === 'bigint') {
      // int64 は割り切れれば bigint、割り切れなければ #NUM!（P-14）
      const count = BigInt(values.length);
      if (total % count !== 0n) {
        return formulaError('#NUM!', 'formula.int64NotDivisible', {
          dividend: total.toString(),
          divisor: count.toString(),
        });
      }
      return total / count;
    }
    return checkNumber(total / values.length);
  },
};

function extremum(sign: 1 | -1): FunctionDef {
  return {
    minArgs: 1,
    maxArgs: Infinity,
    call(args, ctx, _node, name) {
      const values = collectNumbers(args, ctx, name);
      if (values instanceof FormulaError) return values;
      // 数値が無ければ 0
      if (values.length === 0) return 0;
      let best = values[0];
      for (const v of values) if (compareNumeric(v, best) * sign > 0) best = v;
      return best;
    },
  };
}

/** COUNT: 数値を数える。エラーは数えず、伝えもしない */
const COUNT: FunctionDef = {
  minArgs: 1,
  maxArgs: Infinity,
  call(args, ctx) {
    let count = 0;
    forEachValue(args, (v, inRange) => {
      if (v instanceof FormulaError || v instanceof EmptyValue) return;
      if (rangeItemNumber(v, ctx) !== undefined) {
        count++;
        return;
      }
      if (inRange) return;
      // 直接の引数の真偽値と、数値として読める文字列も数える（Excel と同じ。Googleスプレッドシートでは未検証）
      if (typeof v === 'boolean') count++;
      else if (typeof v === 'string' && parseNumericString(v) !== undefined) count++;
    });
    return count;
  },
};

/** COUNTA: 空でない値を数える（エラーと文字列 "" も数える） */
const COUNTA: FunctionDef = {
  minArgs: 1,
  maxArgs: Infinity,
  call(args) {
    let count = 0;
    forEachValue(args, (v) => {
      if (!(v instanceof EmptyValue)) count++;
    });
    return count;
  },
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** COUNTIF の条件の文字列のワイルドカード（* ? と ~ によるエスケープ）を正規表現にする */
export function wildcardToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '~' && i + 1 < pattern.length && '*?~'.includes(pattern[i + 1])) {
      re += escapeRegExp(pattern[i + 1]);
      i++;
    } else if (ch === '*') {
      re += '[\\s\\S]*';
    } else if (ch === '?') {
      re += '[\\s\\S]';
    } else {
      re += escapeRegExp(ch);
    }
  }
  return new RegExp(`^${re}$`, 'i');
}

type Matcher = (v: Scalar) => boolean;

function isBlank(v: Scalar): boolean {
  return v instanceof EmptyValue || v === '';
}

function numericMatcher(target: number, op: string, ctx: EvalContext): Matcher {
  return (v) => {
    if (v instanceof FormulaError || v instanceof EmptyValue) return false;
    const n = rangeItemNumber(v, ctx);
    if (n === undefined) return false;
    const c = compareNumeric(n, target);
    switch (op) {
      case '<':
        return c < 0;
      case '>':
        return c > 0;
      case '<=':
        return c <= 0;
      case '>=':
        return c >= 0;
      default:
        return c === 0;
    }
  };
}

/** COUNTIF の条件の文字列から照合の関数を作る */
function textCriterion(criterion: string, ctx: EvalContext): Matcher {
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(criterion);
  const op = m?.[1] ?? '=';
  const operand = m?.[2] ?? criterion;
  if (op === '<>') {
    const eq = textCriterion(`=${operand}`, ctx);
    return (v) => !eq(v);
  }
  const num = parseNumericString(operand);
  const date = num === undefined ? parseUserDateTime(operand, ctx.timeZone) : null;
  const target =
    num ?? (date !== null ? dateTimeToSerial(new DateTimeValue(date.epochMs), ctx.timeZone) : undefined);
  if (target !== undefined) return numericMatcher(target, op, ctx);
  if (op === '=') {
    if (operand === '') return isBlank;
    const upper = operand.toUpperCase();
    if (upper === 'TRUE' || upper === 'FALSE') return (v) => v === (upper === 'TRUE');
    const re = wildcardToRegExp(operand);
    return (v) => typeof v === 'string' && re.test(v);
  }
  if (operand === '') return () => false;
  return (v) => {
    if (typeof v !== 'string') return false;
    const c = compareText(v, operand);
    switch (op) {
      case '<':
        return c < 0;
      case '>':
        return c > 0;
      case '<=':
        return c <= 0;
      default:
        return c >= 0;
    }
  };
}

function criterionMatcher(c: Exclude<Scalar, FormulaError>, ctx: EvalContext): Matcher {
  if (typeof c === 'string') return textCriterion(c, ctx);
  if (typeof c === 'boolean') return (v) => v === c;
  if (c instanceof EmptyValue) return isBlank;
  const target = rangeItemNumber(c, ctx) as Num;
  return (v) => {
    if (v instanceof FormulaError || v instanceof EmptyValue) return false;
    const n = rangeItemNumber(v, ctx);
    return n !== undefined && compareNumeric(n, target) === 0;
  };
}

/**
 * COUNTIF(範囲, 条件)。範囲はリストまたは単一の値。
 * 条件: 数値、"=x" ">10" "<>x" などの比較、"x"（大文字と小文字を区別しない。ワイルドカード * ? と ~）、真偽値
 */
const COUNTIF: FunctionDef = {
  minArgs: 2,
  maxArgs: 2,
  call(args, ctx) {
    const range = args[0].value();
    if (range instanceof FormulaError && !args[0].isReference) return range;
    const crit = args[1].value();
    if (crit instanceof FormulaError) return crit;
    if (crit instanceof FList) return listAsScalarError();
    const match = criterionMatcher(crit, ctx);
    const items = range instanceof FList ? range.items : [range];
    let count = 0;
    for (const item of items) {
      if (!(item instanceof FormulaError) && match(item)) count++;
    }
    return count;
  },
};

export const aggregateFunctions: Readonly<Record<string, FunctionDef>> = {
  SUM,
  AVERAGE,
  MIN: extremum(-1),
  MAX: extremum(1),
  COUNT,
  COUNTA,
  COUNTIF,
};

