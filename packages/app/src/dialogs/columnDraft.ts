// 列の設定のダイアログ（FR-COL-02〜04）の下書きと、下書きから列定義・編集の手順を作る処理。DOM に依存しない。
// 列定義の「ファイルに書かれていたときだけ値を持つ」キー（model/field.ts）を保つため、利用者が変えた欄だけを列定義に当てる
import type {
  BoundValue,
  CommandResult,
  Diagnostic,
  EditFailure,
  FieldDef,
  FieldTypeInfo,
  FieldType,
  InputContext,
  InputError,
  Locale,
  Project,
  RawValue,
  Table,
} from '@masterdata-maker/core';
import {
  Calculator,
  EditCode,
  changeColumnType,
  cloneFieldDef,
  compileRegex,
  elementType,
  emptyResult,
  formatDiagnostic,
  formatValueText,
  inputContext,
  isListType,
  isValidIdentifier,
  parseCellInput,
  parseFormula,
  parseRef,
  renameColumn,
  updateColumn,
  validateCommon,
  validateTable,
} from '@masterdata-maker/core';

/** 列の設定の欄（すべてテキストか真偽値で持ち、確定するときに列の型で解釈する） */
export interface ColumnDraft {
  name: string;
  type: FieldType;
  display_name: string;
  description: string;
  export: boolean;
  editable: boolean;
  /** 共通列の設定でだけ使う */
  primary: boolean;
  auto: boolean;
  /** 列レベル式（先頭の `=` は付けない。付けてもよい） */
  formula: string;
  default: string;
  enum_ref: string;
  ref_table: string;
  ref_column: string;
  required: boolean;
  unique: boolean;
  min: string;
  max: string;
  max_length: string;
  max_items: string;
  regex: string;
  warn_above: string;
  warn_below: string;
  warn_deviation: string;
}

export type DraftKey = keyof ColumnDraft;

/** 欄ごとの誤り（文言は formatInputError で作る） */
export type FieldError = Pick<InputError, 'code' | 'params' | 'index'>;
export type DraftErrors = Partial<Record<DraftKey, FieldError>>;

/** 列定義の検査（FR-VAL-07）の誤りを、編集の失敗として返すときの文言キー（{message} に検査の文言を入れる） */
export const DEFINITION_ERROR = 'ui.column.error.definition';

export function isEnumType(type: FieldType): boolean {
  return type === 'enum' || type === 'list<enum>';
}

/** 列の型で使える検査ルール・警告条件（core の列定義の検査と同じ判定） */
export interface Applicable {
  minMax: boolean;
  maxLength: boolean;
  maxItems: boolean;
  regex: boolean;
  warnLimits: boolean;
  warnDeviation: boolean;
  enumRef: boolean;
}

export function applicableRules(type: FieldType): Applicable {
  const elem = elementType(type);
  const numeric = elem === 'int' || elem === 'int64' || elem === 'float';
  return {
    minMax: numeric || type === 'datetime',
    maxLength: elem === 'string',
    maxItems: isListType(type),
    regex: elem === 'string' || elem === 'enum',
    warnLimits: numeric,
    warnDeviation: type === 'int' || type === 'int64' || type === 'float',
    enumRef: elem === 'enum',
  };
}

function boundText(value: BoundValue | undefined, type: FieldType, timeZone: string): string {
  if (value === undefined) return '';
  if (typeof value === 'string' && type === 'datetime') return formatValueText(value, 'datetime', timeZone);
  return String(value);
}

function optionalText(value: number | bigint | undefined): string {
  return value === undefined ? '' : String(value);
}

/** 列定義を下書きにする */
export function draftFromField(field: FieldDef, timeZone: string): ColumnDraft {
  const v = field.validation ?? {};
  const a = field.anomaly ?? {};
  const ref = field.ref === undefined ? null : parseRef(field.ref);
  return {
    name: field.name,
    type: field.type,
    display_name: field.display_name ?? '',
    description: field.description ?? '',
    export: field.export ?? true,
    editable: field.editable ?? true,
    primary: field.primary === true,
    auto: field.auto !== undefined,
    formula: field.formula ?? '',
    default: field.default === undefined ? '' : formatValueText(field.default, field.type, timeZone),
    enum_ref: field.enum_ref ?? '',
    ref_table: ref?.table ?? field.ref ?? '',
    ref_column: ref?.column ?? '',
    required: v.required === true,
    unique: v.unique === true,
    min: boundText(v.min, field.type, timeZone),
    max: boundText(v.max, field.type, timeZone),
    max_length: optionalText(v.max_length),
    max_items: optionalText(v.max_items),
    regex: v.regex ?? '',
    warn_above: optionalText(a.warn_above),
    warn_below: optionalText(a.warn_below),
    warn_deviation: optionalText(a.warn_deviation),
  };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: FieldError };

function parseText<T>(text: string, info: FieldTypeInfo, ctx: InputContext): Parsed<T | undefined> {
  const r = parseCellInput(text, info, ctx, 'value');
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: r.kind === 'value' ? (r.value as T) : undefined };
}

/** min / max の値（数値の列は数値、int64 は BigInt、datetime は時差付きの ISO 8601） */
function parseBound(text: string, type: FieldType, ctx: InputContext): Parsed<BoundValue | undefined> {
  const elem = elementType(type);
  const info: FieldTypeInfo = type === 'datetime' ? { type: 'datetime' } : elem === 'int64' ? { type: 'int64' } : { type: 'float' };
  return parseText<BoundValue>(text, info, ctx);
}

function parseLimit(text: string, type: FieldType, ctx: InputContext): Parsed<number | bigint | undefined> {
  return parseText<number | bigint>(text, elementType(type) === 'int64' ? { type: 'int64' } : { type: 'float' }, ctx);
}

function parseCount(text: string, ctx: InputContext): Parsed<number | undefined> {
  const r = parseText<number>(text, { type: 'int' }, ctx);
  if (r.ok && r.value !== undefined && r.value < 0) return { ok: false, error: { code: 'ui.column.error.nonNegativeInt', params: { input: text } } };
  if (!r.ok) return { ok: false, error: { code: 'ui.column.error.nonNegativeInt', params: { input: text } } };
  return r;
}

function parsePositive(text: string, ctx: InputContext): Parsed<number | undefined> {
  const r = parseText<number>(text, { type: 'float' }, ctx);
  if (!r.ok || (r.value !== undefined && !(r.value > 0))) return { ok: false, error: { code: 'ui.column.error.positive', params: { input: text } } };
  return r;
}

/** 式の欄のテキストを、列定義に書く式（先頭の `=` を除く）にする */
export function normalizeFormula(text: string): string {
  const t = text.trim();
  return (t.startsWith('=') ? t.slice(1) : t).trim();
}

/** 式の構文の誤り。正しければ null */
export function formulaSyntaxError(text: string): FieldError | null {
  const formula = normalizeFormula(text);
  if (formula === '') return null;
  const parsed = parseFormula(formula);
  if (parsed.ok) return null;
  return { code: parsed.error.messageCode, params: { ...parsed.error.messageArgs } };
}

export type BuildResult = { ok: true; field: FieldDef } | { ok: false; errors: DraftErrors };

/**
 * 下書きのうち、initial から変えた欄だけを current（今の列定義）に当てた列定義を作る。
 * 列名と型は current のまま（列名の変更・型の変更は別の手順で先に行う）。値の欄が型に合わなければ誤りを返す（FR-EDT-05）
 */
export function buildField(current: FieldDef, initial: ColumnDraft, draft: ColumnDraft, ctx: InputContext): BuildResult {
  const next = cloneFieldDef(current);
  const type = next.type;
  const errors: DraftErrors = {};
  const changed = (k: DraftKey): boolean => draft[k] !== initial[k];

  for (const k of ['display_name', 'description'] as const) {
    if (!changed(k)) continue;
    if (draft[k].trim() === '') delete next[k];
    else next[k] = draft[k];
  }
  // 既定値（true）に戻したらキーを消す
  if (changed('export')) {
    if (draft.export) delete next.export;
    else next.export = false;
  }
  if (changed('editable')) {
    if (draft.editable) delete next.editable;
    else next.editable = false;
  }
  if (changed('primary')) {
    if (draft.primary) next.primary = true;
    else delete next.primary;
  }
  if (changed('auto')) {
    if (draft.auto) next.auto = 'increment';
    else delete next.auto;
  }
  if (changed('formula')) {
    const formula = normalizeFormula(draft.formula);
    const syntax = formulaSyntaxError(formula);
    if (syntax !== null) errors.formula = syntax;
    else if (formula === '') delete next.formula;
    else next.formula = formula;
  }
  if (changed('enum_ref') && isEnumType(type)) {
    if (draft.enum_ref === '') delete next.enum_ref;
    else next.enum_ref = draft.enum_ref;
  }
  if (changed('ref_table') || changed('ref_column')) {
    if (draft.ref_table === '') delete next.ref;
    else if (draft.ref_column === '') errors.ref_column = { code: 'ui.column.error.refColumn', params: {} };
    else next.ref = `${draft.ref_table}.${draft.ref_column}`;
  }
  if (changed('default')) {
    if (draft.default === '') delete next.default;
    else {
      const r = parseText<RawValue>(draft.default, { type, enum_ref: next.enum_ref }, ctx);
      if (!r.ok) errors.default = r.error;
      else if (r.value === undefined) delete next.default;
      else next.default = r.value;
    }
  }

  const validation = { ...(next.validation ?? {}) };
  let validationChanged = false;
  for (const k of ['required', 'unique'] as const) {
    if (!changed(k)) continue;
    validationChanged = true;
    if (draft[k]) validation[k] = true;
    else delete validation[k];
  }
  for (const k of ['min', 'max'] as const) {
    if (!changed(k)) continue;
    validationChanged = true;
    const r = parseBound(draft[k], type, ctx);
    if (!r.ok) errors[k] = r.error;
    else if (r.value === undefined) delete validation[k];
    else validation[k] = r.value;
  }
  for (const k of ['max_length', 'max_items'] as const) {
    if (!changed(k)) continue;
    validationChanged = true;
    const r = parseCount(draft[k], ctx);
    if (!r.ok) errors[k] = r.error;
    else if (r.value === undefined) delete validation[k];
    else validation[k] = r.value;
  }
  if (changed('regex')) {
    validationChanged = true;
    if (draft.regex === '') delete validation.regex;
    else {
      const compiled = compileRegex(draft.regex);
      if (!compiled.ok) errors.regex = { code: 'ui.column.error.regex', params: { detail: compiled.detail } };
      else validation.regex = draft.regex;
    }
  }
  if (validationChanged) {
    if (Object.keys(validation).length === 0) delete next.validation;
    else next.validation = validation;
  }

  const anomaly = { ...(next.anomaly ?? {}) };
  let anomalyChanged = false;
  for (const k of ['warn_above', 'warn_below'] as const) {
    if (!changed(k)) continue;
    anomalyChanged = true;
    const r = parseLimit(draft[k], type, ctx);
    if (!r.ok) errors[k] = r.error;
    else if (r.value === undefined) delete anomaly[k];
    else anomaly[k] = r.value;
  }
  if (changed('warn_deviation')) {
    anomalyChanged = true;
    const r = parsePositive(draft.warn_deviation, ctx);
    if (!r.ok) errors.warn_deviation = r.error;
    else if (r.value === undefined) delete anomaly.warn_deviation;
    else anomaly.warn_deviation = r.value;
  }
  if (anomalyChanged) {
    if (Object.keys(anomaly).length === 0) delete next.anomaly;
    else next.anomaly = anomaly;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, field: next };
}

/** 確定する前に分かる誤り（列名の書式・列挙型の指定・値の欄）。プロジェクトは変えない */
export function draftErrors(original: FieldDef, initial: ColumnDraft, draft: ColumnDraft, ctx: InputContext): DraftErrors {
  const errors: DraftErrors = {};
  if (!isValidIdentifier(draft.name)) errors.name = { code: EditCode.columnInvalidName, params: { name: draft.name } };
  if (isEnumType(draft.type) && draft.enum_ref === '') {
    errors.enum_ref = { code: EditCode.enumRefRequired, params: { column: draft.name, type: draft.type } };
  }
  const probe = cloneFieldDef(original);
  probe.type = draft.type;
  if (isEnumType(draft.type) && draft.enum_ref !== '') probe.enum_ref = draft.enum_ref;
  const built = buildField(probe, initial, draft, ctx);
  if (!built.ok) Object.assign(errors, built.errors);
  return errors;
}

/** 列名と型以外の欄を変えたか */
export function hasSettingChanges(initial: ColumnDraft, draft: ColumnDraft): boolean {
  return (Object.keys(draft) as DraftKey[]).some((k) => k !== 'name' && k !== 'type' && draft[k] !== initial[k]);
}

export function diagnosticKey(d: Diagnostic): string {
  return `${d.code}\u0000${JSON.stringify(d.params ?? {})}`;
}

/** テーブルの列の、列定義の検査（FR-VAL-07）のエラー。セルの検査はしない（レコードの無いテーブルとして検査する） */
export function columnDefinitionErrors(project: Project, tableUid: number, column: string): Diagnostic[] {
  const table = project.tables.find((t) => t.uid === tableUid);
  if (table === undefined) return [];
  const calc = new Calculator(project);
  const probe: Table = { ...table, records: [] };
  return validateTable(project, calc, probe).filter((d) => d.severity === 'error' && d.field === column && d.recordUid === undefined);
}

/** 共通列の、列定義の検査のエラー（names の列だけ） */
export function baseFieldDefinitionErrors(project: Project, names: ReadonlySet<string>): Diagnostic[] {
  const calc = new Calculator(project);
  return validateCommon(project, calc).filter((d) => d.severity === 'error' && d.field !== undefined && names.has(d.field));
}

/** 検査のエラーのうち before に無いもの（もとからあったエラーでは止めない）を、編集の失敗の形にする */
export function freshDefinitionFailures(
  diagnostics: readonly Diagnostic[],
  before: ReadonlySet<string>,
  locale: Locale,
  where: Partial<EditFailure> = {},
): EditFailure[] {
  return diagnostics
    .filter((d) => !before.has(diagnosticKey(d)))
    .map((d) => ({ code: DEFINITION_ERROR, params: { message: formatDiagnostic(d, locale) }, ...where }));
}

export type EditStep = (project: Project) => CommandResult;

export interface ColumnChangeInput {
  table: number;
  /** 今の列定義 */
  original: FieldDef;
  /** 開いたときの下書き */
  initial: ColumnDraft;
  draft: ColumnDraft;
  locale: Locale;
}

export interface ColumnChangePlan {
  /** 履歴に積む操作の名前の文言コード */
  label: string;
  steps: EditStep[];
  nameChanged: boolean;
  typeChanged: boolean;
}

/**
 * 列の設定の変更を、EditSession.applyGroup に渡す手順にする（1 回の操作として元に戻せる）。
 * 列名の変更（式・ref・REF() の書き換えを含む。FR-COL-03）→ 型の変更（FR-COL-04）→ 設定（FR-COL-02）→ 列定義の検査（FR-VAL-07）の順。
 * 列定義の検査で新しいエラーが出たら、最後の手順が失敗して全体を取りやめる
 */
export function planColumnChange(project: Project, input: ColumnChangeInput): ColumnChangePlan {
  const { table, original, initial, draft, locale } = input;
  const nameChanged = draft.name !== original.name;
  const typeChanged = draft.type !== original.type;
  const settings = hasSettingChanges(initial, draft);
  const label =
    nameChanged && !typeChanged && !settings
      ? EditCode.opRenameColumn
      : typeChanged && !nameChanged && !settings
        ? EditCode.opChangeColumnType
        : EditCode.opUpdateColumn;
  const before = new Set(columnDefinitionErrors(project, table, original.name).map(diagnosticKey));
  const steps: EditStep[] = [];
  if (nameChanged) steps.push((p) => renameColumn(p, { table, from: original.name, to: draft.name }));
  if (typeChanged) {
    const enumRef = isEnumType(draft.type) && draft.enum_ref !== '' ? draft.enum_ref : undefined;
    steps.push((p) => changeColumnType(p, { table, column: draft.name, type: draft.type, enum_ref: enumRef }));
  }
  steps.push((p) => {
    const current = p.tables.find((t) => t.uid === table)?.fields.find((f) => f.name === draft.name);
    if (current === undefined) return { ok: false, failures: [{ code: EditCode.columnNotFound, params: { column: draft.name }, table }] };
    const built = buildField(current, initial, draft, inputContext(p));
    if (!built.ok) {
      const failures = Object.values(built.errors).map((e) => ({ ...e, table, column: draft.name }));
      return { ok: false, failures };
    }
    return updateColumn(p, { table, column: draft.name, field: built.field });
  });
  steps.push((p) => {
    const failures = freshDefinitionFailures(columnDefinitionErrors(p, table, draft.name), before, locale, { table, column: draft.name });
    return failures.length === 0 ? emptyResult(label) : { ok: false, failures };
  });
  return { label, steps, nameChanged, typeChanged };
}
