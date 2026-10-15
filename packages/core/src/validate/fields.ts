// 列定義の検査（FR-VAL-07、DR-13、DR-17、P-21）
import type { Diagnostic, DiagnosticParams, Severity } from '../model/diagnostic';
import type { BoundValue, FieldDef, FieldType } from '../model/field';
import { elementType, isListType } from '../model/field';
import type { Calculator } from '../calc';
import { hasColumnFormula } from '../calc';
import { parseIsoOffset } from '../util/datetime';
import { ValidateCode } from './codes';
import { formulaIssue, staticFormulaErrors, withCause } from './formula';
import { compileRegex } from './regex';
import { checkDefaultValue, rawText } from './values';

/** J-13: 列名の書式（英小文字・数字・_。先頭は数字以外。true / false は不可） */
const COLUMN_NAME_RE = /^[a-z_][a-z0-9_]*$/;

export function isValidColumnName(name: string): boolean {
  return COLUMN_NAME_RE.test(name) && name !== 'true' && name !== 'false';
}

/** DR-17: `<テーブル>.<列>` を分ける。形が正しくなければ null */
export function parseRef(ref: string): { table: string; column: string } | null {
  const m = /^([^.\s]+)\.([^.\s]+)$/.exec(ref);
  return m === null ? null : { table: m[1], column: m[2] };
}

/** P-21: ref の列の型は、参照先の列と同じ型か、その型のリスト */
export function isRefTypeCompatible(type: FieldType, target: FieldType): boolean {
  if (type === target) return true;
  return isListType(type) && !isListType(target) && elementType(type) === target;
}

function isNumericElement(type: FieldType): boolean {
  const e = elementType(type);
  return e === 'int' || e === 'int64' || e === 'float';
}

function isNumericScalar(type: FieldType): boolean {
  return type === 'int' || type === 'int64' || type === 'float';
}

function boundText(v: BoundValue): string {
  return String(v);
}

export interface FieldCheckContext {
  calc: Calculator;
  /** 診断の付加情報（file・table） */
  scope: Pick<Diagnostic, 'file' | 'table'>;
  /** 式の中で使える列名（小文字）。null なら式は検査しない（共通列の式はテーブルごとに検査する） */
  formulaColumns: ReadonlySet<string> | null;
}

/** 検査結果を集める */
export class DiagnosticSink {
  readonly items: Diagnostic[] = [];

  push(base: Omit<Diagnostic, 'severity' | 'code' | 'params'>, severity: Severity, code: string, params?: DiagnosticParams): void {
    const d: Diagnostic = { severity, code };
    if (params !== undefined) d.params = params;
    for (const [k, v] of Object.entries(base)) {
      if (v !== undefined) (d as unknown as Record<string, unknown>)[k] = v;
    }
    this.items.push(d);
  }
}

/**
 * 列定義を 1 つ検査する。列レベル式に静的なエラーがあれば true を返す
 * （そのときはセルごとの式のエラーを報告しない）
 */
export function checkFieldDef(ctx: FieldCheckContext, field: FieldDef, sink: DiagnosticSink): boolean {
  const base = { ...ctx.scope, field: field.name };
  const error = (code: string, params?: DiagnosticParams): void => sink.push(base, 'error', code, params);
  const type = field.type;
  const elem = elementType(type);

  if (!isValidColumnName(field.name)) error(ValidateCode.invalidColumnName, { name: field.name });

  // DR-13: enum / list<enum> は enum_ref が必須
  if (elem === 'enum') {
    if (field.enum_ref === undefined || field.enum_ref === '') error(ValidateCode.enumRefMissing, { type });
    else if (ctx.calc.enumValues(field) === undefined) error(ValidateCode.enumNotFound, { enum: field.enum_ref });
  }

  // DR-17・P-21: ref
  if (field.ref !== undefined) checkRef(ctx, field, field.ref, error);

  // 列レベル式
  let formulaFailed = false;
  if (ctx.formulaColumns !== null && hasColumnFormula(field)) {
    for (const e of staticFormulaErrors(ctx.calc, field.formula, ctx.formulaColumns)) {
      const issue = formulaIssue(e, true);
      error(issue.code, issue.params);
      formulaFailed = true;
    }
  }

  if (field.auto !== undefined && type !== 'int' && type !== 'int64') {
    error(ValidateCode.autoNotAllowed, { type });
  }

  // 検査ルールが型に合うこと
  const v = field.validation;
  if (v !== undefined) {
    const notApplicable = (rule: string): void => error(ValidateCode.ruleNotApplicable, { rule, type });
    const ordered = v.min !== undefined || v.max !== undefined;
    if (ordered) {
      if (!isNumericElement(type) && type !== 'datetime') {
        if (v.min !== undefined) notApplicable('min');
        if (v.max !== undefined) notApplicable('max');
      } else {
        const minOk = v.min === undefined || checkBound(type, 'min', v.min, error);
        const maxOk = v.max === undefined || checkBound(type, 'max', v.max, error);
        if (minOk && maxOk && v.min !== undefined && v.max !== undefined && compareBounds(type, v.min, v.max) > 0) {
          error(ValidateCode.minGreaterThanMax, { min: boundText(v.min), max: boundText(v.max) });
        }
      }
    }
    if (v.max_length !== undefined) {
      if (elem !== 'string') notApplicable('max_length');
      else if (v.max_length < 0) error(ValidateCode.invalidRuleValue, { rule: 'max_length', value: v.max_length });
    }
    if (v.max_items !== undefined) {
      if (!isListType(type)) notApplicable('max_items');
      else if (v.max_items < 0) error(ValidateCode.invalidRuleValue, { rule: 'max_items', value: v.max_items });
    }
    if (v.regex !== undefined) {
      if (elem !== 'string' && elem !== 'enum') notApplicable('regex');
      else {
        const compiled = compileRegex(v.regex);
        if (!compiled.ok) error(ValidateCode.invalidRegex, { pattern: v.regex, detail: compiled.detail });
      }
    }
  }

  const a = field.anomaly;
  if (a !== undefined) {
    const notApplicable = (rule: string): void => error(ValidateCode.ruleNotApplicable, { rule, type });
    if (a.warn_above !== undefined && !isNumericElement(type)) notApplicable('warn_above');
    if (a.warn_below !== undefined && !isNumericElement(type)) notApplicable('warn_below');
    if (a.warn_deviation !== undefined) {
      if (!isNumericScalar(type)) notApplicable('warn_deviation');
      else if (!(a.warn_deviation > 0) || !Number.isFinite(a.warn_deviation)) {
        error(ValidateCode.invalidRuleValue, { rule: 'warn_deviation', value: a.warn_deviation });
      }
    }
  }

  // default の値が型に合うこと（"" は文字列と列挙型、[] はリストで使える。J-02、P-11）
  const def = field.default;
  if (def !== undefined) {
    for (const issue of checkDefaultValue(def, field, ctx.calc.enumValues(field))) {
      error(ValidateCode.invalidDefault, withCause({ value: rawText(def) }, issue.code, issue.params));
    }
  }
  return formulaFailed;
}

function checkRef(
  ctx: FieldCheckContext,
  field: FieldDef,
  ref: string,
  error: (code: string, params?: DiagnosticParams) => void,
): void {
  const target = parseRef(ref);
  if (target === null) {
    error(ValidateCode.refInvalidFormat, { ref });
    return;
  }
  const table = ctx.calc.findTable(target.table);
  if (table === undefined) {
    // 読み込みエラーのテーブル（P-40）はファイルがあるので、「ありません」ではなく読み込みエラーであることを示す
    error(ctx.calc.isBrokenTable(target.table) ? ValidateCode.refTableBroken : ValidateCode.refTableNotFound, { ref, table: target.table });
    return;
  }
  const column = ctx.calc.columns(table).find((c) => c.name === target.column);
  if (column === undefined) {
    error(ValidateCode.refColumnNotFound, { ref, table: target.table, column: target.column });
    return;
  }
  if (column.primary !== true && column.validation?.unique !== true) error(ValidateCode.refTargetNotUnique, { ref });
  if (!isRefTypeCompatible(field.type, column.type)) {
    error(ValidateCode.refTypeMismatch, { ref, type: field.type, target: column.type });
  }
}

/** min / max の値が列の型に合うか（数値の列は数値、datetime の列は時差付きの ISO 8601） */
function checkBound(
  type: FieldType,
  rule: 'min' | 'max',
  bound: BoundValue,
  error: (code: string, params?: DiagnosticParams) => void,
): boolean {
  const ok = type === 'datetime' ? typeof bound === 'string' && parseIsoOffset(bound) !== null : typeof bound !== 'string';
  if (!ok) error(ValidateCode.invalidRuleValue, { rule, value: boundText(bound) });
  return ok;
}

/** 値と min / max を比べる（数値・BigInt・datetime）。比べられなければ undefined */
export function compareToBound(type: FieldType, value: unknown, bound: BoundValue): number | undefined {
  if (type === 'datetime') {
    if (typeof value !== 'string' || typeof bound !== 'string') return undefined;
    const a = parseIsoOffset(value);
    const b = parseIsoOffset(bound);
    if (a === null || b === null) return undefined;
    return Math.sign(a.epochMs - b.epochMs);
  }
  if ((typeof value !== 'number' && typeof value !== 'bigint') || typeof bound === 'string') return undefined;
  // number と bigint の大小比較は JavaScript の比較演算子で正確に行える
  return value < bound ? -1 : value > bound ? 1 : 0;
}

function compareBounds(type: FieldType, min: BoundValue, max: BoundValue): number {
  return type === 'datetime' ? (compareToBound(type, min, max) ?? 0) : compareToBound('float', min, max) ?? 0;
}
