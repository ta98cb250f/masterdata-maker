// 演算子の計算（算術・連結・比較）。int64（bigint）は精度を落とさずに計算する（FR-FML-07）

import { DAY_MS, toWallMs, wallMsToEpoch } from '../util/datetime';
import { compareValues, dateTimeToSerial, displayValue, numberToText, scalarToText, toNumeric } from './coerce';
import { formulaError } from './errors';
import { DateTimeValue, FList, FormulaError, inInt64Range } from './values';
import type { BinaryOp } from './ast';
import type { FValue, Scalar } from './values';

type Plain = Exclude<Scalar, FormulaError>;

/** 扱える日時の範囲（Date が表せる範囲から余裕を取る） */
const MAX_WALL_MS = 8.64e15 - 2 * DAY_MS;

export function listAsScalarError(): FormulaError {
  return formulaError('#VALUE!', 'formula.listAsScalar');
}

export function divByZeroError(): FormulaError {
  return formulaError('#DIV/0!', 'formula.divByZero');
}

export function numInvalidError(): FormulaError {
  return formulaError('#NUM!', 'formula.numInvalid');
}

export function int64OverflowError(): FormulaError {
  return formulaError('#NUM!', 'formula.int64Overflow');
}

export function int64MixedError(n: number): FormulaError {
  return formulaError('#VALUE!', 'formula.int64MixedWithFloat', { value: numberToText(n) });
}

/** 壁時計の値から日時の値を作る。範囲外なら #NUM! */
export function dateFromWall(wallMs: number, timeZone: string): DateTimeValue | FormulaError {
  if (!Number.isFinite(wallMs) || Math.abs(wallMs) > MAX_WALL_MS) {
    return formulaError('#NUM!', 'formula.dateOutOfRange');
  }
  return new DateTimeValue(wallMsToEpoch(wallMs, timeZone));
}

/** bigint を int64 の範囲で検査する */
export function checkInt64(v: bigint): bigint | FormulaError {
  return inInt64Range(v) ? v : int64OverflowError();
}

/** 数値を正規化する（NaN・無限大は #NUM!、-0 は 0） */
export function checkNumber(r: number): number | FormulaError {
  if (!Number.isFinite(r)) return numInvalidError();
  return r === 0 ? 0 : r;
}

/** int64 の計算の相手を bigint にする。小数なら undefined */
export function toBigInt(v: number | bigint): bigint | undefined {
  if (typeof v === 'bigint') return v;
  return Number.isInteger(v) ? BigInt(v) : undefined;
}

function bigPow(base: bigint, exp: bigint): bigint | FormulaError {
  if (exp < 0n) {
    return formulaError('#NUM!', 'formula.int64NegativeExponent', { value: exp.toString() });
  }
  if (exp === 0n) return 1n;
  if (base === 0n || base === 1n) return base;
  if (base === -1n) return exp % 2n === 0n ? 1n : -1n;
  if (exp > 64n) return int64OverflowError();
  return checkInt64(base ** exp);
}

/** 数値どうしの二項演算（+ - * / ^）。どちらかが bigint なら BigInt で計算する */
export function numericBinary(
  op: '+' | '-' | '*' | '/' | '^',
  x: number | bigint,
  y: number | bigint,
): number | bigint | FormulaError {
  if (typeof x === 'bigint' || typeof y === 'bigint') {
    const bx = toBigInt(x);
    if (bx === undefined) return int64MixedError(x as number);
    const by = toBigInt(y);
    if (by === undefined) return int64MixedError(y as number);
    switch (op) {
      case '+':
        return checkInt64(bx + by);
      case '-':
        return checkInt64(bx - by);
      case '*':
        return checkInt64(bx * by);
      case '/':
        if (by === 0n) return divByZeroError();
        if (bx % by !== 0n) {
          return formulaError('#NUM!', 'formula.int64NotDivisible', {
            dividend: bx.toString(),
            divisor: by.toString(),
          });
        }
        return checkInt64(bx / by);
      case '^':
        return bigPow(bx, by);
    }
  }
  switch (op) {
    case '+':
      return checkNumber(x + y);
    case '-':
      return checkNumber(x - y);
    case '*':
      return checkNumber(x * y);
    case '/':
      if (y === 0) return divByZeroError();
      return checkNumber(x / y);
    case '^':
      // 0^0 は 1（未検証。Googleスプレッドシートでの結果を確かめられなかった）
      if (x === 0 && y < 0) return divByZeroError();
      return checkNumber(Math.pow(x, y));
  }
}

function operandNotNumber(op: string, v: FValue, timeZone: string): FormulaError {
  return formulaError('#VALUE!', 'formula.operandNotNumber', {
    op,
    value: displayValue(v, timeZone),
  });
}

/** 日時を含む + と -（P-15）。日時 ± 数値は日時（日単位）、日時 − 日時は日数 */
function dateArithmetic(op: '+' | '-', a: Plain, b: Plain, timeZone: string): FValue {
  if (a instanceof DateTimeValue && b instanceof DateTimeValue) {
    if (op === '-') {
      return checkNumber((toWallMs(a.epochMs, timeZone) - toWallMs(b.epochMs, timeZone)) / DAY_MS);
    }
    return checkNumber(dateTimeToSerial(a, timeZone) + dateTimeToSerial(b, timeZone));
  }
  if (a instanceof DateTimeValue) {
    const n = toNumeric(b, timeZone);
    if (n === undefined) return operandNotNumber(op, b, timeZone);
    const days = Number(n) * (op === '+' ? 1 : -1);
    return dateFromWall(toWallMs(a.epochMs, timeZone) + Math.round(days * DAY_MS), timeZone);
  }
  const dt = b as DateTimeValue;
  const n = toNumeric(a, timeZone);
  if (n === undefined) return operandNotNumber(op, a, timeZone);
  if (op === '+') {
    return dateFromWall(toWallMs(dt.epochMs, timeZone) + Math.round(Number(n) * DAY_MS), timeZone);
  }
  return checkNumber(Number(n) - dateTimeToSerial(dt, timeZone));
}

function arithmetic(op: '+' | '-' | '*' | '/' | '^', a: FValue, b: FValue, timeZone: string): FValue {
  if (a instanceof FormulaError) return a;
  if (b instanceof FormulaError) return b;
  if (a instanceof FList || b instanceof FList) return listAsScalarError();
  if ((op === '+' || op === '-') && (a instanceof DateTimeValue || b instanceof DateTimeValue)) {
    return dateArithmetic(op, a, b, timeZone);
  }
  const x = toNumeric(a, timeZone);
  if (x === undefined) return operandNotNumber(op, a, timeZone);
  const y = toNumeric(b, timeZone);
  if (y === undefined) return operandNotNumber(op, b, timeZone);
  return numericBinary(op, x, y);
}

function concat(a: FValue, b: FValue, timeZone: string): FValue {
  if (a instanceof FormulaError) return a;
  if (b instanceof FormulaError) return b;
  if (a instanceof FList || b instanceof FList) return listAsScalarError();
  return scalarToText(a, timeZone) + scalarToText(b, timeZone);
}

function compare(op: BinaryOp, a: FValue, b: FValue, timeZone: string): FValue {
  const c = compareValues(a, b, timeZone);
  if (c instanceof FormulaError) return c;
  switch (op) {
    case '=':
      return c === 0;
    case '<>':
      return c !== 0;
    case '<':
      return c < 0;
    case '>':
      return c > 0;
    case '<=':
      return c <= 0;
    default:
      return c >= 0;
  }
}

/** 二項演算子を計算する。エラーは左のオペランドから順に伝える */
export function applyBinary(op: BinaryOp, a: FValue, b: FValue, timeZone: string): FValue {
  switch (op) {
    case '+':
    case '-':
    case '*':
    case '/':
    case '^':
      return arithmetic(op, a, b, timeZone);
    case '&':
      return concat(a, b, timeZone);
    default:
      return compare(op, a, b, timeZone);
  }
}

/** 単項の - */
export function applyNegate(v: FValue, timeZone: string): FValue {
  if (v instanceof FormulaError) return v;
  if (v instanceof FList) return listAsScalarError();
  const n = toNumeric(v, timeZone);
  if (n === undefined) return operandNotNumber('-', v, timeZone);
  if (typeof n === 'bigint') return checkInt64(-n);
  return checkNumber(-n);
}

/** 後置の %（100 で割る） */
export function applyPercent(v: FValue, timeZone: string): FValue {
  if (v instanceof FormulaError) return v;
  if (v instanceof FList) return listAsScalarError();
  const n = toNumeric(v, timeZone);
  if (n === undefined) return operandNotNumber('%', v, timeZone);
  return numericBinary('/', n, typeof n === 'bigint' ? 100n : 100);
}
