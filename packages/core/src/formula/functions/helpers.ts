// 関数の引数の変換

import { listAsScalarError } from '../arith';
import { displayValue, scalarToText, toBoolean, toNumeric } from '../coerce';
import { formulaError } from '../errors';
import { FList, FormulaError } from '../values';
import type { EvalContext, FnArg } from '../context';
import type { FValue, Scalar } from '../values';

export function argNotNumber(name: string, index: number, v: FValue, ctx: EvalContext): FormulaError {
  return formulaError('#VALUE!', 'formula.argNotNumber', {
    name,
    index,
    value: displayValue(v, ctx.timeZone),
  });
}

export function argNotBoolean(name: string, index: number, v: FValue, ctx: EvalContext): FormulaError {
  return formulaError('#VALUE!', 'formula.argNotBoolean', {
    name,
    index,
    value: displayValue(v, ctx.timeZone),
  });
}

export function argTooSmall(name: string, index: number, value: number, min: number): FormulaError {
  return formulaError('#VALUE!', 'formula.argTooSmall', { name, index, value, min });
}

/** 単独の値として評価する。リストは #VALUE!（P-32） */
export function scalarArg(arg: FnArg): Scalar {
  const v = arg.value();
  return v instanceof FList ? listAsScalarError() : v;
}

/** 数値の引数（bigint はそのまま） */
export function numberArg(
  arg: FnArg,
  name: string,
  index: number,
  ctx: EvalContext,
): number | bigint | FormulaError {
  const v = scalarArg(arg);
  if (v instanceof FormulaError) return v;
  const n = toNumeric(v, ctx.timeZone);
  return n === undefined ? argNotNumber(name, index, v, ctx) : n;
}

/** 数値の引数（bigint も number にする） */
export function floatArg(arg: FnArg, name: string, index: number, ctx: EvalContext): number | FormulaError {
  const n = numberArg(arg, name, index, ctx);
  return typeof n === 'bigint' ? Number(n) : n;
}

/** 整数の引数（小数は 0 の方向へ切り捨てる） */
export function intArg(arg: FnArg, name: string, index: number, ctx: EvalContext): number | FormulaError {
  const n = floatArg(arg, name, index, ctx);
  return n instanceof FormulaError ? n : Math.trunc(n);
}

/** 文字列の引数 */
export function textArg(arg: FnArg, ctx: EvalContext): string | FormulaError {
  const v = scalarArg(arg);
  if (v instanceof FormulaError) return v;
  return scalarToText(v, ctx.timeZone);
}

/** 真偽値の引数 */
export function boolArg(arg: FnArg, name: string, index: number, ctx: EvalContext): boolean | FormulaError {
  const v = scalarArg(arg);
  if (v instanceof FormulaError) return v;
  const b = toBoolean(v, ctx.timeZone);
  return b === undefined ? argNotBoolean(name, index, v, ctx) : b;
}
