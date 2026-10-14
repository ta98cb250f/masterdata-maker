// セルの表示（FR-FML-13、P-16）。Calculator の結果を型に応じた表示用の文字列にする
import type { CellResult, CellSource, FieldDef, RawValue } from '@sheetcraft/core';
import { formatValueText, isListType, numberToText } from '@sheetcraft/core';

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

function rawText(raw: RawValue, field: FieldDef, timeZone: string): string {
  // 小数は Googleスプレッドシートと同じく有効数字 15 桁で表示する（1200 * 1.3 → 1560。P-34）
  if (typeof raw === 'number' && field.type === 'float') return numberToText(raw);
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
