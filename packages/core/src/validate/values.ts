// 値の型の検査（FR-VAL-03）と、診断に差し込む値の表記
import type { RawValue } from '../model/cell';
import type { DiagnosticParams } from '../model/diagnostic';
import type { FieldDef, FieldType, ScalarFieldType } from '../model/field';
import { elementType, isListType } from '../model/field';
import { INT64_MAX, INT64_MIN } from '../formula';
import { parseIsoOffset } from '../util/datetime';
import { ValidateCode } from './codes';

export interface Issue {
  code: string;
  params: DiagnosticParams;
}

// 整数の範囲（DR-36、DR-19）。診断に差し込む表記
const INT_LIMIT = '±9,007,199,254,740,991';
const INT64_LIMIT = '±9,223,372,036,854,775,807';
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** 診断に差し込む値の表記 */
export function rawText(raw: RawValue): string {
  if (Array.isArray(raw)) return `[${raw.map(rawText).join(', ')}]`;
  return String(raw);
}

/** 値の型の名前（列の型と同じ語） */
export function rawTypeName(raw: RawValue): string {
  if (Array.isArray(raw)) return 'list';
  if (typeof raw === 'number') return Number.isInteger(raw) ? 'int' : 'float';
  if (typeof raw === 'bigint') return 'int64';
  if (typeof raw === 'boolean') return 'bool';
  return 'string';
}

type Problem =
  | { kind: 'type' }
  | { kind: 'notInteger' }
  | { kind: 'outOfRange'; limit: string }
  | { kind: 'invalidDateTime' }
  | { kind: 'notInEnum' };

const DATETIME_CACHE_LIMIT = 100_000;
const dateTimeValidity = new Map<string, boolean>();

/** DR-18: 時差付きの ISO 8601 か。結果は文字列だけで決まるので、文字列ごとに覚えておく */
function isIsoDateTime(s: string): boolean {
  let ok = dateTimeValidity.get(s);
  if (ok === undefined) {
    ok = parseIsoOffset(s) !== null;
    if (dateTimeValidity.size >= DATETIME_CACHE_LIMIT) dateTimeValidity.clear();
    dateTimeValidity.set(s, ok);
  }
  return ok;
}

function isSafeBig(v: bigint): boolean {
  return v <= MAX_SAFE && v >= -MAX_SAFE;
}

function scalarProblem(v: RawValue, type: ScalarFieldType, enumValues: readonly string[] | undefined): Problem | null {
  if (Array.isArray(v)) return { kind: 'type' };
  switch (type) {
    case 'int':
      if (typeof v === 'bigint') return isSafeBig(v) ? null : { kind: 'outOfRange', limit: INT_LIMIT };
      if (typeof v !== 'number') return { kind: 'type' };
      if (!Number.isInteger(v)) return { kind: 'notInteger' };
      return Number.isSafeInteger(v) ? null : { kind: 'outOfRange', limit: INT_LIMIT };
    case 'int64':
      if (typeof v === 'bigint') {
        return v >= INT64_MIN && v <= INT64_MAX ? null : { kind: 'outOfRange', limit: INT64_LIMIT };
      }
      if (typeof v !== 'number') return { kind: 'type' };
      if (!Number.isInteger(v)) return { kind: 'notInteger' };
      return Number.isSafeInteger(v) ? null : { kind: 'outOfRange', limit: INT64_LIMIT };
    case 'float':
      if (typeof v === 'number') return Number.isFinite(v) ? null : { kind: 'type' };
      return typeof v === 'bigint' ? null : { kind: 'type' };
    case 'string':
      return typeof v === 'string' ? null : { kind: 'type' };
    case 'bool':
      return typeof v === 'boolean' ? null : { kind: 'type' };
    case 'enum':
      if (typeof v !== 'string') return { kind: 'type' };
      // 列挙型が見つからないときは列定義の検査で示す
      return enumValues === undefined || enumValues.includes(v) ? null : { kind: 'notInEnum' };
    case 'datetime':
      if (typeof v !== 'string') return { kind: 'type' };
      return isIsoDateTime(v) ? null : { kind: 'invalidDateTime' };
  }
}

function scalarIssue(p: Problem, v: RawValue, type: FieldType, field: FieldDef): Issue {
  const value = rawText(v);
  switch (p.kind) {
    case 'type':
      return { code: ValidateCode.typeMismatch, params: { expected: type, actual: rawTypeName(v), value } };
    case 'notInteger':
      return { code: ValidateCode.notInteger, params: { expected: type, value } };
    case 'outOfRange':
      return { code: ValidateCode.intOutOfRange, params: { expected: type, value, limit: p.limit } };
    case 'invalidDateTime':
      return { code: ValidateCode.invalidDateTime, params: { value } };
    case 'notInEnum':
      return { code: ValidateCode.notInEnum, params: { value, enum: field.enum_ref ?? '' } };
  }
}

function elementIssue(p: Problem, index: number, v: RawValue, type: ScalarFieldType, field: FieldDef): Issue {
  const value = rawText(v);
  switch (p.kind) {
    case 'type':
      return {
        code: ValidateCode.listElementTypeMismatch,
        params: { index, expected: type, actual: rawTypeName(v), value },
      };
    case 'notInteger':
      return { code: ValidateCode.listElementNotInteger, params: { index, expected: type, value } };
    case 'outOfRange':
      return { code: ValidateCode.listElementOutOfRange, params: { index, expected: type, value, limit: p.limit } };
    case 'invalidDateTime':
      return { code: ValidateCode.listElementInvalidDateTime, params: { index, value } };
    case 'notInEnum':
      return { code: ValidateCode.listElementNotInEnum, params: { index, value, enum: field.enum_ref ?? '' } };
  }
}

export interface RawCheck {
  issues: readonly Issue[];
  /** 型に合うか（列挙型の値の誤りは型の誤りとしない。ルールを当てはめてよいかの判定に使う） */
  typeValid: boolean;
}

const VALID: RawCheck = Object.freeze({ issues: Object.freeze([]) as readonly Issue[], typeValid: true });

/**
 * 値を列の型で検査する（型・整数の範囲・datetime の形式・列挙型の値・リストの要素）。
 * enumValues が undefined なら列挙型の値は検査しない。問題が無ければ同じオブジェクトを返す（割り当てを避ける）
 */
export function inspectRawValue(raw: RawValue, field: FieldDef, enumValues: readonly string[] | undefined): RawCheck {
  const type = field.type;
  if (isListType(type)) {
    if (!Array.isArray(raw)) {
      return {
        issues: [{ code: ValidateCode.typeMismatch, params: { expected: type, actual: rawTypeName(raw), value: rawText(raw) } }],
        typeValid: false,
      };
    }
    const elem = elementType(type);
    let issues: Issue[] | null = null;
    let typeValid = true;
    for (let i = 0; i < raw.length; i++) {
      const p = scalarProblem(raw[i], elem, enumValues);
      if (p === null) continue;
      (issues ??= []).push(elementIssue(p, i + 1, raw[i], elem, field));
      if (p.kind !== 'notInEnum') typeValid = false;
    }
    return issues === null ? VALID : { issues, typeValid };
  }
  const p = scalarProblem(raw, type as ScalarFieldType, enumValues);
  return p === null ? VALID : { issues: [scalarIssue(p, raw, type, field)], typeValid: p.kind === 'notInEnum' };
}

export function checkRawValue(raw: RawValue, field: FieldDef, enumValues: readonly string[] | undefined): readonly Issue[] {
  return inspectRawValue(raw, field, enumValues).issues;
}

/** default の値を列の型で検査する（"" は文字列と列挙型、[] はリストで使える。J-02、P-11） */
export function checkDefaultValue(def: RawValue, field: FieldDef, enumValues: readonly string[] | undefined): readonly Issue[] {
  const type = field.type;
  const emptyAllowed =
    (def === '' && (type === 'string' || type === 'enum')) || (Array.isArray(def) && def.length === 0 && isListType(type));
  return emptyAllowed ? VALID.issues : checkRawValue(def, field, enumValues);
}

/** 値が列の型に合うか（列挙型の値は問わない。ルールを当てはめてよいかの判定に使う） */
export function isRawTypeValid(raw: RawValue, field: FieldDef): boolean {
  const type = field.type;
  if (isListType(type)) {
    if (!Array.isArray(raw)) return false;
    const elem = elementType(type);
    return raw.every((item) => scalarProblem(item, elem, undefined) === null);
  }
  return scalarProblem(raw, type as ScalarFieldType, undefined) === null;
}

/** 文字数（コードポイントで数える） */
export function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}
