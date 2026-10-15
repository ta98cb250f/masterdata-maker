// テスト用の EvalScope（*.test.ts から使う）

import { numberToText } from './coerce';
import { refColumnNotFound, refKeyNotFound, refTableNotFound } from './errors';
import { evaluateFormula } from './evaluate';
import { DateTimeValue, FormulaError } from './values';
import type { EvalScope } from './context';
import type { FValue } from './values';

/** テーブル名 → キー（文字列にしたもの）→ 列名 → 値 */
export type TestTables = Record<string, Record<string, Record<string, FValue>>>;

export interface TestScopeOptions {
  timeZone?: string;
  tables?: TestTables;
}

function keyText(key: FValue): string {
  if (typeof key === 'number') return numberToText(key);
  if (typeof key === 'bigint') return key.toString();
  if (typeof key === 'string') return key;
  if (typeof key === 'boolean') return key ? 'TRUE' : 'FALSE';
  if (key instanceof DateTimeValue) return String(key.epochMs);
  if (key instanceof FormulaError) return key.code;
  return '';
}

export function makeScope(columns: Record<string, FValue> = {}, options: TestScopeOptions = {}): EvalScope {
  const tables = options.tables ?? {};
  return {
    timeZone: options.timeZone ?? 'Asia/Tokyo',
    column(name) {
      return Object.prototype.hasOwnProperty.call(columns, name) ? columns[name] : undefined;
    },
    ref(table, key, column) {
      const rows = tables[table];
      if (rows === undefined) return refTableNotFound(table);
      const first = Object.values(rows)[0];
      if (first !== undefined && !Object.prototype.hasOwnProperty.call(first, column)) {
        return refColumnNotFound(table, column);
      }
      const k = keyText(key);
      const row = rows[k];
      if (row === undefined) return refKeyNotFound(table, k);
      return row[column];
    },
  };
}

/** 式を評価する（既定のタイムゾーンは Asia/Tokyo） */
export function ev(formula: string, columns: Record<string, FValue> = {}, options: TestScopeOptions = {}): FValue {
  return evaluateFormula(formula, makeScope(columns, options));
}
