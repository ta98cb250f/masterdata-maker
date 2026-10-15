// セルの入力・消去・セル色・メモ・置換（FR-EDT-01〜06、FR-ANN-01〜02、FR-FND-04）
import type { RawValue } from '../../model/cell';
import { cellValue, isEmptyValue } from '../../model/cell';
import type { FieldDef } from '../../model/field';
import { isFieldEditable } from '../../model/field';
import type { Project } from '../../model/project';
import type { Table } from '../../model/table';
import type { TextMatcher } from '../../sheet/find';
import { EditCode } from '../codes';
import type { CellTarget, TableCellTarget } from '../helpers';
import { annotationsOf, columnLookup, editableTable, readonlyFailure, recordsOf, unique } from '../helpers';
import type { ParsedInput } from '../input';
import { cellEditText, cellFormula, formatValueText, inputContext, keepSameInstant, parseCellInput } from '../input';
import type { CellData } from '../patch';
import { toCellData } from '../patch';
import type { CommandResult, EditFailure, Transaction } from '../transaction';
import { failed, inputFailure, TxBuilder } from '../transaction';

type Resolved = { table: Table; columns: Map<string, FieldDef> };

/** 対象のセルの列とレコードが有るか確かめる */
function resolveTargets(project: Project, table: Table, cells: readonly CellTarget[]): EditFailure[] {
  const columns = columnLookup(project, table);
  const records = recordsOf(project, table);
  const failures: EditFailure[] = [];
  for (const name of unique(cells.map((c) => c.column))) {
    if (!columns.has(name)) failures.push({ code: EditCode.columnNotFound, params: { column: name }, table: table.uid, column: name });
  }
  for (const uid of unique(cells.map((c) => c.record))) {
    if (!records.has(uid)) failures.push({ code: EditCode.recordNotFound, params: {}, table: table.uid, record: uid });
  }
  return failures;
}

function resolve(project: Project, tableUid: number, cells: readonly CellTarget[]): { ok: true; r: Resolved } | { ok: false; result: CommandResult } {
  const found = editableTable(project, tableUid);
  if (!found.ok) return { ok: false, result: failed(found.failures) };
  const failures = resolveTargets(project, found.table, cells);
  if (failures.length > 0) return { ok: false, result: failed(failures) };
  return { ok: true, r: { table: found.table, columns: columnLookup(project, found.table) } };
}

/** 入力の結果を、今のセルに当てた新しい中身にする（セル色・メモは残す） */
export function applyParsedInput(parsed: Exclude<ParsedInput, { ok: false }>, old: CellData, type: FieldDef['type']): CellData {
  const next: CellData = {};
  if (old.color !== undefined) next.color = old.color;
  if (old.comment !== undefined) next.comment = old.comment;
  if (old.extra !== undefined) next.extra = old.extra;
  if (parsed.kind === 'formula') next.override = parsed.formula;
  else if (parsed.kind === 'value') {
    const value = keepSameInstant(parsed.value, old.value, type);
    if (value !== undefined) next.value = value;
  }
  return next;
}

export interface EnterInputArgs {
  table: number;
  /** 入力するセル（Ctrl+Enter で範囲に入れるときは複数） */
  cells: CellTarget[];
  text: string;
}

/**
 * セルへの入力の確定（FR-EDT-01〜05）。型に合わなければ失敗を返し、何も変えない。
 * 今のセルの編集用のテキストと同じなら何も変えない（例: datetime の元の時差を保つ。P-19）
 */
export function enterInput(project: Project, args: EnterInputArgs): CommandResult {
  const resolved = resolve(project, args.table, args.cells);
  if (!resolved.ok) return resolved.result;
  const { table, columns } = resolved.r;
  const ctx = inputContext(project);
  const records = recordsOf(project, table);
  const failures: EditFailure[] = [];
  const parsedByColumn = new Map<string, ParsedInput>();
  for (const name of unique(args.cells.map((c) => c.column))) {
    const column = columns.get(name) as FieldDef;
    const ro = readonlyFailure(table.uid, column);
    if (ro !== null) {
      failures.push(ro);
      continue;
    }
    const parsed = parseCellInput(args.text, column, ctx);
    if (!parsed.ok) failures.push(inputFailure(parsed.error, { table: table.uid, column: name, input: args.text }));
    parsedByColumn.set(name, parsed);
  }
  if (failures.length > 0) return failed(failures);

  const b = new TxBuilder();
  for (const target of args.cells) {
    const column = columns.get(target.column) as FieldDef;
    const parsed = parsedByColumn.get(target.column) as Exclude<ParsedInput, { ok: false }>;
    const record = records.get(target.record);
    const old = record?.cells.get(target.column);
    if (cellEditText(old, column, ctx.timeZone) === args.text) continue;
    b.setCell(table.uid, target.record, target.column, old, applyParsedInput(parsed, toCellData(old), column.type));
  }
  return b.result(EditCode.opInput, focusOf(table.uid, args.cells));
}

export interface CellsArgs {
  table: number;
  cells: CellTarget[];
}

function focusOf(table: number, cells: readonly CellTarget[]) {
  return { table, records: unique(cells.map((c) => c.record)), columns: unique(cells.map((c) => c.column)) };
}

/**
 * 値の消去（FR-EDT-02）: 値とセル単位式を消し、セル色とメモは残す。
 * 編集できない列（FR-EDT-06）のセルは飛ばす。対象がすべて編集できない列なら失敗
 */
export function clearCells(project: Project, args: CellsArgs): CommandResult {
  const resolved = resolve(project, args.table, args.cells);
  if (!resolved.ok) return resolved.result;
  const { table, columns } = resolved.r;
  const records = recordsOf(project, table);
  const editable = args.cells.filter((c) => isFieldEditable(columns.get(c.column) as FieldDef));
  if (args.cells.length > 0 && editable.length === 0) {
    return failed(
      unique(args.cells.map((c) => c.column)).map((name) => readonlyFailure(table.uid, columns.get(name) as FieldDef) as EditFailure),
    );
  }
  const b = new TxBuilder();
  for (const target of editable) {
    const old = records.get(target.record)?.cells.get(target.column);
    b.setCell(table.uid, target.record, target.column, old, annotationsOf(old));
  }
  return b.result(EditCode.opClear, focusOf(table.uid, editable));
}

export interface CellColorArgs extends CellsArgs {
  /** セル色のプリセットのキー。null で解除 */
  color: string | null;
}

/** セル色の設定・解除（FR-ANN-01）。範囲にまとめて適用する */
export function setCellColor(project: Project, args: CellColorArgs): CommandResult {
  const resolved = resolve(project, args.table, args.cells);
  if (!resolved.ok) return resolved.result;
  const { table } = resolved.r;
  if (args.color !== null && !project.common.colors.items.some((c) => c.key === args.color)) {
    return failed([{ code: EditCode.colorUnknown, params: { color: args.color }, table: table.uid }]);
  }
  const records = recordsOf(project, table);
  const b = new TxBuilder();
  for (const target of args.cells) {
    const old = records.get(target.record)?.cells.get(target.column);
    const next = toCellData(old);
    if (args.color === null) delete next.color;
    else next.color = args.color;
    b.setCell(table.uid, target.record, target.column, old, next);
  }
  return b.result(EditCode.opCellColor, focusOf(table.uid, args.cells));
}

export interface CommentArgs extends CellsArgs {
  /** メモ。null か空文字で削除 */
  comment: string | null;
}

/** メモの追加・編集・削除（FR-ANN-02） */
export function setCellComment(project: Project, args: CommentArgs): CommandResult {
  const resolved = resolve(project, args.table, args.cells);
  if (!resolved.ok) return resolved.result;
  const { table } = resolved.r;
  const records = recordsOf(project, table);
  const b = new TxBuilder();
  for (const target of args.cells) {
    const old = records.get(target.record)?.cells.get(target.column);
    const next = toCellData(old);
    if (args.comment === null || args.comment === '') delete next.comment;
    else next.comment = args.comment;
    b.setCell(table.uid, target.record, target.column, old, next);
  }
  return b.result(EditCode.opComment, focusOf(table.uid, args.cells));
}

export interface ReplaceArgs {
  /** 検索で一致したセル（複数のテーブルにまたがってよい。FR-FND-03） */
  cells: TableCellTarget[];
  matcher: TextMatcher;
  replacement: string;
  /** 式の中も置換する（FR-FND-02）。偽なら、セル単位式のセルは対象にしない */
  searchFormulas: boolean;
}

export interface ReplaceResult {
  /** 置換できたセルをまとめたトランザクション。1 つも無ければ null */
  tx: Transaction | null;
  replaced: number;
  /** 置換できなかったセル（編集できない列・型に合わない） */
  failures: EditFailure[];
}

/**
 * 置換（FR-FND-04）: 一致したセルを型の変換規則と編集可否に従って置換する。
 * 置換できたものは 1 つのトランザクションにし、置換できなかったセルを一覧で返す。
 * 照合するのは値の表示用のテキスト（datetime は表示形式、リストは P-16 の表記）か、`=` 付きの式
 */
export function replaceCells(project: Project, args: ReplaceArgs): ReplaceResult {
  const ctx = inputContext(project);
  const b = new TxBuilder();
  const failures: EditFailure[] = [];
  let replaced = 0;
  const focusTable = args.cells[0]?.table;
  const focusCells: CellTarget[] = [];
  for (const target of args.cells) {
    const found = editableTable(project, target.table);
    if (!found.ok) {
      failures.push(...found.failures.map((f) => ({ ...f, record: target.record, column: target.column })));
      continue;
    }
    const table = found.table;
    const column = columnLookup(project, table).get(target.column);
    const record = recordsOf(project, table).get(target.record);
    if (column === undefined || record === undefined) continue;
    const old = record.cells.get(target.column);
    const formula = cellFormula(old);
    let text: string;
    if (formula !== undefined) {
      if (!args.searchFormulas) continue;
      text = `=${formula}`;
    } else {
      const value = cellValue(old);
      if (isEmptyValue(value)) continue;
      text = formatValueText(value as RawValue, column.type, ctx.timeZone);
    }
    if (!args.matcher.test(text)) continue;
    const nextText = args.matcher.replace(text, args.replacement);
    if (nextText === text) continue;
    const where = { table: table.uid, record: target.record, column: target.column, input: nextText };
    const ro = readonlyFailure(table.uid, column);
    if (ro !== null) {
      failures.push({ ...ro, ...where });
      continue;
    }
    // 式のセルは入力と同じ規則（`=` が残れば式）。値のセルは値として解釈し、式にはしない
    const parsed = parseCellInput(nextText, column, ctx, formula !== undefined ? 'input' : 'value');
    if (!parsed.ok) {
      failures.push(inputFailure(parsed.error, where));
      continue;
    }
    const oldData = toCellData(old);
    let next: CellData;
    if (formula !== undefined) {
      next = applyParsedInput(parsed, oldData, column.type);
    } else {
      // 値のセルでは、値に隠れたセル単位式（値が優先される）はそのまま残す
      next = { ...oldData };
      delete next.value;
      if (parsed.kind === 'value') next.value = parsed.value;
    }
    if (b.setCell(table.uid, target.record, target.column, old, next)) {
      replaced++;
      if (table.uid === focusTable) focusCells.push(target);
    }
  }
  if (b.isEmpty) return { tx: null, replaced: 0, failures };
  const tx = b.build(EditCode.opReplace, focusTable === undefined ? undefined : focusOf(focusTable, focusCells));
  return { tx, replaced, failures };
}
