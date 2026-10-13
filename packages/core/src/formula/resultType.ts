// 結果の型の検査（FR-FML-12、P-13）と、列の値から式の値への変換

import { formatIsoOffset, parseIsoOffset } from '../util/datetime';
import { numberToText } from './coerce';
import { formulaError } from './errors';
import { DateTimeValue, EMPTY, EmptyValue, FList, FormulaError, inInt64Range } from './values';
import type { FValue, Scalar } from './values';

/** フィールド型（DR-13） */
export type FieldType =
  | 'int'
  | 'int64'
  | 'float'
  | 'string'
  | 'bool'
  | 'enum'
  | 'datetime'
  | 'list<int>'
  | 'list<float>'
  | 'list<string>'
  | 'list<enum>';

export type ScalarFieldType = 'int' | 'int64' | 'float' | 'string' | 'bool' | 'enum' | 'datetime';

/** セルの値（ファイル上の値）。datetime は時差付きの ISO 8601 の文字列 */
export type RawValue = number | bigint | string | boolean | RawValue[];

export interface ResultTypeOptions {
  /** enum / list<enum> の値の一覧 */
  enumValues?: readonly string[];
  /** datetime を ISO 8601 にするときのタイムゾーン */
  timeZone: string;
}

export type ResultTypeCheck = { ok: true; raw: RawValue | undefined } | { ok: false; error: FormulaError };

/** リスト型の要素の型。リスト型でなければ undefined */
export function listElementType(t: FieldType): ScalarFieldType | undefined {
  switch (t) {
    case 'list<int>':
      return 'int';
    case 'list<float>':
      return 'float';
    case 'list<string>':
      return 'string';
    case 'list<enum>':
      return 'enum';
    default:
      return undefined;
  }
}

/** エラーのメッセージに使う、値の型の名前 */
export function valueTypeName(v: FValue): string {
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  if (typeof v === 'bigint') return 'int64';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'bool';
  if (v instanceof DateTimeValue) return 'datetime';
  if (v instanceof FList) return 'list';
  if (v instanceof EmptyValue) return 'empty';
  return 'error';
}

function show(v: number | bigint): string {
  return typeof v === 'bigint' ? v.toString() : numberToText(v);
}

/** スカラーの検査の結果。undefined は未入力 */
type ScalarCheck =
  | { ok: true; raw: number | bigint | string | boolean | undefined }
  | { ok: false; kind: 'type' | 'notInteger' | 'outOfRange' | 'notInEnum'; value?: string };

function checkScalar(v: Exclude<Scalar, FormulaError>, t: ScalarFieldType, options: ResultTypeOptions): ScalarCheck {
  if (v instanceof EmptyValue) return { ok: true, raw: undefined };
  switch (t) {
    case 'int':
      // 安全な整数の number（安全な範囲の bigint も number にして受け入れる）
      if (typeof v === 'bigint') {
        if (v < BigInt(Number.MIN_SAFE_INTEGER) || v > BigInt(Number.MAX_SAFE_INTEGER)) {
          return { ok: false, kind: 'outOfRange', value: show(v) };
        }
        return { ok: true, raw: Number(v) };
      }
      if (typeof v !== 'number') return { ok: false, kind: 'type' };
      if (!Number.isInteger(v)) return { ok: false, kind: 'notInteger', value: show(v) };
      if (!Number.isSafeInteger(v)) return { ok: false, kind: 'outOfRange', value: show(v) };
      return { ok: true, raw: v === 0 ? 0 : v };
    case 'int64':
      // bigint か、安全な整数の number（bigint にする。P-13）
      if (typeof v === 'bigint') {
        return inInt64Range(v) ? { ok: true, raw: v } : { ok: false, kind: 'outOfRange', value: show(v) };
      }
      if (typeof v !== 'number') return { ok: false, kind: 'type' };
      if (!Number.isInteger(v)) return { ok: false, kind: 'notInteger', value: show(v) };
      if (!Number.isSafeInteger(v)) return { ok: false, kind: 'outOfRange', value: show(v) };
      return { ok: true, raw: BigInt(v) };
    case 'float':
      if (typeof v === 'bigint') {
        if (v < BigInt(Number.MIN_SAFE_INTEGER) || v > BigInt(Number.MAX_SAFE_INTEGER)) {
          return { ok: false, kind: 'outOfRange', value: show(v) };
        }
        return { ok: true, raw: Number(v) };
      }
      if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, kind: 'type' };
      return { ok: true, raw: v === 0 ? 0 : v };
    case 'string':
      // 数値などはエラー（TO_TEXT で包む）。"" は未入力（DR-15）
      if (typeof v !== 'string') return { ok: false, kind: 'type' };
      return { ok: true, raw: v === '' ? undefined : v };
    case 'bool':
      return typeof v === 'boolean' ? { ok: true, raw: v } : { ok: false, kind: 'type' };
    case 'enum':
      if (typeof v !== 'string') return { ok: false, kind: 'type' };
      if (v === '') return { ok: true, raw: undefined };
      if (!(options.enumValues ?? []).includes(v)) return { ok: false, kind: 'notInEnum', value: v };
      return { ok: true, raw: v };
    case 'datetime':
      if (!(v instanceof DateTimeValue)) return { ok: false, kind: 'type' };
      return { ok: true, raw: formatIsoOffset(v.epochMs, options.timeZone) };
  }
}

function scalarError(c: Extract<ScalarCheck, { ok: false }>, expected: string, v: FValue): FormulaError {
  switch (c.kind) {
    case 'notInteger':
      return formulaError('#VALUE!', 'formula.result.notInteger', { expected, value: c.value ?? '' });
    case 'outOfRange':
      return formulaError('#NUM!', 'formula.result.outOfRange', { expected, value: c.value ?? '' });
    case 'notInEnum':
      return formulaError('#VALUE!', 'formula.result.notInEnum', { value: c.value ?? '' });
    default:
      return formulaError('#VALUE!', 'formula.result.typeMismatch', { expected, actual: valueTypeName(v) });
  }
}

function elementError(
  c: Extract<ScalarCheck, { ok: false }>,
  index: number,
  expected: string,
  v: FValue,
): FormulaError {
  switch (c.kind) {
    case 'notInteger':
      return formulaError('#VALUE!', 'formula.result.listElementNotInteger', {
        index,
        expected,
        value: c.value ?? '',
      });
    case 'outOfRange':
      return formulaError('#NUM!', 'formula.result.listElementOutOfRange', {
        index,
        expected,
        value: c.value ?? '',
      });
    case 'notInEnum':
      return formulaError('#VALUE!', 'formula.result.listElementNotInEnum', { index, value: c.value ?? '' });
    default:
      return formulaError('#VALUE!', 'formula.result.listElementTypeMismatch', {
        index,
        expected,
        actual: valueTypeName(v),
      });
  }
}

/**
 * 式の結果を列の型で検査し、セルの値にする。暗黙の変換はしない（P-13。例外は int64 列の整数の number）。
 * 未入力（EMPTY、文字列型の ""、空のリスト）は raw: undefined。エラーの値はそのエラー
 */
export function checkResultType(value: FValue, fieldType: FieldType, options: ResultTypeOptions): ResultTypeCheck {
  if (value instanceof FormulaError) return { ok: false, error: value };
  if (value instanceof EmptyValue) return { ok: true, raw: undefined };
  const elem = listElementType(fieldType);
  if (elem === undefined) {
    if (value instanceof FList) {
      return {
        ok: false,
        error: formulaError('#VALUE!', 'formula.result.typeMismatch', { expected: fieldType, actual: 'list' }),
      };
    }
    const c = checkScalar(value, fieldType as ScalarFieldType, options);
    return c.ok ? { ok: true, raw: c.raw } : { ok: false, error: scalarError(c, fieldType, value) };
  }
  if (!(value instanceof FList)) {
    return {
      ok: false,
      error: formulaError('#VALUE!', 'formula.result.typeMismatch', {
        expected: fieldType,
        actual: valueTypeName(value),
      }),
    };
  }
  const out: RawValue[] = [];
  for (let i = 0; i < value.items.length; i++) {
    const item = value.items[i];
    if (item instanceof FormulaError) return { ok: false, error: item };
    if (item instanceof EmptyValue) {
      return { ok: false, error: formulaError('#VALUE!', 'formula.result.listElementEmpty', { index: i + 1 }) };
    }
    const c = checkScalar(item, elem, options);
    if (!c.ok) return { ok: false, error: elementError(c, i + 1, elem, item) };
    if (c.raw === undefined) {
      return { ok: false, error: formulaError('#VALUE!', 'formula.result.listElementEmpty', { index: i + 1 }) };
    }
    out.push(c.raw);
  }
  // 空のリストは未入力（P-11）
  return { ok: true, raw: out.length === 0 ? undefined : out };
}

function rawScalarToValue(raw: RawValue, t: ScalarFieldType | undefined): Scalar {
  if (Array.isArray(raw)) return formulaError('#VALUE!', 'formula.listAsScalar');
  if (t === 'datetime' && typeof raw === 'string') {
    const p = parseIsoOffset(raw);
    return p === null ? formulaError('#VALUE!', 'formula.invalidDateTime', { value: raw }) : new DateTimeValue(p.epochMs);
  }
  if (t === 'int64' && typeof raw === 'number' && Number.isInteger(raw)) return BigInt(raw);
  if (typeof raw === 'string' && raw === '') return EMPTY;
  return raw;
}

/**
 * セルの値（実効値）を式の値にする（EvalScope.column の実装で使う）。
 * undefined は EMPTY、配列は FList、datetime 列の文字列は DateTimeValue、int64 列の整数の number は bigint。
 * 型に合わない値（例: int 列の "abc"）は、そのままの値として渡す
 */
export function rawToValue(raw: RawValue | undefined, fieldType: FieldType): FValue {
  if (raw === undefined) return EMPTY;
  const elem = listElementType(fieldType);
  if (Array.isArray(raw)) {
    return new FList(raw.map((r) => rawScalarToValue(r, elem ?? (fieldType as ScalarFieldType))));
  }
  return rawScalarToValue(raw, elem === undefined ? (fieldType as ScalarFieldType) : undefined);
}
