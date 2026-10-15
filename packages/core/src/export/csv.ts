// CSV の出力（FR-OUT-01、P-62）。RFC 4180 の引用規則に従い、UTF-8（BOM なし）・LF・末尾の改行 1 つで書く
import type { RawValue } from '../model/cell';
import type { FieldDef } from '../model/field';
import { formatNumber } from '../io/emit';

/** 引用符で囲む必要があるか: 区切り・引用符・改行を含む、または空文字列（未入力の空欄と区別する） */
function needsQuote(s: string): boolean {
  return s === '' || /[",\r\n]/.test(s);
}

function quoteField(s: string): string {
  return needsQuote(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** リストの要素（JSON の値の表記。区切りの空白は入れない） */
function jsonItem(raw: RawValue, key: string): string {
  if (Array.isArray(raw)) return `[${raw.map((item) => jsonItem(item, key)).join(',')}]`;
  if (typeof raw === 'string') return JSON.stringify(raw);
  if (typeof raw === 'number') return formatNumber(raw, key);
  return String(raw);
}

/** 1 セルの表記。未入力（null）は空欄、文字列はそのまま、リストは JSON の配列 */
function cellText(raw: RawValue | undefined, key: string): string {
  if (raw === undefined) return '';
  if (Array.isArray(raw)) return quoteField(jsonItem(raw, key));
  if (typeof raw === 'string') return quoteField(raw);
  if (typeof raw === 'number') return formatNumber(raw, key);
  return String(raw);
}

/** 1 行目は列名。以降は 1 レコード 1 行（値は列の順） */
export function emitCsv(columns: readonly FieldDef[], rows: readonly (RawValue | undefined)[][]): string {
  const lines = [columns.map((c) => quoteField(c.name)).join(',')];
  rows.forEach((row, r) => {
    lines.push(row.map((raw, i) => cellText(raw, `[${r}].${columns[i].name}`)).join(','));
  });
  return `${lines.join('\n')}\n`;
}
