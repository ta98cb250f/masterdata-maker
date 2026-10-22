// セルの表示（FR-FML-13、P-16）。Calculator の結果を型に応じた表示用の文字列にする
import type { CellResult, CellSource, FieldDef, RawValue } from '@masterdata-maker/core';
import { formatValueText, isListType, numberToText } from '@masterdata-maker/core';

export type CellAlign = 'left' | 'right' | 'center';

export interface CellDisplay {
  text: string;
  align: CellAlign;
  /** 真偽値の列のチェックボックス（true / false）。チェックボックスで表さないセルは null */
  checkbox: boolean | null;
  /** 式のエラー値（`#DIV/0!` など。赤い文字で表示する） */
  error: boolean;
  source: CellSource;
}

const NUMERIC_TYPES = new Set(['int', 'int64', 'float']);

const DATETIME_CACHE_LIMIT = 50_000;
const dateTimeTexts = new Map<string, string>();

function rawText(raw: RawValue, field: FieldDef, timeZone: string): string {
  // 小数は Googleスプレッドシートと同じく有効数字 15 桁で表示する（1200 * 1.3 → 1560。P-34）
  if (typeof raw === 'number' && field.type === 'float') return numberToText(raw);
  if (typeof raw === 'string' && field.type === 'datetime') {
    // 日時の表示はタイムゾーンの計算が重いので、元の文字列ごとに覚えておく（スクロール中に何度も描くため）
    const key = `${timeZone}\u0000${raw}`;
    let text = dateTimeTexts.get(key);
    if (text === undefined) {
      text = formatValueText(raw, field.type, timeZone);
      if (dateTimeTexts.size >= DATETIME_CACHE_LIMIT) dateTimeTexts.clear();
      dateTimeTexts.set(key, text);
    }
    return text;
  }
  return formatValueText(raw, field.type, timeZone);
}

/** セルの表示 */
export function cellDisplay(result: CellResult, field: FieldDef, timeZone: string): CellDisplay {
  const source = result.source;
  if (result.error !== undefined) return { text: result.error.code, align: 'left', checkbox: null, error: true, source };
  const raw = result.raw;
  if (field.type === 'bool' && (raw === undefined || typeof raw === 'boolean')) {
    return { text: '', align: 'center', checkbox: raw === true, error: false, source };
  }
  if (raw === undefined) return { text: '', align: 'left', checkbox: null, error: false, source };
  const text = rawText(raw, field, timeZone);
  const numeric =
    (NUMERIC_TYPES.has(field.type) && (typeof raw === 'number' || typeof raw === 'bigint')) ||
    (field.type === 'datetime' && typeof raw === 'string' && text !== raw);
  return { text, align: numeric && !isListType(field.type) ? 'right' : 'left', checkbox: null, error: false, source };
}
