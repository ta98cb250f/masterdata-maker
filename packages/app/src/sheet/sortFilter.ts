// 表示だけの並べ替えとフィルタ（FR-SRT-01、03、05、06）。条件から表示する行の並びを作る
import type { Calculator, CellResult, FieldDef, FilterCell, SortKey, SortSpec, Table } from '@sheetcraft/core';
import { DateTimeValue, FList, VERSION_COLUMN, displayValue, sortRows, visibleRows } from '@sheetcraft/core';
import type { FilterState, SortState, TableIssues } from '../store/types';
import { cellDisplay } from './display';

/** 並べ替え用の値 */
export function sortKeyOf(result: CellResult, timeZone: string): SortKey {
  if (result.error !== undefined) return { kind: 'error', v: result.error.code };
  const v = result.value;
  if (typeof v === 'number') return { kind: 'number', v };
  if (typeof v === 'bigint') return { kind: 'bigint', v };
  if (typeof v === 'string') return v === '' ? { kind: 'empty' } : { kind: 'string', v };
  if (typeof v === 'boolean') return { kind: 'bool', v };
  if (v instanceof DateTimeValue) return { kind: 'datetime', ms: v.epochMs };
  if (v instanceof FList) return v.items.length === 0 ? { kind: 'empty' } : { kind: 'string', v: displayValue(v, timeZone) };
  return { kind: 'empty' };
}

/** フィルタの判定に使うセルの情報 */
export function filterCellOf(result: CellResult, field: FieldDef, timeZone: string): FilterCell {
  const display = cellDisplay(result, field, timeZone);
  const text = display.checkbox === null ? display.text : display.checkbox ? 'TRUE' : 'FALSE';
  const v = result.value;
  let value: number | bigint | null = null;
  if (typeof v === 'number' || typeof v === 'bigint') value = v;
  else if (v instanceof DateTimeValue) value = v.epochMs;
  const empty = result.error === undefined && result.raw === undefined;
  return { text, value, empty };
}

export interface SortFilterConditions {
  sort: readonly SortState[];
  filters: readonly FilterState[];
  onlyIssues: boolean;
}

export function hasConditions(c: SortFilterConditions): boolean {
  return c.sort.length > 0 || c.filters.length > 0 || c.onlyIssues;
}

/**
 * 条件に合う行を並べ替えた、レコードの uid の並び。条件が無ければ null（ファイル上の順）。
 * `version` 列はセマンティック バージョニングとして比べる（FR-SRT-05）
 */
export function computeOrder(
  calc: Calculator,
  table: Table,
  conditions: SortFilterConditions,
  issues?: TableIssues,
): number[] | null {
  if (!hasConditions(conditions)) return null;
  const tz = calc.timeZone;
  const records = table.records;
  const columns = calc.columns(table);
  const byName = new Map(columns.map((c) => [c.name, c]));
  const indexes = records.map((_, i) => i);
  const filters = conditions.filters.flatMap((f, col) => (byName.has(f.column) ? [{ col, condition: f.condition, field: byName.get(f.column) as FieldDef }] : []));
  const rows = visibleRows(
    indexes,
    filters.map((f) => ({ col: f.col, condition: f.condition })),
    (row, col) => {
      const f = filters.find((x) => x.col === col) as (typeof filters)[number];
      return filterCellOf(calc.getCell(table, records[row].uid, f.field.name), f.field, tz);
    },
    {
      onlyRowsWithIssues: conditions.onlyIssues,
      rowHasIssue: (row) => (issues?.cells.get(records[row].uid)?.size ?? 0) > 0,
    },
  );
  const specs: SortSpec[] = conditions.sort.flatMap((s) => {
    const field = byName.get(s.column);
    if (field === undefined) return [];
    return [
      {
        key: (row: number) => sortKeyOf(calc.getCell(table, records[row].uid, field.name), tz),
        direction: s.direction,
        semver: field.name === VERSION_COLUMN,
      },
    ];
  });
  const sorted = specs.length === 0 ? rows : sortRows(rows, specs);
  return sorted.map((i) => records[i].uid);
}
