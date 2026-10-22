// 検索と置換（FR-FND-01〜04）のうち、どのセルが一致するかを求める部分。照合は core の createMatcher、置換は core の replaceCells。
// 照合するテキストは replaceCells と同じ（値は表示用のテキスト、セル単位式は `=` 付きの式）。
// 式や既定値で決まった値（セルに値の無いもの）は、表示どおりのテキストで検索できるが、置換はできない
import type { Calculator, CellRange, EditFailure, FieldDef, Table, TableRecord, TextMatcher } from '@masterdata-maker/core';
import { cellFormula, cellValue, formatValueText, isEmptyValue, numberToText } from '@masterdata-maker/core';
import type { SheetModel } from './model';

/** value: セルの値 / formula: セル単位式（`=` 付き） / computed: 式・既定値で決まった値（置換できない） */
export type HitKind = 'value' | 'formula' | 'computed';

export interface FindHit {
  table: number;
  record: number;
  column: string;
  /** 表示上の行と列（見つけたときの並び） */
  row: number;
  col: number;
  kind: HitKind;
  text: string;
  /** computed のうち、セル単位式の結果（「式の中も検索」を有効にすれば式を置換できる） */
  fromCellFormula?: boolean;
}

export type FindScope = 'selection' | 'table' | 'all';

/** 置換できない理由の文言キー */
export const COMPUTED_NOT_REPLACEABLE = 'ui.find.computedNotReplaceable';
export const FORMULA_NOT_SEARCHED = 'ui.find.formulaNotSearched';

function computedText(calc: Calculator, table: Table, record: TableRecord, field: FieldDef): string | null {
  const r = calc.getCell(table, record.uid, field.name);
  if (r.error !== undefined) return r.error.code;
  if (r.raw === undefined) return null;
  // グリッドの表示と同じく、小数は有効数字 15 桁（P-34）
  if (typeof r.raw === 'number' && field.type === 'float') return numberToText(r.raw);
  return formatValueText(r.raw, field.type, calc.timeZone);
}

/** セルの照合に使うテキスト。空のセルは null */
export function cellFindText(
  calc: Calculator,
  table: Table,
  record: TableRecord,
  field: FieldDef,
  searchFormulas: boolean,
): { kind: HitKind; text: string; fromCellFormula?: boolean } | null {
  const cell = record.cells.get(field.name);
  const formula = cellFormula(cell);
  if (formula !== undefined) {
    if (searchFormulas) return { kind: 'formula', text: `=${formula}` };
    const text = computedText(calc, table, record, field);
    return text === null ? null : { kind: 'computed', text, fromCellFormula: true };
  }
  const value = cellValue(cell);
  if (value !== undefined && !isEmptyValue(value)) return { kind: 'value', text: formatValueText(value, field.type, calc.timeZone) };
  const text = computedText(calc, table, record, field);
  return text === null ? null : { kind: 'computed', text };
}

/** シート（表示中の行と列）の中の一致するセル。行ごとに左から右へ、上から下の順（range があればその範囲だけ） */
export function findInSheet(calc: Calculator, sheet: SheetModel, matcher: TextMatcher, searchFormulas: boolean, range?: CellRange): FindHit[] {
  const hits: FindHit[] = [];
  const top = Math.max(0, range?.top ?? 0);
  const bottom = Math.min(sheet.size.rows - 1, range?.bottom ?? sheet.size.rows - 1);
  const left = Math.max(0, range?.left ?? 0);
  const right = Math.min(sheet.size.cols - 1, range?.right ?? sheet.size.cols - 1);
  for (let row = top; row <= bottom; row++) {
    const record = sheet.recordAt(row);
    if (record === undefined) continue;
    for (let col = left; col <= right; col++) {
      const column = sheet.columns[col];
      if (column === undefined) continue;
      const found = cellFindText(calc, sheet.table, record, column.field, searchFormulas);
      if (found === null || !matcher.test(found.text)) continue;
      const hit: FindHit = { table: sheet.table.uid, record: record.uid, column: column.name, row, col, kind: found.kind, text: found.text };
      if (found.fromCellFormula === true) hit.fromCellFormula = true;
      hits.push(hit);
    }
  }
  return hits;
}

/** 今の位置（テーブルの並びの番号・行・列）より後の最初の一致の番号。無ければ先頭に戻る。一致が無ければ -1 */
export function nextHitIndex(
  hits: readonly FindHit[],
  tableOrder: (uid: number) => number,
  current: { table: number; row: number; col: number } | null,
  direction: 1 | -1,
  inclusive = false,
): number {
  if (hits.length === 0) return -1;
  if (current === null) return direction === 1 ? 0 : hits.length - 1;
  const ct = tableOrder(current.table);
  const cmp = (h: FindHit): number => tableOrder(h.table) - ct || h.row - current.row || h.col - current.col;
  if (direction === 1) {
    const i = hits.findIndex((h) => (inclusive ? cmp(h) >= 0 : cmp(h) > 0));
    return i < 0 ? 0 : i;
  }
  for (let i = hits.length - 1; i >= 0; i--) {
    const c = cmp(hits[i]);
    if (inclusive ? c <= 0 : c < 0) return i;
  }
  return hits.length - 1;
}

/** 置換できない一致（式・既定値で決まった値）を、置換の失敗の形にする */
export function computedHitFailures(hits: readonly FindHit[]): EditFailure[] {
  return hits
    .filter((h) => h.kind === 'computed')
    .map((h) => ({
      code: h.fromCellFormula === true ? FORMULA_NOT_SEARCHED : COMPUTED_NOT_REPLACEABLE,
      params: { input: h.text },
      table: h.table,
      record: h.record,
      column: h.column,
    }));
}
