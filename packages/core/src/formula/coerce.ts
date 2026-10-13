// 型の変換と比較（Googleスプレッドシートの規則）

import { DAY_MS, SERIAL_EPOCH_WALL_MS, formatDisplay, toWallMs } from '../util/datetime';
import { formulaError } from './errors';
import { DateTimeValue, EmptyValue, FList, FormulaError } from './values';
import type { FValue, Scalar } from './values';

const NUMERIC_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?%?$/;

/** 文字列を数値として読む（前後の空白、指数、末尾の % を受け付ける）。読めなければ undefined */
export function parseNumericString(s: string): number | undefined {
  const t = s.trim();
  if (!NUMERIC_RE.test(t)) return undefined;
  if (t.endsWith('%')) {
    const n = Number(t.slice(0, -1)) / 100;
    return Number.isFinite(n) ? n : undefined;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 数値を文字列にする（P-34）。有効数字 15 桁に丸め、末尾の 0 を除く。
 * 指数表記にするかどうかと書き方は JavaScript の Number#toString と同じ（1e21 以上は "1E+21"、
 * 1e-7 未満は "1E-7"）で、e を大文字にする
 */
export function numberToText(n: number): string {
  if (n === 0) return '0';
  const rounded = Number(n.toPrecision(15));
  return String(rounded).replace('e', 'E');
}

/** 日時をシリアル値にする（P-15） */
export function dateTimeToSerial(v: DateTimeValue, timeZone: string): number {
  return (toWallMs(v.epochMs, timeZone) - SERIAL_EPOCH_WALL_MS) / DAY_MS;
}

/**
 * スカラーを数値にする（算術・数値の関数の引数）。
 * number・bigint はそのまま、boolean は 1/0、未入力は 0、文字列は数値として読めれば数値、
 * 日時はシリアル値。変換できなければ undefined（エラーとリストは呼び出し側で先に扱う）
 */
export function toNumeric(
  v: Exclude<Scalar, FormulaError>,
  timeZone: string,
): number | bigint | undefined {
  if (typeof v === 'number' || typeof v === 'bigint') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') return parseNumericString(v);
  if (v instanceof DateTimeValue) return dateTimeToSerial(v, timeZone);
  return 0; // 未入力
}

/** スカラーを文字列にする（`&` と文字列の関数の引数）。エラーとリストは呼び出し側で先に扱う */
export function scalarToText(v: Exclude<Scalar, FormulaError>, timeZone: string): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return numberToText(v);
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof DateTimeValue) return numberToText(dateTimeToSerial(v, timeZone));
  return '';
}

/** エラーのメッセージに差し込む、値の表示用の文字列（日時は表示形式） */
export function displayValue(v: FValue, timeZone: string): string {
  if (v instanceof FormulaError) return v.code;
  if (v instanceof FList) return v.items.map((x) => displayValue(x, timeZone)).join(', ');
  if (v instanceof DateTimeValue) return formatDisplay(v.epochMs, timeZone);
  return scalarToText(v, timeZone);
}

/**
 * スカラーを真偽値にする（IF・AND・OR・NOT）。
 * boolean はそのまま、数値は 0 以外が TRUE、未入力は FALSE、文字列は "TRUE" / "FALSE"
 * （大文字と小文字を区別しない）だけ。変換できなければ undefined
 */
export function toBoolean(v: Exclude<Scalar, FormulaError>, timeZone: string): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'bigint') return v !== 0n;
  if (typeof v === 'string') {
    const u = v.toUpperCase();
    if (u === 'TRUE') return true;
    if (u === 'FALSE') return false;
    return undefined;
  }
  if (v instanceof DateTimeValue) return dateTimeToSerial(v, timeZone) !== 0;
  return false; // 未入力
}

/** number と bigint を正確に比べる */
export function compareNumeric(a: number | bigint, b: number | bigint): -1 | 0 | 1 {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'number') {
    const r = compareBigWithNumber(b as bigint, a);
    return r === 0 ? 0 : r === 1 ? -1 : 1;
  }
  return compareBigWithNumber(a, b as number);
}

function compareBigWithNumber(big: bigint, n: number): -1 | 0 | 1 {
  if (Number.isInteger(n)) {
    const nb = BigInt(n);
    return big < nb ? -1 : big > nb ? 1 : 0;
  }
  // n が小数なら、floor(n) < big のとき n < big、そうでなければ n > big
  return BigInt(Math.floor(n)) < big ? 1 : -1;
}

type Ranked =
  | { rank: 0; num: number | bigint }
  | { rank: 1; str: string }
  | { rank: 2; bool: boolean };

function rankOf(v: Exclude<Scalar, FormulaError | EmptyValue>, timeZone: string): Ranked {
  if (typeof v === 'number' || typeof v === 'bigint') return { rank: 0, num: v };
  if (v instanceof DateTimeValue) return { rank: 0, num: dateTimeToSerial(v, timeZone) };
  if (typeof v === 'string') return { rank: 1, str: v };
  return { rank: 2, bool: v };
}

/** 比べる相手に合わせた未入力の値（文字列なら ""、真偽値なら FALSE、それ以外は 0） */
function emptyFor(other: Scalar): Exclude<Scalar, FormulaError | EmptyValue> {
  if (typeof other === 'string') return '';
  if (typeof other === 'boolean') return false;
  return 0;
}

/** 文字列を大文字と小文字を区別せずに比べる */
export function compareText(a: string, b: string): -1 | 0 | 1 {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la < lb ? -1 : la > lb ? 1 : 0;
}

/**
 * 比較演算子の規則で 2 つの値を比べる。
 * 型が違うときの順序は 数値 < 文字列 < 真偽値。未入力は相手の型に合わせる。
 * エラーは左から伝え、リストは #VALUE!
 */
export function compareValues(a: FValue, b: FValue, timeZone: string): -1 | 0 | 1 | FormulaError {
  if (a instanceof FormulaError) return a;
  if (b instanceof FormulaError) return b;
  if (a instanceof FList || b instanceof FList) {
    return formulaError('#VALUE!', 'formula.listAsScalar');
  }
  if (a instanceof EmptyValue && b instanceof EmptyValue) return 0;
  const x = rankOf(a instanceof EmptyValue ? emptyFor(b) : a, timeZone);
  const y = rankOf(b instanceof EmptyValue ? emptyFor(a) : b, timeZone);
  if (x.rank !== y.rank) return x.rank < y.rank ? -1 : 1;
  if (x.rank === 0 && y.rank === 0) return compareNumeric(x.num, y.num);
  if (x.rank === 1 && y.rank === 1) return compareText(x.str, y.str);
  if (x.rank === 2 && y.rank === 2) return x.bool === y.bool ? 0 : x.bool ? 1 : -1;
  return 0;
}
