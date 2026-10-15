// 日時: DATE YEAR MONTH DAY HOUR MINUTE SECOND（scope.timeZone の現地時刻で扱う）

import { epochToLocal, parseUserDateTime, serialToWallMs, utcMs, wallFields } from '../../util/datetime';
import { dateFromWall } from '../arith';
import { parseNumericString, toNumeric } from '../coerce';
import { formulaError } from '../errors';
import { DateTimeValue, FormulaError } from '../values';
import { argNotNumber, intArg, scalarArg } from './helpers';
import type { EvalContext, FnArg, FunctionDef } from '../context';
import type { LocalDateTime } from '../../util/datetime';

/** シリアル値を日時のフィールドにする範囲（西暦 1〜9999 年に余裕を持たせる） */
const MAX_ABS_SERIAL = 3_000_000;

/**
 * DATE(year, month, day): scope.timeZone の 00:00:00。小数は切り捨てる。
 * 月と日のはみ出しは繰り上げる（DATE(2026, 13, 1) は 2027-01-01、DATE(2026, 1, 0) は 2025-12-31）。
 * 年が 0〜1899 なら 1900 を足す（DATE(119, 2, 1) は 2019-02-01）。0 未満か 10000 以上なら #NUM!（公式ヘルプ）
 */
const DATE: FunctionDef = {
  minArgs: 3,
  maxArgs: 3,
  call(args, ctx, _node, name) {
    const y = intArg(args[0], name, 1, ctx);
    if (y instanceof FormulaError) return y;
    const m = intArg(args[1], name, 2, ctx);
    if (m instanceof FormulaError) return m;
    const d = intArg(args[2], name, 3, ctx);
    if (d instanceof FormulaError) return d;
    if (y < 0 || y >= 10000) return formulaError('#NUM!', 'formula.dateYearOutOfRange', { value: y });
    const year = y < 1900 ? y + 1900 : y;
    return dateFromWall(utcMs(year, m, d), ctx.timeZone);
  },
};

/** 日時・シリアル値・日時の文字列を、現地時刻のフィールドにする */
function localFieldsArg(arg: FnArg, name: string, ctx: EvalContext): LocalDateTime | FormulaError {
  const v = scalarArg(arg);
  if (v instanceof FormulaError) return v;
  if (v instanceof DateTimeValue) return epochToLocal(v.epochMs, ctx.timeZone);
  if (typeof v === 'string' && parseNumericString(v) === undefined) {
    const dt = parseUserDateTime(v, ctx.timeZone);
    if (dt === null) return argNotNumber(name, 1, v, ctx);
    return epochToLocal(dt.epochMs, ctx.timeZone);
  }
  const n = toNumeric(v, ctx.timeZone);
  if (n === undefined) return argNotNumber(name, 1, v, ctx);
  const serial = Number(n);
  if (!Number.isFinite(serial) || Math.abs(serial) > MAX_ABS_SERIAL) {
    return formulaError('#NUM!', 'formula.dateOutOfRange');
  }
  return wallFields(serialToWallMs(serial));
}

function fieldFunction(field: keyof LocalDateTime): FunctionDef {
  return {
    minArgs: 1,
    maxArgs: 1,
    call(args, ctx, _node, name) {
      const f = localFieldsArg(args[0], name, ctx);
      return f instanceof FormulaError ? f : f[field];
    },
  };
}

export const dateFunctions: Readonly<Record<string, FunctionDef>> = {
  DATE,
  YEAR: fieldFunction('year'),
  MONTH: fieldFunction('month'),
  DAY: fieldFunction('day'),
  HOUR: fieldFunction('hour'),
  MINUTE: fieldFunction('minute'),
  SECOND: fieldFunction('second'),
};
