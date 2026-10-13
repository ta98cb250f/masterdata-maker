// 数学: ABS ROUND ROUNDUP ROUNDDOWN FLOOR CEILING INT MOD POWER SQRT。
// bigint を受け付ける関数は BigInt のまま計算する

import {
  checkInt64,
  checkNumber,
  divByZeroError,
  int64MixedError,
  numericBinary,
  toBigInt,
} from '../arith';
import { formulaError } from '../errors';
import { FormulaError } from '../values';
import { intArg, numberArg } from './helpers';
import type { FunctionDef } from '../context';

/** x × 10^k を、2 進の誤差を入れずに 10 進の桁をずらして求める */
function shiftDecimal(x: number, k: number): number {
  const [mant, exp] = x.toExponential().split('e');
  return Number(`${mant}e${Number(exp) + k}`);
}

/** 小数点以下の桁数（最も短い 10 進表記での） */
function fractionDigits(x: number): number {
  const [mant, exp] = x.toExponential().split('e');
  return mant.replace('.', '').replace('-', '').length - 1 - Number(exp);
}

type RoundMode = 'half' | 'up' | 'down';

/**
 * 10 進の桁で丸める。half は 0 から遠い方へ四捨五入、up は 0 から遠い方へ、down は 0 の方へ。
 * 最も短い 10 進表記の桁をずらすので、ROUND(1.005, 2) は 1.01 になる
 */
export function roundDecimal(x: number, places: number, mode: RoundMode): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  const ax = Math.abs(x);
  if (places >= fractionDigits(ax)) return x;
  const shifted = shiftDecimal(ax, places);
  // shifted は正なので、Math.round は 0 から遠い方への四捨五入になる
  const r = mode === 'half' ? Math.round(shifted) : mode === 'up' ? Math.ceil(shifted) : Math.floor(shifted);
  const result = r === 0 ? 0 : shiftDecimal(r, -places);
  return x < 0 && result !== 0 ? -result : result;
}

function roundBigInt(x: bigint, places: number, mode: RoundMode): bigint | FormulaError {
  if (places >= 0) return x;
  // 10^20 は int64 の範囲を超えるので、それより大きい桁は同じ結果になる
  const m = 10n ** BigInt(Math.min(-places, 20));
  const sign = x < 0n ? -1n : 1n;
  const ax = x < 0n ? -x : x;
  let q = ax / m;
  const rem = ax % m;
  if (mode === 'half' ? rem * 2n >= m : mode === 'up' ? rem !== 0n : false) q += 1n;
  return checkInt64(sign * q * m);
}

function roundFunction(mode: RoundMode): FunctionDef {
  return {
    minArgs: 1,
    maxArgs: 2,
    call(args, ctx, _node, name) {
      const x = numberArg(args[0], name, 1, ctx);
      if (x instanceof FormulaError) return x;
      let places = 0;
      if (args.length > 1) {
        const p = intArg(args[1], name, 2, ctx);
        if (p instanceof FormulaError) return p;
        places = Math.max(-400, Math.min(400, p));
      }
      if (typeof x === 'bigint') return roundBigInt(x, places, mode);
      return checkNumber(roundDecimal(x, places, mode));
    },
  };
}

const ABS: FunctionDef = {
  minArgs: 1,
  maxArgs: 1,
  call(args, ctx, _node, name) {
    const x = numberArg(args[0], name, 1, ctx);
    if (x instanceof FormulaError) return x;
    if (typeof x === 'bigint') return x < 0n ? -x : x;
    return Math.abs(x);
  },
};

/** INT: 負の無限大の方向へ丸める */
const INT: FunctionDef = {
  minArgs: 1,
  maxArgs: 1,
  call(args, ctx, _node, name) {
    const x = numberArg(args[0], name, 1, ctx);
    if (x instanceof FormulaError) return x;
    if (typeof x === 'bigint') return x;
    return checkNumber(Math.floor(x));
  },
};

/** MOD: 結果の符号は割る数に合わせる（MOD(-1, 3) は 2） */
const MOD: FunctionDef = {
  minArgs: 2,
  maxArgs: 2,
  call(args, ctx, _node, name) {
    const a = numberArg(args[0], name, 1, ctx);
    if (a instanceof FormulaError) return a;
    const b = numberArg(args[1], name, 2, ctx);
    if (b instanceof FormulaError) return b;
    if (typeof a === 'bigint' || typeof b === 'bigint') {
      const ba = toBigInt(a);
      if (ba === undefined) return int64MixedError(a as number);
      const bb = toBigInt(b);
      if (bb === undefined) return int64MixedError(b as number);
      if (bb === 0n) return divByZeroError();
      let r = ba % bb;
      if (r !== 0n && r < 0n !== bb < 0n) r += bb;
      return r;
    }
    if (b === 0) return divByZeroError();
    let r = a % b;
    if (r !== 0 && r < 0 !== b < 0) r += b;
    return checkNumber(r);
  },
};

const POWER: FunctionDef = {
  minArgs: 2,
  maxArgs: 2,
  call(args, ctx, _node, name) {
    const a = numberArg(args[0], name, 1, ctx);
    if (a instanceof FormulaError) return a;
    const b = numberArg(args[1], name, 2, ctx);
    if (b instanceof FormulaError) return b;
    return numericBinary('^', a, b);
  },
};

const SQRT: FunctionDef = {
  minArgs: 1,
  maxArgs: 1,
  call(args, ctx, _node, name) {
    const x = numberArg(args[0], name, 1, ctx);
    if (x instanceof FormulaError) return x;
    const n = Number(x);
    if (n < 0) return formulaError('#NUM!', 'formula.sqrtNegative', { value: x.toString() });
    return checkNumber(Math.sqrt(n));
  },
};

/** 有効数字 15 桁に丸めて 2 進の誤差を除く */
function clean15(x: number): number {
  return Number(x.toPrecision(15));
}

/**
 * FLOOR / CEILING: value を factor の倍数に丸める。FLOOR は負の無限大の方向、CEILING は正の無限大の方向。
 * よって factor が負のとき（value も負に限る）は、FLOOR は 0 の方向、CEILING は 0 から遠い方へ丸める。
 * value が正で factor が負なら #NUM!。factor が 0 なら FLOOR は #DIV/0!、CEILING は 0
 * （Excel の規則に合わせた。Googleスプレッドシートでは負の数と 0 の扱いが未検証）
 */
function floorCeiling(mode: 'floor' | 'ceil'): FunctionDef {
  return {
    minArgs: 1,
    maxArgs: 2,
    call(args, ctx, _node, name) {
      const x = numberArg(args[0], name, 1, ctx);
      if (x instanceof FormulaError) return x;
      let f: number | bigint = 1;
      if (args.length > 1) {
        const v = numberArg(args[1], name, 2, ctx);
        if (v instanceof FormulaError) return v;
        f = v;
      }
      if (typeof x === 'bigint' || typeof f === 'bigint') {
        const bx = toBigInt(x);
        if (bx === undefined) return int64MixedError(x as number);
        const bf = toBigInt(f);
        if (bf === undefined) return int64MixedError(f as number);
        if (bf === 0n) return mode === 'floor' ? divByZeroError() : 0n;
        if (bx > 0n && bf < 0n) return formulaError('#NUM!', 'formula.signMismatch', { name });
        let q = bx / bf;
        const exact = bx % bf === 0n;
        // bx / bf は 0 の方向に切り捨てるので、商の符号を見て直す
        const negativeQuotient = bx < 0n !== bf < 0n;
        if (!exact) {
          if (mode === 'floor' && negativeQuotient) q -= 1n;
          if (mode === 'ceil' && !negativeQuotient) q += 1n;
        }
        return checkInt64(q * bf);
      }
      if (f === 0) return mode === 'floor' ? divByZeroError() : 0;
      if (x > 0 && f < 0) return formulaError('#NUM!', 'formula.signMismatch', { name });
      if (x === 0) return 0;
      const q = clean15(x / f);
      const n = mode === 'floor' ? Math.floor(q) : Math.ceil(q);
      return checkNumber(clean15(n * f));
    },
  };
}

export const mathFunctions: Readonly<Record<string, FunctionDef>> = {
  ABS,
  ROUND: roundFunction('half'),
  ROUNDUP: roundFunction('up'),
  ROUNDDOWN: roundFunction('down'),
  FLOOR: floorCeiling('floor'),
  CEILING: floorCeiling('ceil'),
  INT,
  MOD,
  POWER,
  SQRT,
};
