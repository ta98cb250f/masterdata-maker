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

// NUMBER_TOKEN_RE・WORD_RE の続きになる文字（数値・リテラルの終わりの判定に使う）
const NUMBER_TOKEN_CHAR = new Uint8Array(128);
for (const ch of '-+._0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  NUMBER_TOKEN_CHAR[ch.charCodeAt(0)] = 1;
}
const WORD_CHAR = new Uint8Array(128);
for (const ch of '_$0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ') WORD_CHAR[ch.charCodeAt(0)] = 1;

const LF = 0x0a;
const DQ = 0x22;
const BACKSLASH = 0x5c;

/** 使い回すキーの数の上限（大きいオブジェクトの後ろで、探す手間が膨らまないように） */
const MAX_CACHED_KEYS = 256;

function isDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

class Parser {
  private pos = 0;
  /** 今の位置の行（1 から）と行の先頭の位置。改行は値の間の空白にしか現れない */
  private line = 1;
  private lineStart = 0;
  private depth = 0;
  /** 直前に読んだ文字列にエスケープがあったか */
  private escaped = false;
  /**
   * 深さごとの、直前のオブジェクトのキー（エスケープなし・重複なし）。
   * レコードのように同じ深さのオブジェクトは同じキーを同じ順に持つことが多いので、同じ文字列を使い回す
   */
  private readonly keyCache: string[][] = [];

  constructor(
    private readonly text: string,
    private readonly reporter: Reporter,
  ) {}

  /** 任意の位置の行と列（エラーの報告用） */
  posAt(offset: number): SrcPos {
    let line = 1;
    let lineStart = 0;
    for (let i = this.text.indexOf('\n'); i >= 0 && i < offset; i = this.text.indexOf('\n', i + 1)) {
      line++;
      lineStart = i + 1;
    }
    return { line, column: offset - lineStart + 1 };
  }

  /** 今の行の位置の行と列 */
  private here(offset: number): SrcPos {
    return { line: this.line, column: offset - this.lineStart + 1 };
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
    let pos = this.pos;
    while (pos < text.length) {
      const c = text.charCodeAt(pos);
      if (c === 0x20 || c === 0x09 || c === 0x0d) pos++;
      else if (c === LF) {
        pos++;
        this.line++;
        this.lineStart = pos;
      } else break;
    }
    this.pos = pos;
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
        const pos = this.here(start);
        const value = this.parseString();
        return { kind: 'scalar', value, source: value, implicit: false, pos };
      }
      case "'":
        throw new JsonSyntaxError(IoCode.jsonSingleQuote, start);
      case '/':
        throw new JsonSyntaxError(IoCode.jsonComment, start);
      case 't':
        if (this.isWord(start, 'true')) return this.literal(start, true, 'true');
        break;
      case 'f':
        if (this.isWord(start, 'false')) return this.literal(start, false, 'false');
        break;
      case 'n':
        if (this.isWord(start, 'null')) return this.literal(start, null, 'null');
        break;
      default:
        break;
    }
    if (ch === '-' || ch === '+' || ch === '.' || (ch >= '0' && ch <= '9')) return this.parseNumber();
    WORD_RE.lastIndex = start;
    const word = WORD_RE.exec(this.text);
    if (word !== null) throw new JsonSyntaxError(IoCode.jsonInvalidLiteral, start, { text: word[0] });
    throw this.unexpectedChar(start);
  }

  /** start から word がちょうど 1 語として書かれているか（WORD_RE で切り出したときと同じ判定） */
  private isWord(start: number, word: string): boolean {
    if (!this.text.startsWith(word, start)) return false;
    const next = this.text.charCodeAt(start + word.length);
    return !(next < 0x80 && WORD_CHAR[next] === 1);
  }

  private literal(start: number, value: boolean | null, source: string): SrcNode {
    this.pos = start + source.length;
    return { kind: 'scalar', value, source, implicit: false, pos: this.here(start) };
  }

  private unexpectedChar(offset: number): JsonSyntaxError {
    const cp = this.text.codePointAt(offset) ?? 0;
    return new JsonSyntaxError(IoCode.jsonUnexpectedChar, offset, { char: String.fromCodePoint(cp) });
  }

  /** RFC 8259 の数値の終わり。書き方が違えば -1（正規表現の経路でエラーにする） */
  private numberEnd(start: number): { end: number; integer: boolean } | -1 {
    const text = this.text;
    let i = start;
    let c = text.charCodeAt(i);
    let integer = true;
    if (c === 0x2d) c = text.charCodeAt(++i);
    if (c === 0x30) c = text.charCodeAt(++i);
    else if (c >= 0x31 && c <= 0x39) {
      do c = text.charCodeAt(++i);
      while (isDigit(c));
    } else return -1;
    if (c === 0x2e) {
      integer = false;
      c = text.charCodeAt(++i);
      if (!isDigit(c)) return -1;
      do c = text.charCodeAt(++i);
      while (isDigit(c));
    }
    if (c === 0x65 || c === 0x45) {
      integer = false;
      c = text.charCodeAt(++i);
      if (c === 0x2b || c === 0x2d) c = text.charCodeAt(++i);
      if (!isDigit(c)) return -1;
      do c = text.charCodeAt(++i);
      while (isDigit(c));
    }
    if (c < 0x80 && NUMBER_TOKEN_CHAR[c] === 1) return -1;
    return { end: i, integer };
  }

  private parseNumber(): SrcNode {
    const start = this.pos;
    const pos = this.here(start);
    const scanned = this.numberEnd(start);
    if (scanned !== -1) {
      const token = this.text.slice(start, scanned.end);
      this.pos = scanned.end;
      return { kind: 'scalar', value: scanned.integer ? BigInt(token) : Number(token), source: token, implicit: false, pos };
    }
    NUMBER_TOKEN_RE.lastIndex = start;
    const match = NUMBER_TOKEN_RE.exec(this.text);
    const token = match === null ? this.text[start] : match[0];
    if (!NUMBER_RE.test(token)) throw new JsonSyntaxError(IoCode.jsonInvalidNumber, start, { text: token });
    this.pos = start + token.length;
    const value = INTEGER_RE.test(token) ? BigInt(token) : Number(token);
    return { kind: 'scalar', value, source: token, implicit: false, pos };
  }

  private parseString(): string {
    const text = this.text;
    let i = this.pos + 1;
    let out = '';
    let chunkStart = i;
    this.escaped = false;
    for (;;) {
      if (i >= text.length) throw new JsonSyntaxError(IoCode.jsonUnexpectedEnd, i);
      const c = text.charCodeAt(i);
      if (c === DQ) {
        out += text.slice(chunkStart, i);
        this.pos = i + 1;
        return out;
      }
      if (c < 0x20) throw new JsonSyntaxError(IoCode.jsonControlChar, i);
      if (c === BACKSLASH) {
        this.escaped = true;
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
    const text = this.text;
    const start = this.pos;
    const pos = this.here(start);
    this.pos++;
    const entries: SrcEntry[] = [];
    this.skipWhitespace();
    if (text[this.pos] === '}') {
      this.pos++;
      return { kind: 'map', entries, pos };
    }
    const depth = this.depth++;
    const cache = this.keyCache[depth];
    // true のあいだ、キーはすべて cache の中に順に見つかっている（重複が無いことが保証される）
    let inCache = cache !== undefined;
    let cursor = 0;
    let allRaw = true;
    let seen: Set<string> | undefined;
    for (;;) {
      this.skipWhitespace();
      const keyStart = this.pos;
      const ch = text[keyStart];
      if (ch !== '"') {
        if (ch === undefined) throw new JsonSyntaxError(IoCode.jsonUnexpectedEnd, keyStart);
        if (ch === '}' && entries.length > 0) throw new JsonSyntaxError(IoCode.jsonTrailingComma, keyStart);
        if (ch === "'") throw new JsonSyntaxError(IoCode.jsonSingleQuote, keyStart);
        if (ch === '/') throw new JsonSyntaxError(IoCode.jsonComment, keyStart);
        WORD_RE.lastIndex = keyStart;
        const word = WORD_RE.exec(text);
        if (word !== null) throw new JsonSyntaxError(IoCode.jsonUnquotedKey, keyStart, { text: word[0] });
        throw this.unexpectedChar(keyStart);
      }
      const keyPos = this.here(keyStart);
      let key: string | undefined;
      if (inCache && cache !== undefined) {
        const from = keyStart + 1;
        for (let j = cursor; j < cache.length; j++) {
          const cached = cache[j];
          if (text.charCodeAt(from + cached.length) === DQ && text.startsWith(cached, from)) {
            key = cached;
            cursor = j + 1;
            this.pos = from + cached.length + 1;
            break;
          }
        }
      }
      if (key === undefined) {
        key = this.parseString();
        if (this.escaped) allRaw = false;
        if (seen === undefined) {
          seen = new Set();
          for (const entry of entries) seen.add(entry.key);
        }
        inCache = false;
      }
      this.skipWhitespace();
      if (text[this.pos] !== ':') throw this.unexpectedOrEnd(this.pos);
      this.pos++;
      const value = this.parseValue();
      if (seen !== undefined && seen.has(key)) {
        // 重複キーは構文エラーではないので、続けて読む
        this.reporter.error(IoCode.duplicateKey, keyPos, { key });
      } else {
        seen?.add(key);
        entries.push({ key, keyPos, value });
      }
      this.skipWhitespace();
      const sep = text[this.pos];
      if (sep === ',') {
        this.pos++;
        continue;
      }
      if (sep === '}') {
        this.pos++;
        this.depth--;
        if (!inCache && allRaw && entries.length <= MAX_CACHED_KEYS) {
          this.keyCache[depth] = entries.map((entry) => entry.key);
        }
        return { kind: 'map', entries, pos };
      }
      throw this.unexpectedOrEnd(this.pos);
    }
  }

  private parseArray(): SrcNode {
    const start = this.pos;
    const pos = this.here(start);
    this.pos++;
    const items: SrcNode[] = [];
    this.skipWhitespace();
    if (this.text[this.pos] === ']') {
      this.pos++;
      return { kind: 'seq', items, pos };
    }
    this.depth++;
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
        this.depth--;
        return { kind: 'seq', items, pos };
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
