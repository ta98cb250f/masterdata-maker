// コマンドで共通に使う処理
import type { Cell } from '../model/cell';
import { cellValue } from '../model/cell';
import type { FieldDef } from '../model/field';
import { isFieldEditable } from '../model/field';
import type { Project } from '../model/project';
import type { Table, TableRecord } from '../model/table';
import { primaryColumn, tableColumns } from '../model/table';
import { EditCode } from './codes';
import type { CellData } from './patch';
import { recordIndex, toCellData } from './patch';
import type { EditFailure } from './transaction';

/** セルの指定（テーブルは別に渡す） */
export interface CellTarget {
  record: number;
  column: string;
}

/** テーブルも含めたセルの指定（複数のテーブルにまたがる操作で使う） */
export interface TableCellTarget extends CellTarget {
  table: number;
}

/** P-05: 列幅の既定値 */
export const DEFAULT_COLUMN_WIDTH = 100;

export function findTable(project: Project, uid: number): Table | undefined {
  return project.tables.find((t) => t.uid === uid);
}

/** 編集できるテーブルを探す。無い・読み込みエラー（P-40）なら失敗 */
export function editableTable(project: Project, uid: number): { ok: true; table: Table } | { ok: false; failures: EditFailure[] } {
  const table = findTable(project, uid);
  if (table !== undefined) return { ok: true, table };
  const broken = project.brokenTables.find((t) => t.uid === uid);
  if (broken !== undefined) {
    return { ok: false, failures: [{ code: EditCode.tableBroken, params: { table: broken.name }, table: uid }] };
  }
  return { ok: false, failures: [{ code: EditCode.tableNotFound, params: {}, table: uid }] };
}

export function baseFields(project: Project): FieldDef[] {
  return project.common.base_fields.items;
}

export function columnsOf(project: Project, table: Table): FieldDef[] {
  return tableColumns(baseFields(project), table);
}

/** 列名 → 列定義（同じ名前が複数あれば先のもの） */
export function columnLookup(project: Project, table: Table): Map<string, FieldDef> {
  const map = new Map<string, FieldDef>();
  for (const column of columnsOf(project, table)) if (!map.has(column.name)) map.set(column.name, column);
  return map;
}

export function isBaseField(project: Project, name: string): boolean {
  return baseFields(project).some((f) => f.name === name);
}

export function recordsOf(project: Project, table: Table): Map<number, TableRecord> {
  return recordIndex(project, table);
}

/** 値・式・セル単位式を除いた、セル色・メモ（と知らないキー）だけのセル */
export function annotationsOf(cell: Cell | undefined): CellData {
  const data = toCellData(cell);
  delete data.value;
  delete data.override;
  return data;
}

/** 列が編集できなければ失敗を返す（FR-EDT-06） */
export function readonlyFailure(table: number, column: FieldDef): EditFailure | null {
  return isFieldEditable(column) ? null : { code: EditCode.readonlyColumn, params: { column: column.name }, table, column: column.name };
}

/** FR-VAL-07: 英小文字・数字・`_`。先頭は数字以外。`true` / `false` は不可 */
export function isValidIdentifier(name: string): boolean {
  return /^[a-z_][a-z0-9_]*$/.test(name) && name !== 'true' && name !== 'false';
}

/**
 * 自動で採番する列（DR-16）: `auto: increment` の列と、整数型の主キーの列
 */
export function numberingColumns(project: Project, table: Table): FieldDef[] {
  const columns = columnsOf(project, table);
  const primary = primaryColumn(columns);
  const result: FieldDef[] = [];
  for (const column of columns) {
    if (result.some((c) => c.name === column.name)) continue;
    const isIntPrimary = column === primary && (column.type === 'int' || column.type === 'int64');
    if (column.auto === 'increment' || isIntPrimary) result.push(column);
  }
  return result;
}

function integerOf(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  return undefined;
}

/** DR-16: 既存の最大値＋1 から count 個の番号（値が無ければ 1 から） */
export function nextNumbers(table: Table, column: FieldDef, count: number): (number | bigint)[] {
  let max = 0n;
  for (const record of table.records) {
    const n = integerOf(cellValue(record.cells.get(column.name)));
    if (n !== undefined && n > max) max = n;
  }
  const result: (number | bigint)[] = [];
  for (let i = 1; i <= count; i++) {
    const n = max + BigInt(i);
    result.push(column.type === 'int64' ? n : Number(n));
  }
  return result;
}

/** 名前の重複を除き、元の順を保つ */
export function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}
