// テーブルの作成・複製・名前の変更・削除（FR-TBL-01〜02）と共通設定の編集（FR-TBL-03）
import type { RawValue } from '../../model/cell';
import { cellValue, isRichCell } from '../../model/cell';
import type { ColorDef, EnumDef } from '../../model/common';
import type { FieldDef } from '../../model/field';
import { cloneFieldDef } from '../../model/field';
import type { Project } from '../../model/project';
import type { Table } from '../../model/table';
import { emptyView } from '../../model/table';
import { extractDependencies } from '../../formula/dependencies';
import { ParseCache } from '../../formula/parser';
import { renameColumnInFormula, renameRefColumnInFormula, renameRefTableInFormula } from '../../formula/rename';
import { EditCode } from '../codes';
import { columnsOf, editableTable, isValidIdentifier, unique } from '../helpers';
import type { TableData } from '../patch';
import { cloneColorDef, cloneEnumDef, cloneView, toCellData, toTableData } from '../patch';
import type { CommandResult, EditFailure } from '../transaction';
import { emptyResult, failed, TxBuilder } from '../transaction';
import { addDefinitionRewrites, renameInView, splitRef } from './rewrite';

function isTableNameUsed(project: Project, name: string, exceptUid?: number): boolean {
  return [...project.tables, ...project.brokenTables].some((t) => t.uid !== exceptUid && t.name === name);
}

/** テーブル名として使えるか（列名と同じ書式。ファイル名 `<table>.<拡張子>` になる。DR-04） */
export function validateTableName(project: Project, name: string, exceptUid?: number): EditFailure[] {
  if (!isValidIdentifier(name)) return [{ code: EditCode.tableInvalidName, params: { name } }];
  if (isTableNameUsed(project, name, exceptUid)) return [{ code: EditCode.tableDuplicate, params: { name } }];
  return [];
}

/** 使われていないテーブル名の候補（`<base>_copy`、`<base>_copy2`、…） */
export function suggestTableName(project: Project, base: string): string {
  let name = `${base}_copy`;
  for (let i = 2; isTableNameUsed(project, name); i++) name = `${base}_copy${i}`;
  return name;
}

function validateFieldList(project: Project, fields: readonly FieldDef[], table?: number): EditFailure[] {
  const failures: EditFailure[] = [];
  const seen = new Set(project.common.base_fields.items.map((f) => f.name));
  for (const field of fields) {
    const where = { table, column: field.name };
    if (!isValidIdentifier(field.name)) failures.push({ code: EditCode.columnInvalidName, params: { name: field.name }, ...where });
    else if (seen.has(field.name)) failures.push({ code: EditCode.columnDuplicate, params: { name: field.name }, ...where });
    seen.add(field.name);
  }
  return failures;
}

export interface CreateTableArgs {
  name: string;
  display_name?: string;
  /** 共通列の後ろに置く列（省略すれば共通列だけの雛形） */
  fields?: FieldDef[];
}

/** テーブルの新規作成（FR-TBL-01）。共通列は自動で付く（P-03）。ファイルは保存のときに作る（P-43） */
export function createTable(project: Project, args: CreateTableArgs): CommandResult {
  const fields = args.fields ?? [];
  const failures = [...validateTableName(project, args.name), ...validateFieldList(project, fields)];
  if (failures.length > 0) return failed(failures);
  const data: TableData = {
    uid: project.uids.next(),
    name: args.name,
    fields: fields.map(cloneFieldDef),
    records: [],
    view: emptyView(),
    source: null,
    diagnostics: [],
  };
  if (args.display_name !== undefined && args.display_name !== '') data.display_name = args.display_name;
  const b = new TxBuilder();
  b.add({ op: 'addTable', table: data });
  return b.result(EditCode.opCreateTable, { table: data.uid, records: [], columns: [] });
}

export interface DuplicateTableArgs {
  table: number;
  name: string;
  /** 省略すれば元の表示名 */
  display_name?: string;
}

/** テーブルの複製（FR-TBL-02）。レコードの内部番号は振り直す。主キーなどの値はそのまま */
export function duplicateTable(project: Project, args: DuplicateTableArgs): CommandResult {
  const found = editableTable(project, args.table);
  if (!found.ok) return failed(found.failures);
  const failures = validateTableName(project, args.name);
  if (failures.length > 0) return failed(failures);
  const data = toTableData(found.table);
  data.uid = project.uids.next();
  data.name = args.name;
  data.source = null;
  data.diagnostics = [];
  for (const record of data.records) record.uid = project.uids.next();
  if (args.display_name !== undefined) {
    if (args.display_name === '') delete data.display_name;
    else data.display_name = args.display_name;
  }
  const b = new TxBuilder();
  b.add({ op: 'addTable', table: data });
  return b.result(EditCode.opDuplicateTable, { table: data.uid, records: [], columns: [] });
}

export interface RenameTableArgs {
  table: number;
  name: string;
}

/**
 * テーブル名（識別子）の変更（FR-TBL-02）。他のテーブル（と共通列）の `ref` の `old.列` と、
 * 全テーブルの式の中の `REF("old", …)` もまとめて書き換える。ファイル名の変更は保存のときに行う（P-43）
 */
export function renameTable(project: Project, args: RenameTableArgs): CommandResult {
  const found = editableTable(project, args.table);
  if (!found.ok) return failed(found.failures);
  const table = found.table;
  if (table.name === args.name) return emptyResult(EditCode.opRenameTable);
  const failures = validateTableName(project, args.name, table.uid);
  if (failures.length > 0) return failed(failures);
  const oldName = table.name;
  const b = new TxBuilder();
  b.add({ op: 'setTableName', table: table.uid, name: args.name });
  addDefinitionRewrites(project, b, {
    formula: (formula) => renameRefTableInFormula(formula, oldName, args.name),
    ref: (ref) => {
      const parts = splitRef(ref);
      return parts !== null && parts.table === oldName ? `${args.name}.${parts.column}` : ref;
    },
  });
  return b.result(EditCode.opRenameTable, { table: table.uid, records: [], columns: [] });
}

export interface TableDisplayNameArgs {
  table: number;
  /** null か空文字で表示名を消す */
  displayName: string | null;
}

export function setTableDisplayName(project: Project, args: TableDisplayNameArgs): CommandResult {
  const found = editableTable(project, args.table);
  if (!found.ok) return failed(found.failures);
  const next = args.displayName === '' ? null : args.displayName;
  if ((found.table.display_name ?? null) === next) return emptyResult(EditCode.opSetTableDisplayName);
  const b = new TxBuilder();
  b.add({ op: 'setTableDisplayName', table: found.table.uid, displayName: next });
  return b.result(EditCode.opSetTableDisplayName, { table: found.table.uid, records: [], columns: [] });
}

/** テーブルの削除（FR-TBL-02）。ファイルの削除は保存のときに行う（P-43）。参照の確認は findTableReferences で先に行う */
export function deleteTable(project: Project, args: { table: number }): CommandResult {
  const found = editableTable(project, args.table);
  if (!found.ok) return failed(found.failures);
  const b = new TxBuilder();
  b.add({ op: 'removeTable', table: found.table.uid });
  return b.result(EditCode.opDeleteTable, { table: found.table.uid, records: [], columns: [] });
}

/** あるテーブルを参照しているもの（削除前の警告用。FR-TBL-02） */
export interface TableReference {
  /** 参照している側のテーブルの uid。共通列の定義なら null */
  table: number | null;
  /** 参照している側のテーブル名（共通列なら null） */
  tableName: string | null;
  column: string;
  /** ref: 列定義の ref / formula: 列レベル式の REF() / cellFormula: セル単位式の REF() */
  kind: 'ref' | 'formula' | 'cellFormula';
  /** cellFormula のとき、その列で参照しているセルの数（それ以外は 1） */
  count: number;
}

/** テーブル（target）を参照している列定義とセル単位式の一覧。target 自身の中の参照は含めない */
export function findTableReferences(project: Project, target: number): TableReference[] {
  const table = project.tables.find((t) => t.uid === target) ?? project.brokenTables.find((t) => t.uid === target);
  if (table === undefined) return [];
  const name = table.name;
  const cache = new ParseCache();
  const refersTo = (formula: string): boolean => {
    const parsed = cache.get(formula);
    return parsed.ok && extractDependencies(parsed.ast).refs.some((r) => r.table === name);
  };
  const result: TableReference[] = [];
  const scanFields = (fields: readonly FieldDef[], owner: Table | null): void => {
    for (const field of fields) {
      const base = { table: owner?.uid ?? null, tableName: owner?.name ?? null, column: field.name, count: 1 };
      if (field.ref !== undefined && splitRef(field.ref)?.table === name) result.push({ ...base, kind: 'ref' });
      if (field.formula !== undefined && refersTo(field.formula)) result.push({ ...base, kind: 'formula' });
    }
  };
  scanFields(project.common.base_fields.items, null);
  for (const owner of project.tables) {
    if (owner.uid === target) continue;
    scanFields(owner.fields, owner);
    const counts = new Map<string, number>();
    for (const record of owner.records) {
      for (const [column, cell] of record.cells) {
        if (!isRichCell(cell) || cell.override === undefined || cell.override === '') continue;
        if (refersTo(cell.override)) counts.set(column, (counts.get(column) ?? 0) + 1);
      }
    }
    for (const [column, count] of counts) {
      result.push({ table: owner.uid, tableName: owner.name, column, kind: 'cellFormula', count });
    }
  }
  return result;
}

// ---- 共通設定（FR-TBL-03） ----

function duplicateNames(names: readonly string[]): EditFailure[] {
  const failures: EditFailure[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (name === '') failures.push({ code: EditCode.commonEmptyName, params: {} });
    else if (seen.has(name)) failures.push({ code: EditCode.commonDuplicateName, params: { name } });
    seen.add(name);
  }
  return failures;
}

/** 列挙型の一覧を置き換える */
export function setEnums(_project: Project, enums: readonly EnumDef[]): CommandResult {
  const failures = duplicateNames(enums.map((e) => e.name));
  if (failures.length > 0) return failed(failures);
  const b = new TxBuilder();
  b.add({ op: 'setCommon', part: 'enums', items: enums.map(cloneEnumDef), isDefault: false });
  return b.result(EditCode.opEditEnums);
}

/** セル色のプリセットの一覧を置き換える */
export function setColors(_project: Project, colors: readonly ColorDef[]): CommandResult {
  const failures = duplicateNames(colors.map((c) => c.key));
  if (failures.length > 0) return failed(failures);
  const b = new TxBuilder();
  b.add({ op: 'setCommon', part: 'colors', items: colors.map(cloneColorDef), isDefault: false });
  return b.result(EditCode.opEditColors);
}

/**
 * 共通列の一覧を置き換える（共通列の名前の変更は renameBaseField。ここではセルのキーは変えない）。
 * どこかのテーブルの列と同じ名前は使えない
 */
export function setBaseFields(project: Project, fields: readonly FieldDef[]): CommandResult {
  const failures: EditFailure[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    if (!isValidIdentifier(field.name)) failures.push({ code: EditCode.columnInvalidName, params: { name: field.name }, column: field.name });
    else if (seen.has(field.name)) failures.push({ code: EditCode.columnDuplicate, params: { name: field.name }, column: field.name });
    seen.add(field.name);
    for (const table of project.tables) {
      if (table.fields.some((f) => f.name === field.name)) {
        failures.push({ code: EditCode.columnDuplicate, params: { name: field.name }, table: table.uid, column: field.name });
      }
    }
    if ((field.type === 'enum' || field.type === 'list<enum>') && (field.enum_ref === undefined || field.enum_ref === '')) {
      failures.push({ code: EditCode.enumRefRequired, params: { column: field.name, type: field.type }, column: field.name });
    }
  }
  if (failures.length > 0) return failed(failures);
  const b = new TxBuilder();
  b.add({ op: 'setCommon', part: 'base_fields', items: fields.map(cloneFieldDef), isDefault: false });
  return b.result(EditCode.opEditBaseFields);
}

/**
 * 共通列の名前の変更。全テーブルのセルのキー、式の中の列名と `REF(…, "old")`、`ref` の `table.old`、表示設定を書き換える
 */
export function renameBaseField(project: Project, args: { from: string; to: string }): CommandResult {
  const { from, to } = args;
  const base = project.common.base_fields.items;
  const i = base.findIndex((f) => f.name === from);
  if (i < 0) return failed([{ code: EditCode.columnNotFound, params: { column: from }, column: from }]);
  if (from === to) return emptyResult(EditCode.opRenameBaseField);
  if (!isValidIdentifier(to)) return failed([{ code: EditCode.columnInvalidName, params: { name: to }, column: to }]);
  const failures: EditFailure[] = [];
  if (base.some((f) => f.name === to)) failures.push({ code: EditCode.columnDuplicate, params: { name: to }, column: to });
  for (const table of project.tables) {
    if (table.fields.some((f) => f.name === to)) {
      failures.push({ code: EditCode.columnDuplicate, params: { name: to }, table: table.uid, column: to });
    } else if (table.records.some((r) => r.cells.has(to) || r.extra.some(([k]) => k === to))) {
      failures.push({ code: EditCode.columnUsedByRecordKey, params: { name: to }, table: table.uid, column: to });
    }
  }
  if (failures.length > 0) return failed(failures);
  const lowerFrom = from.toLowerCase();
  const tableNames = unique([...project.tables, ...project.brokenTables].map((t) => t.name));
  const renamedBase = base.map((f, k) => (k === i ? { ...cloneFieldDef(f), name: to } : cloneFieldDef(f)));
  const b = new TxBuilder();
  for (const table of project.tables) {
    if (table.records.some((r) => r.cells.has(from))) b.add({ op: 'renameCellKey', table: table.uid, from, to });
  }
  addDefinitionRewrites(project, b, {
    baseFields: renamedBase,
    forceBaseFields: true,
    formula: (formula) => {
      // 共通列はどのテーブルにもあるので、同じレコードの参照とすべてのテーブルへの REF を書き換える
      let f = renameColumnInFormula(formula, from, to);
      for (const name of tableNames) f = renameRefColumnInFormula(f, name, from, to);
      return f;
    },
    ref: (ref) => {
      const parts = splitRef(ref);
      return parts !== null && parts.column.toLowerCase() === lowerFrom ? `${parts.table}.${to}` : ref;
    },
    nameAfter: (_owner, name) => (name === from ? to : name),
  });
  for (const table of project.tables) {
    const view = renameInView(table.view, from, to);
    if (view !== null) b.add({ op: 'setView', table: table.uid, view: cloneView(view) });
  }
  return b.result(EditCode.opRenameBaseField);
}

/** 列挙型の名前の変更。全テーブルと共通列の enum_ref も書き換える */
export function renameEnum(project: Project, args: { from: string; to: string }): CommandResult {
  const enums = project.common.enums.items;
  const i = enums.findIndex((e) => e.name === args.from);
  if (i < 0) return failed([{ code: EditCode.enumNotFound, params: { name: args.from } }]);
  if (args.from === args.to) return emptyResult(EditCode.opRenameEnum);
  const failures = duplicateNames([...enums.filter((_, k) => k !== i).map((e) => e.name), args.to]);
  if (failures.length > 0) return failed(failures);
  const b = new TxBuilder();
  b.add({
    op: 'setCommon',
    part: 'enums',
    items: enums.map((e, k) => (k === i ? { ...cloneEnumDef(e), name: args.to } : cloneEnumDef(e))),
    isDefault: false,
  });
  const base = project.common.base_fields.items;
  if (base.some((f) => f.enum_ref === args.from)) {
    b.add({
      op: 'setCommon',
      part: 'base_fields',
      items: base.map((f) => (f.enum_ref === args.from ? { ...cloneFieldDef(f), enum_ref: args.to } : cloneFieldDef(f))),
      isDefault: false,
    });
  }
  for (const table of project.tables) {
    for (const field of table.fields) {
      if (field.enum_ref !== args.from) continue;
      b.add({ op: 'updateField', table: table.uid, name: field.name, field: { ...cloneFieldDef(field), enum_ref: args.to } });
    }
  }
  return b.result(EditCode.opRenameEnum);
}

export interface EnumValueRename {
  from: string;
  to: string;
}

/** 値（リストは要素ごと）を対応表で置き換える。変わらなければ同じものを返す */
function renameEnumValue(value: RawValue, map: ReadonlyMap<string, string>): RawValue {
  if (typeof value === 'string') return map.get(value) ?? value;
  if (!Array.isArray(value)) return value;
  let changed = false;
  const next = value.map((v) => {
    const r = typeof v === 'string' ? (map.get(v) ?? v) : v;
    if (r !== v) changed = true;
    return r;
  });
  return changed ? next : value;
}

/**
 * 列挙型の値の名前の変更。その列挙型を使う列（enum・list<enum>）のセルの値と、列定義の default を書き換える。
 * 対応表はまとめて当てるので、入れ替え（A→B と B→A）もそのまま渡せる。
 * 列挙型の値の一覧は変えない（setEnums で置き換える）。式（列の式・セル単位式）の中の文字列は、値を指すとは限らないので変えない
 */
export function renameEnumValues(project: Project, args: { enum: string; renames: readonly EnumValueRename[] }): CommandResult {
  if (!project.common.enums.items.some((e) => e.name === args.enum)) return failed([{ code: EditCode.enumNotFound, params: { name: args.enum } }]);
  const map = new Map<string, string>();
  for (const r of args.renames) if (r.from !== r.to) map.set(r.from, r.to);
  if (map.size === 0) return emptyResult(EditCode.opRenameEnumValues);
  const uses = (f: FieldDef) => (f.type === 'enum' || f.type === 'list<enum>') && f.enum_ref === args.enum;
  const withDefault = (f: FieldDef): FieldDef | null => {
    if (!uses(f) || f.default === undefined) return null;
    const value = renameEnumValue(f.default, map);
    return value === f.default ? null : { ...cloneFieldDef(f), default: value };
  };
  const b = new TxBuilder();
  const base = project.common.base_fields.items;
  if (base.some((f) => withDefault(f) !== null)) {
    b.add({ op: 'setCommon', part: 'base_fields', items: base.map((f) => withDefault(f) ?? cloneFieldDef(f)), isDefault: false });
  }
  for (const table of project.tables) {
    for (const field of table.fields) {
      const next = withDefault(field);
      if (next !== null) b.add({ op: 'updateField', table: table.uid, name: field.name, field: next });
    }
    const columns = columnsOf(project, table).filter(uses);
    for (const record of table.records) {
      for (const column of columns) {
        const cell = record.cells.get(column.name);
        const value = cellValue(cell);
        if (value === undefined) continue;
        const renamed = renameEnumValue(value, map);
        if (renamed === value) continue;
        b.setCell(table.uid, record.uid, column.name, cell, { ...toCellData(cell), value: renamed });
      }
    }
  }
  return b.result(EditCode.opRenameEnumValues);
}
