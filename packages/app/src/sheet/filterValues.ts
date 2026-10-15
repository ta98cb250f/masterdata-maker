// フィルタの小さな画面で使う計算（FR-SRT-03）: 値の一覧、範囲の条件の値の読み書き。DOM に依存しない
import type { Calculator, FieldDef, SortKey, Table } from '@sheetcraft/core';
import { compareCodePoints, compareSortKeys, formatDisplay, parseUserDateTime } from '@sheetcraft/core';
import { filterCellOf, sortKeyOf } from './sortFilter';

export interface FilterValueList {
  /** 空欄以外の表示の文字列（並べ替え済み・重複なし） */
  values: string[];
  /** 空欄のセルがあるか */
  hasEmpty: boolean;
}

/**
 * 列の値の一覧（値で絞り込むときの候補）。表示の文字列ごとにまとめ、並べ替えと同じ順（version 列は semver）にする
 */
export function filterValueList(calc: Calculator, table: Table, field: FieldDef): FilterValueList {
  const tz = calc.timeZone;
  const keys = new Map<string, SortKey>();
  let hasEmpty = false;
  for (const record of table.records) {
    const result = calc.getCell(table, record.uid, field.name);
    const cell = filterCellOf(result, field, tz);
    if (cell.empty) {
      hasEmpty = true;
      continue;
    }
    if (!keys.has(cell.text)) keys.set(cell.text, sortKeyOf(result, tz));
  }
  const semver = field.name === 'version';
  const values = [...keys.entries()]
    .sort((a, b) => compareSortKeys(a[1], b[1], { semver }) || compareCodePoints(a[0], b[0]))
    .map(([text]) => text);
  return { values, hasEmpty };
}

/** 範囲の条件を使える列か（数値と日時。リストは使えない） */
export function supportsRange(field: FieldDef): boolean {
  return field.type === 'int' || field.type === 'int64' || field.type === 'float' || field.type === 'datetime';
}

export type BoundResult = { ok: true; value: number | bigint | undefined } | { ok: false };

/** 範囲の条件の値を読む。空なら制限なし（undefined）。日時の列は日時（ミリ秒。時差が無ければ timeZone の現地時刻）、int64 は整数なら bigint */
export function parseFilterBound(text: string, field: FieldDef, timeZone: string): BoundResult {
  const s = text.trim();
  if (s === '') return { ok: true, value: undefined };
  if (field.type === 'datetime') {
    const p = parseUserDateTime(s, timeZone);
    return p === null ? { ok: false } : { ok: true, value: p.epochMs };
  }
  if (field.type === 'int64' && /^[+-]?\d+$/.test(s)) return { ok: true, value: BigInt(s) };
  const n = Number(s);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
}

/** 範囲の条件の値を、入力欄に出す文字列にする */
export function formatFilterBound(value: number | bigint | undefined, field: FieldDef, timeZone: string): string {
  if (value === undefined) return '';
  if (field.type === 'datetime' && typeof value === 'number') return formatDisplay(value, timeZone);
  return String(value);
}
