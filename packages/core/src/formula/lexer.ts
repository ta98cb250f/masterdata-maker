// 字句解析

import { formulaError } from './errors';
import type { FormulaError } from './values';

export type TokenType = 'number' | 'string' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'eof';

export interface Token {
  type: TokenType;
  /** 式のテキストの中の元の表記 */
  text: string;
  start: number;
  end: number;
  /** number は数値、string は `""` を `"` に戻した中身 */
  value?: number | string;
}

export type LexResult = { ok: true; tokens: Token[] } | { ok: false; error: FormulaError };

const OPERATORS_2 = ['<>', '<=', '>='];
const OPERATORS_1 = '+-*/^&=<>%';

const NUMBER_RE = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/y;
const SPACE_RE = /\s/;

/** 先頭の `=` を取り除く。offset は取り除いた文字数 */
export function stripFormulaPrefix(text: string): { source: string; offset: number } {
  return text.startsWith('=') ? { source: text.slice(1), offset: 1 } : { source: text, offset: 0 };
}

/** 式のテキスト（先頭の `=` を除いた部分）をトークンに分ける。最後に eof を付ける */
export function tokenize(source: string): LexResult {
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (SPACE_RE.test(ch)) {
      i++;
      continue;
    }
    if ((ch >= '0' && ch <= '9') || (ch === '.' && /\d/.test(source[i + 1] ?? ''))) {
      NUMBER_RE.lastIndex = i;
      const m = NUMBER_RE.exec(source);
      // 先頭が数字か「.数字」なので必ず一致する
      const text = m === null ? ch : m[0];
      tokens.push({ type: 'number', text, start: i, end: i + text.length, value: Number(text) });
      i += text.length;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let value = '';
      let closed = false;
      while (j < n) {
        const c = source[j];
        if (c === '"') {
          if (source[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        value += c;
        j++;
      }
      if (!closed) {
        return {
          ok: false,
          error: formulaError('#ERROR!', 'formula.syntax.unterminatedString', { position: i + 1 }).at(
            i,
            n,
          ),
        };
      }
      tokens.push({ type: 'string', text: source.slice(i, j), start: i, end: j, value });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      IDENT_RE.lastIndex = i;
      const m = IDENT_RE.exec(source);
      const text = m === null ? ch : m[0];
      tokens.push({ type: 'ident', text, start: i, end: i + text.length });
      i += text.length;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === ',') {
      const type: TokenType = ch === '(' ? 'lparen' : ch === ')' ? 'rparen' : 'comma';
      tokens.push({ type, text: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (OPERATORS_2.includes(two)) {
      tokens.push({ type: 'op', text: two, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (OPERATORS_1.includes(ch)) {
      tokens.push({ type: 'op', text: ch, start: i, end: i + 1 });
      i++;
      continue;
    }
    // サロゲートペアは 1 文字として示す
    const cp = source.codePointAt(i) ?? 0;
    const char = String.fromCodePoint(cp);
    return {
      ok: false,
      error: formulaError('#ERROR!', 'formula.syntax.unexpectedChar', { char, position: i + 1 }).at(
        i,
        i + char.length,
      ),
    };
  }
  tokens.push({ type: 'eof', text: '', start: n, end: n });
  return { ok: true, tokens };
}
