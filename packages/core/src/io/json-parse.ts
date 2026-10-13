import { IoCode } from './codes';
import type { ParseResult, SrcEntry, SrcNode, SrcPos } from './tree';
import { Reporter } from './tree';

// RFC 8259 の厳密な JSON パーサー（DR-50）。
// 整数の表記は BigInt で読み（DR-19）、元の表記を保持する。重複キー・コメント・末尾のカンマ・
// 単引用符・NaN などの拡張は拒否する。構文エラーは最初の 1 つで止める

class JsonSyntaxError extends Error {
  constructor(
    readonly code: string,
    readonly offset: number,
    readonly params?: Record<string, string>,
  ) {
    super(code);
  }
}

const INTEGER_RE = /^-?(?:0|[1-9][0-9]*)$/;
const NUMBER_RE = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const NUMBER_TOKEN_RE = /[-+.0-9A-Za-z_]+/y;
const WORD_RE = /[A-Za-z_$][A-Za-z0-9_$]*/y;

class Parser {
  private pos = 0;
  private readonly lineStarts: number[] = [0];

  constructor(
    private readonly text: string,
    private readonly reporter: Reporter,
  ) {
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 0x0a) this.lineStarts.push(i + 1);
    }
  }

  posAt(offset: number): SrcPos {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - this.lineStarts[lo] + 1 };
  }

  parseDocument(): SrcNode {
    const node = this.parseValue();
    this.skipWhitespace();
    if (this.pos < this.text.length) {
      if (this.text[this.pos] === '/') throw new JsonSyntaxError(IoCode.jsonComment, this.pos);
      throw new JsonSyntaxError(IoCode.jsonTrailingContent, this.pos);
    }
    return node;
  }

  private skipWhitespace(): void {
    const text = this.text;
    while (this.pos < text.length) {
      const c = text.charCodeAt(this.pos);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.pos++;
      else break;
    }
  }

  private parseValue(): SrcNode {
    this.skipWhitespace();
    const start = this.pos;
    if (start >= this.text.length) throw new JsonSyntaxError(IoCode.jsonUnexpectedEnd, start);
    const ch = this.text[start];
    switch (ch) {
      case '{':
        return this.parseObject();
      case '[':
        return this.parseArray();
      case '"': {
        const value = this.parseString();
        return { kind: 'scalar', value, source: value, implicit: false, pos: this.posAt(start) };
      }
      case "'":
        throw new JsonSyntaxError(IoCode.jsonSingleQuote, start);
      case '/':
        throw new JsonSyntaxError(IoCode.jsonComment, start);
      default:
        break;
    }
    if (ch === '-' || ch === '+' || ch === '.' || (ch >= '0' && ch <= '9')) return this.parseNumber();
    WORD_RE.lastIndex = start;
    const word = WORD_RE.exec(this.text);
    if (word !== null) {
      this.pos = start + word[0].length;
      const pos = this.posAt(start);
      if (word[0] === 'true') return { kind: 'scalar', value: true, source: 'true', implicit: false, pos };
      if (word[0] === 'false') return { kind: 'scalar', value: false, source: 'false', implicit: false, pos };
      if (word[0] === 'null') return { kind: 'scalar', value: null, source: 'null', implicit: false, pos };
      throw new JsonSyntaxError(IoCode.jsonInvalidLiteral, start, { text: word[0] });
    }
    throw this.unexpectedChar(start);
  }

  private unexpectedChar(offset: number): JsonSyntaxError {
    const cp = this.text.codePointAt(offset) ?? 0;
    return new JsonSyntaxError(IoCode.jsonUnexpectedChar, offset, { char: String.fromCodePoint(cp) });
  }

  private parseNumber(): SrcNode {
    const start = this.pos;
    NUMBER_TOKEN_RE.lastIndex = start;
    const match = NUMBER_TOKEN_RE.exec(this.text);
    const token = match === null ? this.text[start] : match[0];
    if (!NUMBER_RE.test(token)) throw new JsonSyntaxError(IoCode.jsonInvalidNumber, start, { text: token });
    this.pos = start + token.length;
    const value = INTEGER_RE.test(token) ? BigInt(token) : Number(token);
    return { kind: 'scalar', value, source: token, implicit: false, pos: this.posAt(start) };
  }

  private parseString(): string {
    const text = this.text;
    let i = this.pos + 1;
    let out = '';
    let chunkStart = i;
    for (;;) {
      if (i >= text.length) throw new JsonSyntaxError(IoCode.jsonUnexpectedEnd, i);
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        out += text.slice(chunkStart, i);
        this.pos = i + 1;
        return out;
      }
      if (c < 0x20) throw new JsonSyntaxError(IoCode.jsonControlChar, i);
      if (c === 0x5c) {
        out += text.slice(chunkStart, i);
        const e = text[i + 1];
        switch (e) {
          case '"':
            out += '"';
            break;
          case '\\':
            out += '\\';
            break;
          case '/':
            out += '/';
            break;
          case 'b':
            out += '\b';
            break;
          case 'f':
            out += '\f';
            break;
          case 'n':
            out += '\n';
            break;
          case 'r':
            out += '\r';
            break;
          case 't':
            out += '\t';
            break;
          case 'u': {
            const hex = text.slice(i + 2, i + 6);
            if (!/^[0-9A-Fa-f]{4}$/.test(hex)) {
              throw new JsonSyntaxError(IoCode.jsonInvalidEscape, i, { text: `\\u${hex}` });
            }
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            if (e === undefined) throw new JsonSyntaxError(IoCode.jsonUnexpectedEnd, i + 1);
            throw new JsonSyntaxError(IoCode.jsonInvalidEscape, i, { text: `\\${e}` });
        }
        i += 2;
        chunkStart = i;
        continue;
      }
      i++;
    }
  }

  private parseObject(): SrcNode {
    const start = this.pos;
    this.pos++;
    const entries: SrcEntry[] = [];
    const seen = new Set<string>();
    this.skipWhitespace();
    if (this.text[this.pos] === '}') {
      this.pos++;
      return { kind: 'map', entries, pos: this.posAt(start) };
    }
    for (;;) {
      this.skipWhitespace();
      const keyStart = this.pos;
      const ch = this.text[keyStart];
      if (ch !== '"') {
        if (ch === undefined) throw new JsonSyntaxError(IoCode.jsonUnexpectedEnd, keyStart);
        if (ch === '}' && entries.length > 0) throw new JsonSyntaxError(IoCode.jsonTrailingComma, keyStart);
        if (ch === "'") throw new JsonSyntaxError(IoCode.jsonSingleQuote, keyStart);
        if (ch === '/') throw new JsonSyntaxError(IoCode.jsonComment, keyStart);
        WORD_RE.lastIndex = keyStart;
        const word = WORD_RE.exec(this.text);
        if (word !== null) throw new JsonSyntaxError(IoCode.jsonUnquotedKey, keyStart, { text: word[0] });
        throw this.unexpectedChar(keyStart);
      }
      const key = this.parseString();
      const keyPos = this.posAt(keyStart);
      this.skipWhitespace();
      if (this.text[this.pos] !== ':') throw this.unexpectedOrEnd(this.pos);
      this.pos++;
      const value = this.parseValue();
      if (seen.has(key)) {
        // 重複キーは構文エラーではないので、続けて読む
        this.reporter.error(IoCode.duplicateKey, keyPos, { key });
      } else {
        seen.add(key);
        entries.push({ key, keyPos, value });
      }
      this.skipWhitespace();
      const sep = this.text[this.pos];
      if (sep === ',') {
        this.pos++;
        continue;
      }
      if (sep === '}') {
        this.pos++;
        return { kind: 'map', entries, pos: this.posAt(start) };
      }
      throw this.unexpectedOrEnd(this.pos);
    }
  }

  private parseArray(): SrcNode {
    const start = this.pos;
    this.pos++;
    const items: SrcNode[] = [];
    this.skipWhitespace();
    if (this.text[this.pos] === ']') {
      this.pos++;
      return { kind: 'seq', items, pos: this.posAt(start) };
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.pos] === ']') throw new JsonSyntaxError(IoCode.jsonTrailingComma, this.pos);
      items.push(this.parseValue());
      this.skipWhitespace();
      const sep = this.text[this.pos];
      if (sep === ',') {
        this.pos++;
        continue;
      }
      if (sep === ']') {
        this.pos++;
        return { kind: 'seq', items, pos: this.posAt(start) };
      }
      throw this.unexpectedOrEnd(this.pos);
    }
  }

  private unexpectedOrEnd(offset: number): JsonSyntaxError {
    if (offset >= this.text.length) return new JsonSyntaxError(IoCode.jsonUnexpectedEnd, offset);
    if (this.text[offset] === '/') return new JsonSyntaxError(IoCode.jsonComment, offset);
    return this.unexpectedChar(offset);
  }
}

/** JSON のテキストを構文木にする。BOM は呼び出し側で取り除いておく */
export function parseJson(text: string, reporter: Reporter = new Reporter()): ParseResult {
  const parser = new Parser(text, reporter);
  const before = reporter.items.length;
  try {
    const node = parser.parseDocument();
    const failed = reporter.items.slice(before).some((d) => d.severity === 'error');
    return { node: failed ? null : node, diagnostics: reporter.items };
  } catch (e) {
    if (!(e instanceof JsonSyntaxError)) throw e;
    reporter.error(e.code, parser.posAt(e.offset), e.params);
    return { node: null, diagnostics: reporter.items };
  }
}
