// 検査（§8）。式を計算した後の実効値に対して行う（FR-VAL-02）。画面と CLI で同じ関数を使う（FR-VAL-11）
import type { RawValue } from '../model/cell';
import { isEmptyValue } from '../model/cell';
import type { Diagnostic } from '../model/diagnostic';
import type { FieldDef } from '../model/field';
import { elementType, isListType } from '../model/field';
import type { Project } from '../model/project';
import { compareNames } from '../model/project';
import type { Table, TableRecord } from '../model/table';
import type { Calculator, CellResult } from '../calc';
import { valueKey } from '../calc';
import { FList } from '../formula';
import type { FValue } from '../formula';
import { ValidateCode } from './codes';
import { checkFieldDef, compareToBound, DiagnosticSink, parseRef } from './fields';
import { formulaIssue } from './formula';
import { regexTest } from './regex';
import { checkRawValue, codePointLength, isRawTypeValid, rawText } from './values';
import type { Issue } from './values';

function uniqueColumns(columns: readonly FieldDef[]): FieldDef[] {
  const seen = new Set<string>();
  return columns.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
}

function itemsOf(value: FValue): FValue[] {
  return value instanceof FList ? [...value.items] : [value];
}

function rawItems(raw: RawValue): RawValue[] {
  return Array.isArray(raw) ? raw : [raw];
}

/** 統計値の表記（有効数字 6 桁） */
function statText(n: number): string {
  return String(Number(n.toPrecision(6)));
}

interface DeviationStats {
  mean: number;
  sd: number;
  k: number;
}

/** 列ごとの事前の集計（一意性・主キーの重複・標準偏差・ref の参照先の値） */
interface ColumnStats {
  counts?: Map<string, number>;
  deviation?: DeviationStats;
  /** ref の参照先の値のキー。参照先が解決できなければ undefined（列定義の検査で示す） */
  refKeys?: Set<string>;
  refText?: string;
}

/** 実効値が型に合っていて、ルールを当てはめてよいか */
function usable(res: CellResult, field: FieldDef): boolean {
  if (res.raw === undefined) return false;
  // 式の結果は checkResultType で検査済み
  if (res.source === 'override' || res.source === 'formula') return true;
  return isRawTypeValid(res.raw, field);
}

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

function collectStats(
  calc: Calculator,
  table: Table,
  columns: readonly FieldDef[],
  primary: FieldDef | undefined,
): Map<string, ColumnStats> {
  const stats = new Map<string, ColumnStats>();
  const refCache = new Map<string, Set<string> | null>();
  for (const column of columns) {
    const s: ColumnStats = {};
    const countKeys = column === primary || column.validation?.unique === true;
    const k = column.anomaly?.warn_deviation;
    const wantDeviation = k !== undefined && k > 0 && (column.type === 'int' || column.type === 'int64' || column.type === 'float');
    if (countKeys || wantDeviation) {
      const counts = new Map<string, number>();
      const numbers: number[] = [];
      for (const record of table.records) {
        const res = calc.getCell(table, record.uid, column.name);
        if (res.error !== undefined || !usable(res, column) || isEmptyValue(res.raw)) continue;
        if (countKeys) {
          const key = valueKey(res.value);
          if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        if (wantDeviation && (typeof res.raw === 'number' || typeof res.raw === 'bigint')) numbers.push(Number(res.raw));
      }
      if (countKeys) s.counts = counts;
      // 値が 2 つ未満か、標準偏差が 0 なら判定しない
      if (wantDeviation && numbers.length >= 2) {
        const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
        const variance = numbers.reduce((a, b) => a + (b - mean) * (b - mean), 0) / numbers.length;
        const sd = Math.sqrt(variance);
        if (sd > 0) s.deviation = { mean, sd, k: k as number };
      }
    }
    if (column.ref !== undefined) {
      const keys = refTargetKeys(calc, column.ref, refCache);
      if (keys !== null) {
        s.refKeys = keys;
        s.refText = column.ref;
      }
    }
    stats.set(column.name, s);
  }
  return stats;
}

/** FR-VAL-04・05: 列ごとのルールと警告。値は型に合っていて空でないもの */
function checkRules(column: FieldDef, raw: RawValue, value: FValue, stats: ColumnStats, out: (severity: 'error' | 'warning', issue: Issue) => void): void {
  const type = column.type;
  const list = isListType(type);
  const elem = elementType(type);
  const items = rawItems(raw);
  const v = column.validation;
  if (v !== undefined) {
    for (const [rule, bound] of [
      ['min', v.min],
      ['max', v.max],
    ] as const) {
      if (bound === undefined) continue;
      items.forEach((item, i) => {
        const c = compareToBound(elem, item, bound);
        if (c === undefined) return;
        if (rule === 'min' ? c >= 0 : c <= 0) return;
        const params = { value: rawText(item), [rule]: String(bound) };
        const code =
          rule === 'min'
            ? list
              ? ValidateCode.listElementBelowMin
              : ValidateCode.belowMin
            : list
              ? ValidateCode.listElementAboveMax
              : ValidateCode.aboveMax;
        out('error', { code, params: list ? { index: i + 1, ...params } : params });
      });
    }
    if (v.max_length !== undefined && elem === 'string') {
      const max = v.max_length;
      items.forEach((item, i) => {
        if (typeof item !== 'string') return;
        const length = codePointLength(item);
        if (length <= max) return;
        out(
          'error',
          list
            ? { code: ValidateCode.listElementTooLong, params: { index: i + 1, length, max } }
            : { code: ValidateCode.tooLong, params: { length, max } },
        );
      });
    }
    if (v.max_items !== undefined && Array.isArray(raw) && raw.length > v.max_items) {
      out('error', { code: ValidateCode.tooManyItems, params: { count: raw.length, max: v.max_items } });
    }
    if (v.regex !== undefined && (elem === 'string' || elem === 'enum')) {
      const pattern = v.regex;
      items.forEach((item, i) => {
        if (typeof item !== 'string' || regexTest(pattern, item) !== false) return;
        out(
          'error',
          list
            ? { code: ValidateCode.listElementRegexMismatch, params: { index: i + 1, value: item, pattern } }
            : { code: ValidateCode.regexMismatch, params: { value: item, pattern } },
        );
      });
    }
  }

  // ref の参照先の存在（参照先の列に値があるか）
  if (stats.refKeys !== undefined) {
    const keys = stats.refKeys;
    itemsOf(value).forEach((item, i) => {
      const k = valueKey(item);
      if (k !== undefined && keys.has(k)) return;
      const text = rawText(items[i] ?? '');
      out(
        'error',
        list
          ? { code: ValidateCode.listElementRefNotFound, params: { index: i + 1, value: text, ref: stats.refText ?? '' } }
          : { code: ValidateCode.refNotFound, params: { value: text, ref: stats.refText ?? '' } },
      );
    });
  }

  const a = column.anomaly;
  if (a !== undefined) {
    for (const [rule, limit] of [
      ['warn_above', a.warn_above],
      ['warn_below', a.warn_below],
    ] as const) {
      if (limit === undefined || (elem !== 'int' && elem !== 'int64' && elem !== 'float')) continue;
      items.forEach((item, i) => {
        if (typeof item !== 'number' && typeof item !== 'bigint') return;
        if (rule === 'warn_above' ? !(item > limit) : !(item < limit)) return;
        const params = { value: rawText(item), limit: String(limit) };
        const code =
          rule === 'warn_above'
            ? list
              ? ValidateCode.listElementWarnAbove
              : ValidateCode.warnAbove
            : list
              ? ValidateCode.listElementWarnBelow
              : ValidateCode.warnBelow;
        out('warning', { code, params: list ? { index: i + 1, ...params } : params });
      });
    }
    const d = stats.deviation;
    if (d !== undefined && (typeof raw === 'number' || typeof raw === 'bigint')) {
      const n = Number(raw);
      if (Math.abs(n - d.mean) > d.k * d.sd) {
        out('warning', {
          code: ValidateCode.warnDeviation,
          params: { value: rawText(raw), mean: statText(d.mean), sd: statText(d.sd), k: d.k },
        });
      }
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
  const formulaFailed = checkTableFields(project, calc, table, sink);
  const columns = uniqueColumns(calc.columns(table));
  const primary = calc.primaryColumn(table);
  const stats = collectStats(calc, table, columns, primary);
  const file = table.source?.path;

  for (const record of table.records) {
    let recordKey: string | undefined | null = null;
    const keyOf = (r: TableRecord): string | undefined => {
      if (recordKey === null) recordKey = calc.recordKey(table, r);
      return recordKey;
    };
    for (const column of columns) {
      const res = calc.getCell(table, record.uid, column.name);
      const at = (): Omit<Diagnostic, 'severity' | 'code' | 'params'> => ({
        file,
        table: table.name,
        recordUid: record.uid,
        recordKey: keyOf(record),
        field: column.name,
      });
      const emit = (severity: 'error' | 'warning', issue: Issue): void => sink.push(at(), severity, issue.code, issue.params);

      if (res.error !== undefined) {
        // 列レベル式の静的なエラーは列定義の検査で 1 回だけ示す
        if (res.source === 'formula' && formulaFailed.has(column.name)) continue;
        emit('error', formulaIssue(res.error));
        continue;
      }
      const raw = res.raw;
      if (raw === undefined) {
        if (column === primary) emit('error', { code: ValidateCode.primaryKeyMissing, params: { field: column.name } });
        else if (column.validation?.required === true) emit('error', { code: ValidateCode.required, params: {} });
        continue;
      }
      if (res.source === 'value') {
        for (const issue of checkRawValue(raw, column, calc.enumValues(column))) emit('error', issue);
      }
      // 型に合わない値と、default の "" / [] にはルールを当てはめない
      if (!usable(res, column) || isEmptyValue(raw)) continue;

      const s = stats.get(column.name) ?? {};
      if (s.counts !== undefined) {
        const k = valueKey(res.value);
        const count = k === undefined ? 0 : (s.counts.get(k) ?? 0);
        if (count > 1) {
          const code = column === primary ? ValidateCode.primaryKeyDuplicate : ValidateCode.duplicateValue;
          emit('error', { code, params: { value: rawText(raw), count } });
        }
      }
      checkRules(column, raw, res.value, s, emit);
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
