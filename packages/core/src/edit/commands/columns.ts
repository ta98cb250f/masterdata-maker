// 列の挿入・削除・設定・名前の変更・型の変更・移動と、列幅・固定・非表示（FR-COL-01〜08）
import type { RawValue } from '../../model/cell';
import { cellValue, isEmptyValue } from '../../model/cell';
import type { FieldDef, FieldType } from '../../model/field';
import { cloneFieldDef } from '../../model/field';
import type { Project } from '../../model/project';
import type { Table, TableView } from '../../model/table';
import { renameColumnInFormula, renameRefColumnInFormula } from '../../formula/rename';
import { EditCode } from '../codes';
import { baseFields, columnLookup, columnsOf, DEFAULT_COLUMN_WIDTH, editableTable, isBaseField, isValidIdentifier, recordsOf, unique } from '../helpers';
import type { InputContext, InputError } from '../input';
import { convertValue, inputContext } from '../input';
import { cloneView, toCellData } from '../patch';
import type { CommandResult, EditFailure } from '../transaction';
import { emptyResult, failed, TxBuilder } from '../transaction';
import { addDefinitionRewrites, renameInView, splitRef } from './rewrite';

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function isEnumType(type: FieldType): boolean {
  return type === 'enum' || type === 'list<enum>';
}

/** DR-13: enum と list<enum> は enum_ref が必須 */
function enumRefFailure(table: number, field: Pick<FieldDef, 'name' | 'type' | 'enum_ref'>): EditFailure | null {
  if (!isEnumType(field.type) || (field.enum_ref !== undefined && field.enum_ref !== '')) return null;
  return { code: EditCode.enumRefRequired, params: { column: field.name, type: field.type }, table, column: field.name };
}

/** 名前がどこかのレコードのセルか、列定義に無いキー（DR-34）に使われているか */
function usedAsRecordKey(table: Table, name: string): boolean {
  return table.records.some((r) => r.cells.has(name) || r.extra.some(([k]) => k === name));
}

/** 新しい列名として使えるか（FR-VAL-07 の書式、共通列・このテーブルの列との重複、レコードのキー） */
export function validateColumnName(project: Project, table: Table, name: string): EditFailure[] {
  const where = { table: table.uid, column: name };
  if (!isValidIdentifier(name)) return [{ code: EditCode.columnInvalidName, params: { name }, ...where }];
  if (columnsOf(project, table).some((f) => f.name === name)) return [{ code: EditCode.columnDuplicate, params: { name }, ...where }];
  if (usedAsRecordKey(table, name)) return [{ code: EditCode.columnUsedByRecordKey, params: { name }, ...where }];
  return [];
}

/** 表示上の位置（共通列を含む列の並びでの位置） */
function displayIndex(project: Project, table: Table, name: string): number {
  return columnsOf(project, table).findIndex((f) => f.name === name);
}

/** テーブルの列（共通列でない）を探す */
function tableField(project: Project, table: Table, name: string): { ok: true; field: FieldDef; index: number } | { ok: false; failure: EditFailure } {
  const index = table.fields.findIndex((f) => f.name === name);
  if (index >= 0) return { ok: true, field: table.fields[index], index };
  const where = { table: table.uid, column: name };
  if (isBaseField(project, name)) return { ok: false, failure: { code: EditCode.columnIsBaseField, params: { column: name }, ...where } };
  return { ok: false, failure: { code: EditCode.columnNotFound, params: { column: name }, ...where } };
}

export type ColumnPosition = { index: number } | { anchor: string; side: 'left' | 'right' };

export interface InsertColumnArgs {
  table: number;
  /** index は table.fields（共通列を含まない）の中の位置。anchor は表示中の列の左・右 */
  position: ColumnPosition;
  field: FieldDef;
}

/** 列の挿入（FR-COL-01）。固定する列の範囲の中に入れたら、固定する列の数を 1 増やす */
export function insertColumn(project: Project, args: InsertColumnArgs): CommandResult {
  const found = editableTable(project, args.table);
  if (!found.ok) return failed(found.failures);
  const table = found.table;
  const failures = validateColumnName(project, table, args.field.name);
  const er = enumRefFailure(table.uid, args.field);
  if (er !== null) failures.push(er);
  if (failures.length > 0) return failed(failures);
  let index: number;
  if ('index' in args.position) {
    index = Math.max(0, Math.min(table.fields.length, Math.floor(args.position.index)));
  } else {
    const { anchor, side } = args.position;
    const i = table.fields.findIndex((f) => f.name === anchor);
    if (i >= 0) index = side === 'left' ? i : i + 1;
    else if (isBaseField(project, anchor)) index = 0; // 共通列は常に先頭にあるので、その後ろ（テーブルの列の先頭）に入れる
    else return failed([{ code: EditCode.columnNotFound, params: { column: anchor }, table: table.uid, column: anchor }]);
  }
  const b = new TxBuilder();
  b.add({ op: 'insertField', table: table.uid, index, field: cloneFieldDef(args.field), cells: [] });
  const frozen = table.view.frozen_columns;
  if (frozen !== undefined && baseFields(project).length + index < frozen) {
    b.add({ op: 'setView', table: table.uid, view: { ...cloneView(table.view), frozen_columns: frozen + 1 } });
  }
  return b.result(EditCode.opInsertColumn, { table: table.uid, records: [], columns: [args.field.name] });
}

export interface ColumnsArgs {
  table: number;
  columns: string[];
}

/** 列の削除（FR-COL-01）。表示設定の中のその列の指定も消す。共通列は消せない */
export function deleteColumns(project: Project, args: ColumnsArgs): CommandResult {
  const found = editableTable(project, args.table);
  if (!found.ok) return failed(found.failures);
  const table = found.table;
  const names = unique(args.columns);
  const failures: EditFailure[] = [];
  for (const name of names) {
    const r = tableField(project, table, name);
    if (!r.ok) failures.push(r.failure);
  }
  if (failures.length > 0) return failed(failures);
  if (names.length === 0) return emptyResult(EditCode.opDeleteColumns);
  const removed = new Set(names);
  const frozen = table.view.frozen_columns;
  const b = new TxBuilder();
  for (const name of names) b.add({ op: 'deleteField', table: table.uid, name });
  const view = cloneView(table.view);
  view.column_widths = view.column_widths.filter(([name]) => !removed.has(name));
  if (view.hidden_columns !== undefined) {
    view.hidden_columns = view.hidden_columns.filter((name) => !removed.has(name));
    if (view.hidden_columns.length === 0) delete view.hidden_columns;
  }
  if (frozen !== undefined) {
    const inFrozen = names.filter((name) => displayIndex(project, table, name) < frozen).length;
    if (inFrozen > 0) {
      if (frozen - inFrozen > 0) view.frozen_columns = frozen - inFrozen;
      else delete view.frozen_columns;
    }
  }
  if (!deepEqual(view, table.view)) b.add({ op: 'setView', table: table.uid, view });
  return b.result(EditCode.opDeleteColumns, { table: table.uid, records: [], columns: names });
}

export interface UpdateColumnArgs {
  table: number;
  column: string;
  /** 新しい列定義（表示名・出力対象・編集可否・列レベル式・既定値・検査ルール・警告条件・列挙型の参照・参照先。FR-COL-02） */
  field: FieldDef;
}

/** 列設定の編集（FR-COL-02）。列名の変更は renameColumn、型の変更は changeColumnType で行う */
export function updateColumn(project: Project, args: UpdateColumnArgs): CommandResult {
  const found = editableTable(project, args.table);
  if (!found.ok) return failed(found.failures);
  const table = found.table;
  const r = tableField(project, table, args.column);
  if (!r.ok) return failed([r.failure]);
  const where = { table: table.uid, column: args.column };
  if (args.field.name !== args.column) return failed([{ code: EditCode.columnNameChange, params: { column: args.column }, ...where }]);
  if (args.field.type !== r.field.type) return failed([{ code: EditCode.columnTypeChange, params: { column: args.column }, ...where }]);
  const er = enumRefFailure(table.uid, args.field);
  if (er !== null) return failed([er]);
  if (deepEqual(args.field, r.field)) return emptyResult(EditCode.opUpdateColumn);
  const b = new TxBuilder();
  b.add({ op: 'updateField', table: table.uid, name: args.column, field: cloneFieldDef(args.field) });
  return b.result(EditCode.opUpdateColumn, { table: table.uid, records: [], columns: [args.column] });
}

export interface RenameColumnArgs {
  table: number;
  from: string;
  to: string;
}

/**
 * 列名の変更（FR-COL-03）。各レコードのセルのキーに加えて、次をまとめて書き換える:
 * 同じテーブルの列レベル式・セル単位式の中の列名、他のテーブル（と共通列）の `ref` の `table.old`、
 * 全テーブルの式の中の `REF("table", …, "old")`、表示設定の中の列名。共通列は共通設定で変える（renameBaseField）
 */
export function renameColumn(project: Project, args: RenameColumnArgs): CommandResult {
  const found = editableTable(project, args.table);
  if (!found.ok) return failed(found.failures);
  const table = found.table;
  const r = tableField(project, table, args.from);
  if (!r.ok) return failed([r.failure]);
  if (args.from === args.to) return emptyResult(EditCode.opRenameColumn);
  const failures = validateColumnName(project, table, args.to);
  if (failures.length > 0) return failed(failures);
  const { from, to } = args;
  const lowerFrom = from.toLowerCase();
  const b = new TxBuilder();
  b.add({ op: 'renameField', table: table.uid, from, to });
  addDefinitionRewrites(project, b, {
    formula: (formula, owner) => {
      const local = owner === table ? renameColumnInFormula(formula, from, to) : formula;
      return renameRefColumnInFormula(local, table.name, from, to);
    },
    ref: (ref) => {
      const parts = splitRef(ref);
      return parts !== null && parts.table === table.name && parts.column.toLowerCase() === lowerFrom ? `${table.name}.${to}` : ref;
    },
    nameAfter: (owner, name) => (owner === table && name === from ? to : name),
  });
  const view = renameInView(table.view, from, to);
  if (view !== null) b.add({ op: 'setView', table: table.uid, view });
  return b.result(EditCode.opRenameColumn, { table: table.uid, records: [], columns: [to] });
}

export interface ChangeTypeArgs {
  table: number;
  column: string;
  type: FieldType;
  /** 新しい型が enum / list<enum> のときの列挙型（省略すれば今の enum_ref） */
  enum_ref?: string;
}

/** 型の変更で変換できない値の 1 件。record が undefined なら列の default */
export interface TypeChangeIssue {
  record?: number;
  /** 変換しようとしたテキスト */
  input: string;
  error: InputError;
}

function targetDef(field: FieldDef, args: ChangeTypeArgs): FieldDef {
  const next = cloneFieldDef(field);
  next.type = args.type;
  if (isEnumType(args.type)) {
    const ref = args.enum_ref ?? field.enum_ref;
    if (ref === undefined) delete next.enum_ref;
    else next.enum_ref = ref;
  } else {
    delete next.enum_ref;
  }
  return next;
}

interface Conversion {
  def: FieldDef;
  issues: TypeChangeIssue[];
  cells: { record: number; value: RawValue | undefined }[];
}

function planConversion(table: Table, field: FieldDef, args: ChangeTypeArgs, ctx: InputContext): Conversion {
  const def = targetDef(field, args);
  const issues: TypeChangeIssue[] = [];
  const cells: Conversion['cells'] = [];
  if (field.default !== undefined) {
    const conv = convertValue(field.default, field, def, ctx);
    if (conv.ok) {
      if (conv.value === undefined) delete def.default;
      else def.default = conv.value;
    } else {
      issues.push({ input: conv.text, error: conv.error });
    }
  }
  for (const record of table.records) {
    const value = cellValue(record.cells.get(field.name));
    if (isEmptyValue(value)) continue;
    const conv = convertValue(value as RawValue, field, def, ctx);
    if (conv.ok) cells.push({ record: record.uid, value: conv.value });
    else issues.push({ record: record.uid, input: conv.text, error: conv.error });
  }
  return { def, issues, cells };
}

/**
 * 型の変更（FR-COL-04）の前の確認: 新しい型に変換できない値の一覧（列の default を含む）。
 * 列が無い・共通列なら失敗
 */
export function checkColumnTypeChange(
  project: Project,
  args: ChangeTypeArgs,
): { ok: true; issues: TypeChangeIssue[] } | { ok: false; failures: EditFailure[] } {
  const found = editableTable(project, args.table);
  if (!found.ok) return found;
  const r = tableField(project, found.table, args.column);
  if (!r.ok) return { ok: false, failures: [r.failure] };
  return { ok: true, issues: planConversion(found.table, r.field, args, inputContext(project)).issues };
}

/**
 * 型の変更（FR-COL-04）: 承認された後に変換する。変換できる値は新しい型の値にし、
 * 変換できない値は捨てずにそのまま残す（検査で型のエラーとして示される。NFR-17）。セル単位式・セル色・メモは変えない
 */
export function changeColumnType(project: Project, args: ChangeTypeArgs): CommandResult {
  const found = editableTable(project, args.table);
  if (!found.ok) return failed(found.failures);
  const table = found.table;
  const r = tableField(project, table, args.column);
  if (!r.ok) return failed([r.failure]);
  const field = r.field;
  const conversion = planConversion(table, field, args, inputContext(project));
  const er = enumRefFailure(table.uid, conversion.def);
  if (er !== null) return failed([er]);
  if (deepEqual(conversion.def, field)) return emptyResult(EditCode.opChangeColumnType);
  const b = new TxBuilder();
  b.add({ op: 'updateField', table: table.uid, name: field.name, field: conversion.def });
  const records = recordsOf(project, table);
  for (const c of conversion.cells) {
    const old = records.get(c.record)?.cells.get(field.name);
    const data = toCellData(old);
    if (c.value === undefined) delete data.value;
    else data.value = c.value;
    b.setCell(table.uid, c.record, field.name, old, data);
  }
  return b.result(EditCode.opChangeColumnType, { table: table.uid, records: [], columns: [field.name] });
}

export interface MoveColumnsArgs extends ColumnsArgs {
  /** この列の前へ移す。null ならテーブルの列の末尾へ。共通列と、移す列そのものは指定できない */
  before: string | null;
}

/** 列の移動（FR-COL-05）。列定義の順序（＝ファイル上の順序）を変える。共通列は動かせない */
export function moveColumns(project: Project, args: MoveColumnsArgs): CommandResult {
  const found = editableTable(project, args.table);
  if (!found.ok) return failed(found.failures);
  const table = found.table;
  const failures: EditFailure[] = [];
  for (const name of unique(args.columns)) {
    const r = tableField(project, table, name);
    if (!r.ok) failures.push(r.failure);
  }
  const moving = new Set(args.columns);
  if (args.before !== null && (moving.has(args.before) || !table.fields.some((f) => f.name === args.before))) {
    failures.push({ code: EditCode.invalidMoveTarget, params: {}, table: table.uid, column: args.before });
  }
  if (failures.length > 0) return failed(failures);
  const block = table.fields.filter((f) => moving.has(f.name)).map((f) => f.name);
  const rest = table.fields.filter((f) => !moving.has(f.name)).map((f) => f.name);
  const at = args.before === null ? rest.length : rest.indexOf(args.before);
  const order = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  if (order.every((name, i) => table.fields[i].name === name)) return emptyResult(EditCode.opMoveColumns);
  const b = new TxBuilder();
  b.add({ op: 'setFieldOrder', table: table.uid, order });
  return b.result(EditCode.opMoveColumns, { table: table.uid, records: [], columns: block });
}

function viewCommand(
  project: Project,
  tableUid: number,
  columns: readonly string[],
  label: string,
  change: (view: TableView, table: Table) => EditFailure | null,
): CommandResult {
  const found = editableTable(project, tableUid);
  if (!found.ok) return failed(found.failures);
  const table = found.table;
  const lookup = columnLookup(project, table);
  const missing = unique(columns)
    .filter((name) => !lookup.has(name))
    .map((name): EditFailure => ({ code: EditCode.columnNotFound, params: { column: name }, table: table.uid, column: name }));
  if (missing.length > 0) return failed(missing);
  const view = cloneView(table.view);
  const error = change(view, table);
  if (error !== null) return failed([error]);
  if (deepEqual(view, table.view)) return emptyResult(label);
  const b = new TxBuilder();
  b.add({ op: 'setView', table: table.uid, view });
  return b.result(label, { table: table.uid, records: [], columns: [...columns] });
}

export interface ColumnWidthArgs extends ColumnsArgs {
  /** ピクセル。既定値（100。P-05）にしたら、その列の指定を消す */
  width: number;
}

/** 列幅の変更（FR-COL-06）。表示設定としてテーブルファイルに保存する（DR-06） */
export function setColumnWidth(project: Project, args: ColumnWidthArgs): CommandResult {
  return viewCommand(project, args.table, args.columns, EditCode.opColumnWidth, (view, table) => {
    const width = Math.round(args.width);
    if (!Number.isFinite(width) || width < 1) return { code: EditCode.invalidWidth, params: { width: String(args.width) }, table: table.uid };
    for (const name of unique(args.columns)) {
      const i = view.column_widths.findIndex(([n]) => n === name);
      if (width === DEFAULT_COLUMN_WIDTH) {
        if (i >= 0) view.column_widths.splice(i, 1);
      } else if (i >= 0) {
        view.column_widths[i] = [name, width];
      } else {
        view.column_widths.push([name, width]);
      }
    }
    return null;
  });
}

export interface FrozenColumnsArgs {
  table: number;
  /** 左端から固定する列の数（共通列を含む表示上の数）。0 で解除 */
  count: number;
}

/** 左端からの列の固定（FR-COL-07） */
export function setFrozenColumns(project: Project, args: FrozenColumnsArgs): CommandResult {
  return viewCommand(project, args.table, [], EditCode.opFreezeColumns, (view, table) => {
    const count = Math.max(0, Math.min(columnsOf(project, table).length, Math.floor(args.count)));
    if (count === 0) delete view.frozen_columns;
    else view.frozen_columns = count;
    return null;
  });
}

export interface HiddenColumnsArgs extends ColumnsArgs {
  hidden: boolean;
}

/** 列の非表示・再表示（FR-COL-08） */
export function setColumnsHidden(project: Project, args: HiddenColumnsArgs): CommandResult {
  return viewCommand(project, args.table, args.columns, args.hidden ? EditCode.opHideColumns : EditCode.opShowColumns, (view) => {
    const hidden = [...(view.hidden_columns ?? [])];
    for (const name of unique(args.columns)) {
      const i = hidden.indexOf(name);
      if (args.hidden && i < 0) hidden.push(name);
      if (!args.hidden && i >= 0) hidden.splice(i, 1);
    }
    if (hidden.length === 0) delete view.hidden_columns;
    else view.hidden_columns = hidden;
    return null;
  });
}

