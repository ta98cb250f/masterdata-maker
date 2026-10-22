// 表示するシートの形（表示中の列・行の並び）。DOM に依存しない
import type { FieldDef, GridSize, Project, Table, TableRecord } from '@masterdata-maker/core';
import { DEFAULT_COLUMN_WIDTH, isFieldEditable, isFieldExported, primaryColumn, recordIndex, tableColumns } from '@masterdata-maker/core';

export interface SheetColumn {
  field: FieldDef;
  name: string;
  /** 全列（非表示の列を含む。共通列が先）の中の位置 */
  index: number;
  width: number;
  editable: boolean;
  exported: boolean;
  /** 列レベル式がある */
  formula: boolean;
  /** 共通列 */
  base: boolean;
  primary: boolean;
  /** この列の左に隠れている列（FR-COL-08 の印） */
  hiddenBefore: readonly string[];
}

export interface SheetModel {
  table: Table;
  /** 全列（非表示の列を含む） */
  allColumns: readonly FieldDef[];
  /** 表示中の列 */
  columns: readonly SheetColumn[];
  /** 右端より右に隠れている列 */
  hiddenAfter: readonly string[];
  /** 左から固定する列の数（表示中の列の数で数える。FR-COL-07） */
  frozenCount: number;
  /** 表示中の行（表示順）のレコードの uid */
  rowUids: readonly number[];
  primary: FieldDef | undefined;
  size: GridSize;
  recordAt(row: number): TableRecord | undefined;
  /** レコードの表示上の行。表示していなければ -1 */
  rowOf(uid: number): number;
  /** 列名の表示上の列。表示していなければ -1 */
  colOf(name: string): number;
}

/**
 * 表示順の行。order が null ならファイル上の順。order を作った後に足された行（known に無い行）は、
 * ファイル上ですぐ前にある表示中の行の後ろに置く。消えた行は除く
 */
export function displayOrder(
  records: readonly TableRecord[],
  order: readonly number[] | null,
  known: ReadonlySet<number> | null,
): number[] {
  if (order === null) return records.map((r) => r.uid);
  const existing = new Set(records.map((r) => r.uid));
  const rows = order.filter((uid) => existing.has(uid));
  if (known === null) return rows;
  const shown = new Map(rows.map((uid, i) => [uid, i]));
  const after = new Map<number, number[]>();
  let last = -1;
  for (const record of records) {
    const p = shown.get(record.uid);
    if (p !== undefined) {
      last = p;
      continue;
    }
    if (known.has(record.uid)) continue;
    const list = after.get(last);
    if (list === undefined) after.set(last, [record.uid]);
    else list.push(record.uid);
  }
  if (after.size === 0) return rows;
  const result: number[] = [...(after.get(-1) ?? [])];
  rows.forEach((uid, i) => {
    result.push(uid);
    const list = after.get(i);
    if (list !== undefined) result.push(...list);
  });
  return result;
}

export interface SheetOrder {
  order: readonly number[] | null;
  orderKnown: ReadonlySet<number> | null;
}

export function buildSheetModel(project: Project, table: Table, view: SheetOrder): SheetModel {
  const baseFields = project.common.base_fields.items;
  const allColumns = tableColumns(baseFields, table);
  const primary = primaryColumn(allColumns);
  const hidden = new Set(table.view.hidden_columns ?? []);
  const widths = new Map(table.view.column_widths);
  const frozenLimit = table.view.frozen_columns ?? 0;
  const columns: SheetColumn[] = [];
  let pendingHidden: string[] = [];
  let frozenCount = 0;
  allColumns.forEach((field, index) => {
    if (hidden.has(field.name)) {
      pendingHidden.push(field.name);
      return;
    }
    if (index < frozenLimit) frozenCount++;
    columns.push({
      field,
      name: field.name,
      index,
      width: widths.get(field.name) ?? DEFAULT_COLUMN_WIDTH,
      editable: isFieldEditable(field),
      exported: isFieldExported(field),
      formula: field.formula !== undefined && field.formula.trim() !== '',
      base: index < baseFields.length,
      primary: field === primary,
      hiddenBefore: pendingHidden,
    });
    pendingHidden = [];
  });
  const rowUids = displayOrder(table.records, view.order, view.orderKnown);
  const records = recordIndex(project, table);
  let rowIndex: Map<number, number> | null = null;
  const colIndex = new Map(columns.map((c, i) => [c.name, i]));
  return {
    table,
    allColumns,
    columns,
    hiddenAfter: pendingHidden,
    frozenCount,
    rowUids,
    primary,
    size: { rows: rowUids.length, cols: columns.length },
    recordAt: (row) => {
      const uid = rowUids[row];
      return uid === undefined ? undefined : records.get(uid);
    },
    rowOf: (uid) => {
      rowIndex ??= new Map(rowUids.map((u, i) => [u, i]));
      return rowIndex.get(uid) ?? -1;
    },
    colOf: (name) => colIndex.get(name) ?? -1,
  };
}
