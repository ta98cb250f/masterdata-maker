// 検査（§8）。式を計算した後の実効値に対して行う（FR-VAL-02）。画面と CLI で同じ関数を使う（FR-VAL-11）
import type { RawValue } from '../model/cell';
import { isEmptyValue } from '../model/cell';
import type { Diagnostic, DiagnosticParams, Severity } from '../model/diagnostic';
import type { BoundValue, FieldDef, ScalarFieldType } from '../model/field';
import { elementType, isListType } from '../model/field';
import type { Project } from '../model/project';
import { compareNames } from '../model/project';
import type { Table } from '../model/table';
import type { Calculator } from '../calc';
import { valueKey } from '../calc';
import { FList } from '../formula';
import type { FValue } from '../formula';
import { ValidateCode } from './codes';
import { checkFieldDef, compareToBound, DiagnosticSink, parseRef } from './fields';
import { formulaIssue } from './formula';
import { regexTest } from './regex';
import { codePointLength, inspectRawValue, isRawTypeValid, rawText } from './values';

function uniqueColumns(columns: readonly FieldDef[]): FieldDef[] {
  const seen = new Set<string>();
  return columns.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
}

/** 統計値の表記（有効数字 6 桁） */
function statText(n: number): string {
  return String(Number(n.toPrecision(6)));
}

function isNumericScalar(type: string): boolean {
  return type === 'int' || type === 'int64' || type === 'float';
}

interface DeviationStats {
  mean: number;
  sd: number;
  k: number;
}

/** 列ごとの検査の準備（ルールと、事前の集計） */
interface ColumnPlan {
  column: FieldDef;
  isPrimary: boolean;
  required: boolean;
  enumValues: readonly string[] | undefined;
  /** 列レベル式に静的なエラーがある（セルごとの式のエラーは報告しない） */
  formulaFailed: boolean;
  list: boolean;
  elem: ScalarFieldType;
  /** ルールや警告があるか（無ければ checkRules を呼ばない） */
  hasRules: boolean;
  min?: BoundValue;
  max?: BoundValue;
  maxLength?: number;
  maxItems?: number;
  regex?: string;
  warnAbove?: number | bigint;
  warnBelow?: number | bigint;
  /** 一意性・主キーの重複を調べるための、値のキーごとの件数 */
  counts?: Map<string, number>;
  deviation?: DeviationStats;
  /** ref の参照先の値のキー。参照先が解決できなければ undefined（列定義の検査で示す） */
  refKeys?: Set<string>;
  ref?: string;
}

type Emit = (plan: ColumnPlan, severity: Severity, code: string, params: DiagnosticParams) => void;

function refTargetKeys(calc: Calculator, ref: string, cache: Map<string, Set<string> | null>): Set<string> | null {
  const cached = cache.get(ref);
  if (cached !== undefined) return cached;
  let keys: Set<string> | null = null;
  const target = parseRef(ref);
  const table = target === null ? undefined : calc.findTable(target.table);
  const column = table === undefined ? undefined : calc.columns(table).find((c) => c.name === target?.column);
  if (table !== undefined && column !== undefined) {
    keys = new Set();
    for (const record of table.records) {
      const res = calc.getCell(table, record.uid, column.name);
      if (res.error !== undefined || res.raw === undefined) continue;
      const k = valueKey(res.value);
      if (k !== undefined) keys.add(k);
    }
  }
  cache.set(ref, keys);
  return keys;
}

function planColumns(calc: Calculator, table: Table, formulaFailed: ReadonlySet<string>): ColumnPlan[] {
  const primary = calc.primaryColumn(table);
  const refCache = new Map<string, Set<string> | null>();
  return uniqueColumns(calc.columns(table)).map((column) => {
    const v = column.validation;
    const a = column.anomaly;
    const elem = elementType(column.type);
    const plan: ColumnPlan = {
      column,
      isPrimary: column === primary,
      required: v?.required === true,
      enumValues: calc.enumValues(column),
      formulaFailed: formulaFailed.has(column.name),
      list: isListType(column.type),
      elem,
      hasRules: false,
    };
    const numeric = elem === 'int' || elem === 'int64' || elem === 'float';
    const ordered = numeric || column.type === 'datetime';
    if (v !== undefined) {
      if (ordered && v.min !== undefined) plan.min = v.min;
      if (ordered && v.max !== undefined) plan.max = v.max;
      if (elem === 'string' && v.max_length !== undefined) plan.maxLength = v.max_length;
      if (plan.list && v.max_items !== undefined) plan.maxItems = v.max_items;
      if ((elem === 'string' || elem === 'enum') && v.regex !== undefined) plan.regex = v.regex;
    }
    if (a !== undefined && numeric) {
      if (a.warn_above !== undefined) plan.warnAbove = a.warn_above;
      if (a.warn_below !== undefined) plan.warnBelow = a.warn_below;
    }
    if (column.ref !== undefined) {
      const keys = refTargetKeys(calc, column.ref, refCache);
      if (keys !== null) {
        plan.refKeys = keys;
        plan.ref = column.ref;
      }
    }
    collectStats(calc, table, plan);
    plan.hasRules =
      plan.min !== undefined ||
      plan.max !== undefined ||
      plan.maxLength !== undefined ||
      plan.maxItems !== undefined ||
      plan.regex !== undefined ||
      plan.warnAbove !== undefined ||
      plan.warnBelow !== undefined ||
      plan.deviation !== undefined ||
      plan.refKeys !== undefined;
    return plan;
  });
}

/** 一意性・主キーの重複のための件数と、warn_deviation のための平均と標準偏差（母標準偏差） */
function collectStats(calc: Calculator, table: Table, plan: ColumnPlan): void {
  const column = plan.column;
  const countKeys = plan.isPrimary || column.validation?.unique === true;
  const k = column.anomaly?.warn_deviation;
  const wantDeviation = k !== undefined && k > 0 && Number.isFinite(k) && isNumericScalar(column.type);
  if (!countKeys && !wantDeviation) return;
  const counts = new Map<string, number>();
  const numbers: number[] = [];
  for (const record of table.records) {
    const res = calc.getCell(table, record.uid, column.name);
    const raw = res.raw;
    if (res.error !== undefined || raw === undefined || isEmptyValue(raw)) continue;
    if ((res.source === 'value' || res.source === 'default') && !isRawTypeValid(raw, column)) continue;
    if (countKeys) {
      const key = valueKey(res.value);
      if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (wantDeviation && (typeof raw === 'number' || typeof raw === 'bigint')) numbers.push(Number(raw));
  }
  if (countKeys) plan.counts = counts;
  // 値が 2 つ未満か、標準偏差が 0 なら判定しない
  if (wantDeviation && numbers.length >= 2) {
    const mean = numbers.reduce((s, n) => s + n, 0) / numbers.length;
    const variance = numbers.reduce((s, n) => s + (n - mean) * (n - mean), 0) / numbers.length;
    const sd = Math.sqrt(variance);
    if (sd > 0) plan.deviation = { mean, sd, k: k as number };
  }
}

/** 要素（リストでなければ値そのもの）のルール。index はリストの要素の番号（1 から）、リストでなければ 0 */
function checkItem(plan: ColumnPlan, item: RawValue, value: FValue, index: number, emit: Emit): void {
  const withIndex = (params: DiagnosticParams): DiagnosticParams => (index === 0 ? params : { index, ...params });
  const pick = (scalar: string, element: string): string => (index === 0 ? scalar : element);
  if (plan.min !== undefined) {
    const c = compareToBound(plan.elem, item, plan.min);
    if (c !== undefined && c < 0) {
      emit(plan, 'error', pick(ValidateCode.belowMin, ValidateCode.listElementBelowMin), withIndex({ value: rawText(item), min: String(plan.min) }));
    }
  }
  if (plan.max !== undefined) {
    const c = compareToBound(plan.elem, item, plan.max);
    if (c !== undefined && c > 0) {
      emit(plan, 'error', pick(ValidateCode.aboveMax, ValidateCode.listElementAboveMax), withIndex({ value: rawText(item), max: String(plan.max) }));
    }
  }
  if (plan.maxLength !== undefined && typeof item === 'string') {
    const length = codePointLength(item);
    if (length > plan.maxLength) {
      emit(plan, 'error', pick(ValidateCode.tooLong, ValidateCode.listElementTooLong), withIndex({ length, max: plan.maxLength }));
    }
  }
  if (plan.regex !== undefined && typeof item === 'string' && regexTest(plan.regex, item) === false) {
    emit(plan, 'error', pick(ValidateCode.regexMismatch, ValidateCode.listElementRegexMismatch), withIndex({ value: item, pattern: plan.regex }));
  }
  // ref の参照先の存在（参照先の列に値があるか）
  if (plan.refKeys !== undefined) {
    const k = valueKey(value);
    if (k === undefined || !plan.refKeys.has(k)) {
      emit(plan, 'error', pick(ValidateCode.refNotFound, ValidateCode.listElementRefNotFound), withIndex({ value: rawText(item), ref: plan.ref ?? '' }));
    }
  }
  if (typeof item === 'number' || typeof item === 'bigint') {
    if (plan.warnAbove !== undefined && item > plan.warnAbove) {
      emit(plan, 'warning', pick(ValidateCode.warnAbove, ValidateCode.listElementWarnAbove), withIndex({ value: rawText(item), limit: String(plan.warnAbove) }));
    }
    if (plan.warnBelow !== undefined && item < plan.warnBelow) {
      emit(plan, 'warning', pick(ValidateCode.warnBelow, ValidateCode.listElementWarnBelow), withIndex({ value: rawText(item), limit: String(plan.warnBelow) }));
    }
  }
}

/** FR-VAL-04・05: 列ごとのルールと警告（リストは要素ごと）。値は型に合っていて空でないもの */
function checkRules(plan: ColumnPlan, raw: RawValue, value: FValue, emit: Emit): void {
  if (Array.isArray(raw)) {
    const items = value instanceof FList ? value.items : [];
    for (let i = 0; i < raw.length; i++) checkItem(plan, raw[i], items[i] ?? raw[i], i + 1, emit);
    if (plan.maxItems !== undefined && raw.length > plan.maxItems) {
      emit(plan, 'error', ValidateCode.tooManyItems, { count: raw.length, max: plan.maxItems });
    }
    return;
  }
  checkItem(plan, raw, value, 0, emit);
  const d = plan.deviation;
  if (d !== undefined && (typeof raw === 'number' || typeof raw === 'bigint')) {
    if (Math.abs(Number(raw) - d.mean) > d.k * d.sd) {
      emit(plan, 'warning', ValidateCode.warnDeviation, { value: rawText(raw), mean: statText(d.mean), sd: statText(d.sd), k: d.k });
    }
  }
}

/** テーブルの列定義の検査。列レベル式に静的なエラーがある列の名前を返す */
function checkTableFields(project: Project, calc: Calculator, table: Table, sink: DiagnosticSink): Set<string> {
  const scope = { file: table.source?.path, table: table.name };
  const baseFields = project.common.base_fields.items;
  const baseNames = new Set(baseFields.map((f) => f.name));
  const columns = calc.columns(table);
  const formulaColumns = new Set(columns.map((c) => c.name.toLowerCase()));
  const ctx = { calc, scope, formulaColumns };
  const failed = new Set<string>();

  // 共通列の式は、テーブルの列を参照できるのでテーブルごとに検査する
  for (const field of uniqueColumns(baseFields)) {
    if (field.formula === undefined) continue;
    const sub = new DiagnosticSink();
    const onlyFormula: FieldDef = { name: field.name, type: field.type, formula: field.formula };
    if (checkFieldDef(ctx, onlyFormula, sub)) failed.add(field.name);
    // 式以外の検査は共通設定の検査（validateCommon）で行うので、式の診断だけを残す
    for (const d of sub.items) if (d.code === ValidateCode.columnFormulaError) sink.items.push(d);
  }

  const seen = new Set<string>();
  for (const field of table.fields) {
    const base = { ...scope, field: field.name };
    if (baseNames.has(field.name)) sink.push(base, 'error', ValidateCode.duplicateBaseColumn, { name: field.name });
    else if (seen.has(field.name)) sink.push(base, 'error', ValidateCode.duplicateColumn, { name: field.name });
    seen.add(field.name);
    if (checkFieldDef(ctx, field, sink)) failed.add(field.name);
  }

  // 主キーは 1 テーブルに 1 つ
  const primaries = columns.filter((c) => c.primary === true);
  if (primaries.length > 1) {
    const names = primaries.map((c) => c.name).join(', ');
    for (const field of table.fields) {
      if (field.primary === true) {
        sink.push({ ...scope, field: field.name }, 'error', ValidateCode.multiplePrimary, { fields: names });
      }
    }
  }
  return failed;
}


/** テーブルを検査する（列定義とすべてのセル）。読み込み時の診断は含めない */
export function validateTable(project: Project, calc: Calculator, table: Table): Diagnostic[] {
  const sink = new DiagnosticSink();
  const plans = planColumns(calc, table, checkTableFields(project, calc, table, sink));
  const file = table.source?.path;

  for (const record of table.records) {
    let recordKey: string | undefined | null = null;
    const emit: Emit = (plan, severity, code, params) => {
      if (recordKey === null) recordKey = calc.recordKey(table, record);
      sink.push({ file, table: table.name, recordUid: record.uid, recordKey, field: plan.column.name }, severity, code, params);
    };
    for (const plan of plans) {
      const column = plan.column;
      const res = calc.getCell(table, record.uid, column.name);
      if (res.error !== undefined) {
        // 列レベル式の静的なエラーは列定義の検査で 1 回だけ示す
        if (res.source === 'formula' && plan.formulaFailed) continue;
        const issue = formulaIssue(res.error);
        emit(plan, 'error', issue.code, issue.params);
        continue;
      }
      const raw = res.raw;
      if (raw === undefined) {
        if (plan.isPrimary) emit(plan, 'error', ValidateCode.primaryKeyMissing, { field: column.name });
        else if (plan.required) emit(plan, 'error', ValidateCode.required, {});
        continue;
      }
      // 型の検査は、ファイルの値だけ（式の結果は checkResultType で、default は列定義で検査済み）
      let typeValid = true;
      if (res.source === 'value') {
        const check = inspectRawValue(raw, column, plan.enumValues);
        for (const issue of check.issues) emit(plan, 'error', issue.code, issue.params);
        typeValid = check.typeValid;
      } else if (res.source === 'default') {
        typeValid = isRawTypeValid(raw, column);
      }
      // 型に合わない値と、default の "" / [] にはルールを当てはめない
      if (!typeValid || isEmptyValue(raw)) continue;

      if (plan.counts !== undefined) {
        const k = valueKey(res.value);
        const count = k === undefined ? 0 : (plan.counts.get(k) ?? 0);
        if (count > 1) {
          const code = plan.isPrimary ? ValidateCode.primaryKeyDuplicate : ValidateCode.duplicateValue;
          emit(plan, 'error', code, { value: rawText(raw), count });
        }
      }
      if (plan.hasRules) checkRules(plan, raw, res.value, emit);
    }
  }
  return sink.items;
}

/** 共通設定の検査（共通列の列定義・列挙型・セル色） */
export function validateCommon(project: Project, calc: Calculator): Diagnostic[] {
  const sink = new DiagnosticSink();
  const common = project.common;

  const baseFile = common.base_fields.source?.path;
  const ctx = { calc, scope: { file: baseFile }, formulaColumns: null };
  const seen = new Set<string>();
  for (const field of common.base_fields.items) {
    if (seen.has(field.name)) {
      sink.push({ file: baseFile, field: field.name }, 'error', ValidateCode.duplicateColumn, { name: field.name });
    }
    seen.add(field.name);
    checkFieldDef(ctx, field, sink);
  }
  const primaries = common.base_fields.items.filter((f) => f.primary === true);
  if (primaries.length > 1) {
    const names = primaries.map((f) => f.name).join(', ');
    for (const field of primaries) {
      sink.push({ file: baseFile, field: field.name }, 'error', ValidateCode.multiplePrimary, { fields: names });
    }
  }

  const enumFile = common.enums.source?.path;
  const enumNames = new Set<string>();
  for (const def of common.enums.items) {
    if (enumNames.has(def.name)) sink.push({ file: enumFile }, 'error', ValidateCode.duplicateEnum, { name: def.name });
    enumNames.add(def.name);
    const values = new Set<string>();
    for (const value of def.values) {
      if (values.has(value)) {
        sink.push({ file: enumFile }, 'error', ValidateCode.duplicateEnumValue, { enum: def.name, value });
      }
      values.add(value);
    }
  }

  const colorFile = common.colors.source?.path;
  const colorKeys = new Set<string>();
  for (const def of common.colors.items) {
    if (colorKeys.has(def.key)) sink.push({ file: colorFile }, 'error', ValidateCode.duplicateColor, { key: def.key });
    colorKeys.add(def.key);
  }
  return sink.items;
}

/**
 * プロジェクト全体を検査する。読み込み時の診断（プロジェクト設定・共通設定・各テーブル・読み込みエラーのテーブル）を含める。
 * 並びはプロジェクトの診断、共通設定、テーブル名の順（テーブルごとに読み込み時の診断、検査の結果）
 */
export function validateProject(project: Project, calc: Calculator): Diagnostic[] {
  const result: Diagnostic[] = [...project.diagnostics, ...validateCommon(project, calc)];
  const tables = [...project.tables, ...project.brokenTables].sort((a, b) => compareNames(a.name, b.name));
  for (const table of tables) {
    result.push(...table.diagnostics);
    if (table.kind === 'table') result.push(...validateTable(project, calc, table));
  }
  return result;
}
