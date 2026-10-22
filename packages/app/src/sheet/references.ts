// 参照列（ref）の参照先（FR-ANN-05、FR-REF-01）。DOM に依存しない。
// 参照先のテーブルの「名前」は name 列、無ければ最初の string 列（参照先の列そのものは除く）
import type { Calculator, CellResult, FValue, FieldDef, Table, TableRecord } from '@masterdata-maker/core';
import { FList, displayValue, parseRef, valueKey } from '@masterdata-maker/core';
import { cellDisplay } from './display';

export interface RefTarget {
  table: Table;
  /** 参照先の列（主キーか一意の列。DR-17） */
  column: FieldDef;
  /** 名前として添える列。無ければ undefined */
  nameColumn: FieldDef | undefined;
}

/** 列の参照先。ref が無い・参照先のテーブルや列が無ければ null */
export function refTargetOf(calc: Calculator, field: FieldDef): RefTarget | null {
  if (field.ref === undefined) return null;
  const parts = parseRef(field.ref);
  const table = parts === null ? undefined : calc.findTable(parts.table);
  if (parts === null || table === undefined) return null;
  const columns = calc.columns(table);
  const column = columns.find((c) => c.name === parts.column);
  if (column === undefined) return null;
  const nameColumn = columns.find((c) => c.name === 'name' && c !== column) ?? columns.find((c) => c.type === 'string' && c !== column);
  return { table, column, nameColumn };
}

/** セルの実効値に入っている参照のキー（リストなら要素ごと。未入力・エラーは無し） */
export function refKeys(result: CellResult): FValue[] {
  if (result.error !== undefined) return [];
  const v = result.value;
  const items = v instanceof FList ? v.items : [v];
  return items.filter((item) => valueKey(item) !== undefined);
}

/** キーの表示用の文字列 */
export function refKeyText(key: FValue, timeZone: string): string {
  return displayValue(key, timeZone);
}

interface RefIndex {
  /** 照合用のキー → 参照先のレコード */
  records: Map<string, TableRecord>;
  /** 照合用のキー → 名前 */
  names: Map<string, string>;
}

const indexes = new WeakMap<Calculator, Map<string, { version: number; index: RefIndex }>>();

/**
 * 参照先のキーの索引。version（編集の版）が変わるまで使い回す（参照列のセルを描くたびに呼ばれるため）。
 * 同じキーが複数あれば先のレコード（一意でないことは検査で示す）
 */
function refIndex(calc: Calculator, target: RefTarget, version: number): RefIndex {
  let byRef = indexes.get(calc);
  if (byRef === undefined) {
    byRef = new Map();
    indexes.set(calc, byRef);
  }
  const key = `${target.table.uid}\u0000${target.column.name}`;
  const cached = byRef.get(key);
  if (cached !== undefined && cached.version === version) return cached.index;
  const index: RefIndex = { records: new Map(), names: new Map() };
  const tz = calc.timeZone;
  for (const record of target.table.records) {
    const k = valueKey(calc.getCell(target.table, record.uid, target.column.name).value);
    if (k === undefined || index.records.has(k)) continue;
    index.records.set(k, record);
    if (target.nameColumn !== undefined) {
      const text = cellDisplay(calc.getCell(target.table, record.uid, target.nameColumn.name), target.nameColumn, tz).text;
      if (text !== '') index.names.set(k, text);
    }
  }
  byRef.set(key, { version, index });
  return index;
}

/** キーの参照先のレコード。見つからなければ undefined */
export function findRefRecord(calc: Calculator, target: RefTarget, key: FValue, version: number): TableRecord | undefined {
  const k = valueKey(key);
  return k === undefined ? undefined : refIndex(calc, target, version).records.get(k);
}

/** キーの参照先の名前（名前の列が無い・見つからなければ undefined） */
export function refName(calc: Calculator, target: RefTarget, key: FValue, version: number): string | undefined {
  const k = valueKey(key);
  return k === undefined ? undefined : refIndex(calc, target, version).names.get(k);
}

/** セルに添える参照先の名前（例: `[1, 3]` → 「ファイア, ヒール」）。名前が 1 つも無ければ空文字 */
export function refNamesText(calc: Calculator, target: RefTarget, keys: readonly FValue[], version: number): string {
  if (target.nameColumn === undefined || keys.length === 0) return '';
  const names = keys.map((k) => refName(calc, target, k, version));
  if (names.every((n) => n === undefined)) return '';
  return names.map((n) => n ?? '?').join(', ');
}
