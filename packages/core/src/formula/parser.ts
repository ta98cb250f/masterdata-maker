// 構文解析（Pratt パーサー）。
// 優先順位（低い順）: 比較 < & < + - < * / < ^ < 後置の % < 単項の - +。二項演算子はすべて左結合

import { formulaError } from './errors';
import { stripFormulaPrefix, tokenize } from './lexer';
import type { BinaryOp, CallNode, Node } from './ast';
import type { Token } from './lexer';
import type { FormulaError } from './values';

export interface ParsedFormula {
  /** 式のテキスト（先頭の `=` を除いた部分）。位置はこの中の位置 */
  source: string;
  ast: Node;
  tokens: readonly Token[];
}

export type ParseResult =
  | ({ ok: true } & ParsedFormula)
  | { ok: false; source: string; error: FormulaError };

const INFIX_BP: Readonly<Record<string, number>> = {
  '=': 10,
  '<>': 10,
  '<': 10,
  '>': 10,
  '<=': 10,
  '>=': 10,
  '&': 20,
  '+': 30,
  '-': 30,
  '*': 40,
  '/': 40,
  '^': 50,
};
const PERCENT_BP = 60;
const PREFIX_BP = 70;
const MAX_DEPTH = 200;

class ParseFailure {
  constructor(readonly error: FormulaError) {}
}

class Parser {
  private pos = 0;
  private depth = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    const t = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  private fail(tok: Token): never {
    if (tok.type === 'eof') {
      throw new ParseFailure(
        formulaError('#ERROR!', 'formula.syntax.unexpectedEnd', { position: tok.start }).at(
          tok.start,
          tok.end,
        ),
      );
    }
    throw new ParseFailure(
      formulaError('#ERROR!', 'formula.syntax.unexpectedToken', {
        token: tok.text,
        position: tok.start + 1,
      }).at(tok.start, tok.end),
    );
  }

  private failUnclosed(open: Token): never {
    throw new ParseFailure(
      formulaError('#ERROR!', 'formula.syntax.missingCloseParen', { position: open.start + 1 }).at(
        open.start,
        open.end,
      ),
    );
  }

  parseAll(): Node {
    const first = this.peek();
    if (first.type === 'eof') {
      throw new ParseFailure(formulaError('#ERROR!', 'formula.syntax.empty').at(0, first.end));
    }
    const node = this.parseExpression(0);
    const rest = this.peek();
    if (rest.type !== 'eof') this.fail(rest);
    return node;
  }

  private parseExpression(minBp: number): Node {
    this.depth++;
    if (this.depth > MAX_DEPTH) {
      const t = this.peek();
      throw new ParseFailure(
        formulaError('#ERROR!', 'formula.syntax.tooDeep', { position: t.start + 1 }).at(
          t.start,
          t.end,
        ),
      );
    }
    let left = this.parsePrefix();
    for (;;) {
      const tok = this.peek();
      if (tok.type !== 'op') break;
      if (tok.text === '%') {
        if (PERCENT_BP <= minBp) break;
        this.next();
        left = { type: 'percent', operand: left, start: left.start, end: tok.end };
        continue;
      }
      const bp = INFIX_BP[tok.text];
      if (bp === undefined || bp <= minBp) break;
      this.next();
      const right = this.parseExpression(bp);
      left = {
        type: 'binary',
        op: tok.text as BinaryOp,
        left,
        right,
        start: left.start,
        end: right.end,
      };
    }
    this.depth--;
    return left;
  }

  private parsePrefix(): Node {
    const tok = this.next();
    switch (tok.type) {
      case 'number':
        return { type: 'number', value: tok.value as number, start: tok.start, end: tok.end };
      case 'string':
        return { type: 'string', value: tok.value as string, start: tok.start, end: tok.end };
      case 'ident': {
        if (this.peek().type === 'lparen') return this.parseCall(tok);
        const upper = tok.text.toUpperCase();
        if (upper === 'TRUE' || upper === 'FALSE') {
          return { type: 'boolean', value: upper === 'TRUE', start: tok.start, end: tok.end };
        }
        return { type: 'column', name: tok.text.toLowerCase(), start: tok.start, end: tok.end };
      }
      case 'lparen': {
        if (this.peek().type === 'eof') this.failUnclosed(tok);
        const expr = this.parseExpression(0);
        const close = this.peek();
        if (close.type !== 'rparen') {
          if (close.type === 'eof') this.failUnclosed(tok);
          this.fail(close);
        }
        this.next();
        return { type: 'group', expr, start: tok.start, end: close.end };
      }
      case 'op':
        if (tok.text === '-' || tok.text === '+') {
          const operand = this.parseExpression(PREFIX_BP);
          return { type: 'unary', op: tok.text, operand, start: tok.start, end: operand.end };
        }
        return this.fail(tok);
      default:
        return this.fail(tok);
    }
  }

  private parseCall(nameTok: Token): CallNode {
    const open = this.next(); // '('
    const args: Node[] = [];
    if (this.peek().type === 'rparen') {
      const close = this.next();
      return this.callNode(nameTok, args, close.end);
    }
    for (;;) {
      const t = this.peek();
      if (t.type === 'comma' || t.type === 'rparen') {
        // 省略された引数
        args.push({ type: 'blank', start: t.start, end: t.start });
      } else {
        if (t.type === 'eof') this.failUnclosed(open);
        args.push(this.parseExpression(0));
      }
      const sep = this.peek();
      if (sep.type === 'comma') {
        this.next();
        continue;
      }
      if (sep.type === 'rparen') {
        this.next();
        return this.callNode(nameTok, args, sep.end);
      }
      if (sep.type === 'eof') this.failUnclosed(open);
      this.fail(sep);
    }
  }

  private callNode(nameTok: Token, args: Node[], end: number): CallNode {
    return {
      type: 'call',
      name: nameTok.text.toUpperCase(),
      nameStart: nameTok.start,
      nameEnd: nameTok.end,
      args,
      start: nameTok.start,
      end,
    };
  }
}

/**
 * 式を構文解析する。先頭の `=` があれば取り除く。
 * 結果の構文木は変更しないので、キャッシュして何度でも評価に使える
 */
export function parseFormula(text: string): ParseResult {
  const { source } = stripFormulaPrefix(text);
  const lex = tokenize(source);
  if (!lex.ok) return { ok: false, source, error: lex.error };
  try {
    const ast = new Parser(lex.tokens).parseAll();
    return { ok: true, source, ast, tokens: lex.tokens };
  } catch (e) {
    if (e instanceof ParseFailure) return { ok: false, source, error: e.error };
    throw e;
  }
}

/** 構文解析の結果を式のテキストごとに覚えておくキャッシュ。上限を超えたら古いものから捨てる */
export class ParseCache {
  private readonly map = new Map<string, ParseResult>();

  constructor(private readonly limit = 10_000) {}

  get(text: string): ParseResult {
    let r = this.map.get(text);
    if (r === undefined) {
      r = parseFormula(text);
      if (this.map.size >= this.limit) {
        const oldest = this.map.keys().next();
        if (!oldest.done) this.map.delete(oldest.value);
      }
      this.map.set(text, r);
    }
    return r;
  }

  clear(): void {
    this.map.clear();
  }
}
