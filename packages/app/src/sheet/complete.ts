// 式の入力補完（FR-EDT-07）: 数式バー・セル内の編集・列の設定のダイアログで、列名と関数名を候補として出す。DOM に依存しない
import { FUNCTION_NAMES } from '@sheetcraft/core';

/** 補完する語の位置（式のテキストの中の位置） */
export interface CompletionContext {
  /** 語の先頭 */
  start: number;
  /** 語の末尾（カーソルの後ろに続く語の文字も含む） */
  end: number;
  /** カーソルより前の部分（候補の絞り込みに使う） */
  prefix: string;
}

export interface CompletionColumn {
  name: string;
  /** 表示名など、候補に添える説明 */
  detail?: string;
}

export interface CompletionItem {
  kind: 'column' | 'function';
  label: string;
  /** 語の代わりに入れるテキスト */
  insert: string;
  detail?: string;
}

const IDENT_CHAR = /[A-Za-z0-9_]/;

/** 列定義を補完の候補の列にする（表示名を添える） */
export function completionColumnsOf(fields: readonly { name: string; display_name?: string }[]): CompletionColumn[] {
  return fields.map((f) => ({ name: f.name, detail: f.display_name }));
}

/**
 * カーソルの位置で補完する語。式でない（requireEquals で `=` で始まらない）、文字列の中、数値、語が空なら null。
 * requireEquals が偽でも、先頭の `=` は飛ばす（列の設定の式の欄は `=` を付けずに書く）
 */
export function completionContext(text: string, caret: number, requireEquals: boolean): CompletionContext | null {
  const hasEquals = text.startsWith('=');
  if (requireEquals && !hasEquals) return null;
  const offset = hasEquals ? 1 : 0;
  if (caret < offset || caret > text.length) return null;
  // 文字列の中（`"` が奇数個。`""` は 2 個なので数え方は変わらない）では出さない
  let quotes = 0;
  for (let i = offset; i < caret; i++) if (text[i] === '"') quotes++;
  if (quotes % 2 === 1) return null;
  let start = caret;
  while (start > offset && IDENT_CHAR.test(text[start - 1])) start--;
  const prefix = text.slice(start, caret);
  if (prefix === '' || /^[0-9]/.test(prefix)) return null;
  let end = caret;
  while (end < text.length && IDENT_CHAR.test(text[end])) end++;
  return { start, end, prefix };
}

/**
 * 候補（列名が先、関数名が後。それぞれ名前の順）。大文字と小文字は区別しない（P-30。関数名も FR-FML-03）。
 * 語とまったく同じ列名は、補完しても変わらないので出さない
 */
export function completionItems(
  text: string,
  ctx: CompletionContext,
  columns: readonly CompletionColumn[],
  functions: readonly string[] = FUNCTION_NAMES,
  limit = 12,
): CompletionItem[] {
  const lower = ctx.prefix.toLowerCase();
  const word = text.slice(ctx.start, ctx.end).toLowerCase();
  const items: CompletionItem[] = [];
  const seen = new Set<string>();
  const sortedColumns = [...columns].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const column of sortedColumns) {
    const name = column.name.toLowerCase();
    if (!name.startsWith(lower) || name === word || seen.has(name)) continue;
    seen.add(name);
    items.push({ kind: 'column', label: column.name, insert: column.name, detail: column.detail });
  }
  // 関数名の後ろに `(` が無ければ付ける（Googleスプレッドシートと同じ）
  const paren = text[ctx.end] === '(' ? '' : '(';
  const upper = ctx.prefix.toUpperCase();
  for (const name of functions) {
    if (!name.startsWith(upper)) continue;
    if (name === word.toUpperCase() && paren === '') continue;
    items.push({ kind: 'function', label: name, insert: `${name}${paren}` });
  }
  return items.slice(0, limit);
}

/** 補完した後のテキストとカーソルの位置 */
export function applyCompletion(text: string, ctx: CompletionContext, item: CompletionItem): { text: string; caret: number } {
  return { text: text.slice(0, ctx.start) + item.insert + text.slice(ctx.end), caret: ctx.start + item.insert.length };
}
