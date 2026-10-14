import type { SrcEntry, SrcMap, SrcNode, SrcPos, SrcScalar, SrcScalarValue, SrcSeq } from './tree';

// 本ツールが書き出す正規形の YAML（emit.ts）だけを速く読む専用の処理。
// 受け付けるのは、2 スペースのブロックのマッピングとシーケンス、1 行のフローのリストとマッピング、
// 引用符なしのスカラー、1 行のダブルクォートのスカラーだけ。区切りの空白も emit.ts の書き方に限る。
// 想定外のもの（コメント・単引用符・ブロックスカラー・アンカー・エイリアス・タグ・複数行のフロー・タブ・
// 指示・BOM・CR・知らないエスケープ・インデントの不揃い・重複キーなど）が 1 つでもあれば null を返す。
// 呼び出し側はファイル全体を yaml ライブラリの経路で読み直す（エラーの報告もそちらに任せる）。
// 受け付けた入力の構文木は、yaml ライブラリの経路（yaml-parse.ts）と同じになる

/** 辞退の合図。例外で一気に抜ける */
const DECLINE: unique symbol = Symbol('decline');

function decline(): never {
  throw DECLINE;
}

const LF = 0x0a;
const SP = 0x20;
const DQ = 0x22;
const COLON = 0x3a;
const COMMA = 0x2c;
const DASH = 0x2d;
const DOT = 0x2e;
const HASH = 0x23;
const LBRACKET = 0x5b;
const BACKSLASH = 0x5c;
const RBRACKET = 0x5d;
const LBRACE = 0x7b;
const RBRACE = 0x7d;

/** フローやブロックの入れ子の上限（超えたら辞退する） */
const MAX_DEPTH = 64;
/** yaml ライブラリはブロックのマッピングのキーの先頭から `:` まで 1024 文字を超えるとエラーにする */
const MAX_KEY_SPAN = 1000;

// 引用符なしのスカラーの先頭に来ると、YAML では別の意味になる文字（emit.ts の YAML_INDICATOR_START と同じ）
const INDICATOR = new Uint8Array(128);
for (const ch of "-?:,[]{}#&*!|>'\"%@`") INDICATOR[ch.charCodeAt(0)] = 1;

// フローの中の引用符なしのスカラーを終える文字。`:` と `#` は emit.ts がフローの中では必ず引用符で囲む
const FLOW_STOP = new Uint8Array(128);
for (const ch of ',[]{}:#') FLOW_STOP[ch.charCodeAt(0)] = 1;

// ---- 引用符なしのスカラーの解釈（yaml ライブラリの YAML 1.2 core schema と同じ正規表現） ----

const NULL_RE = /^(?:~|[Nn]ull|NULL)?$/;
const BOOL_RE = /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/;
const INT_OCT_RE = /^0o[0-7]+$/;
const INT_RE = /^[-+]?[0-9]+$/;
const INT_HEX_RE = /^0x[0-9a-fA-F]+$/;
const FLOAT_NAN_RE = /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/;
const FLOAT_EXP_RE = /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/;
const FLOAT_RE = /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/;

/**
 * 引用符なしのスカラーの値。core schema の順（null → bool → int（8・10・16 進）→ float）に試す。
 * 各正規表現は先頭の文字で決まるので、先頭の文字で候補を絞ってから試す。整数は intAsBigInt と同じく BigInt
 */
export function resolvePlainScalar(s: string): SrcScalarValue {
  const c = s.charCodeAt(0);
  if ((c >= 0x30 && c <= 0x39) || c === DASH || c === 0x2b || c === DOT) {
    if (INT_RE.test(s) || INT_OCT_RE.test(s) || INT_HEX_RE.test(s)) return BigInt(s);
    if (FLOAT_NAN_RE.test(s)) {
      if (s.slice(-3).toLowerCase() === 'nan') return Number.NaN;
      return c === DASH ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    }
    if (FLOAT_EXP_RE.test(s) || FLOAT_RE.test(s)) return parseFloat(s);
    return s;
  }
  if (c === 0x7e || c === 0x6e || c === 0x4e) return NULL_RE.test(s) ? null : s;
  if (c === 0x74 || c === 0x54 || c === 0x66 || c === 0x46) {
    return BOOL_RE.test(s) ? c === 0x74 || c === 0x54 : s;
  }
  return s;
}

// ---- ダブルクォートのエスケープ（yaml ライブラリの resolve-flow-scalar.js と同じ。タブと改行の前のものは除く） ----

const ESCAPES: Record<string, string> = {
  '0': '\0',
  a: '\x07',
  b: '\b',
  e: '\x1b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  N: '\u0085',
  _: ' ',
  L: ' ',
  P: ' ',
  ' ': ' ',
  '"': '"',
  '/': '/',
  '\\': '\\',
};

function isHexDigit(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}

class CanonicalYamlParser {
  private line = 1;
  private lineStart = 0;
  /** 今の行の末尾の LF の位置 */
  private lineEnd = 0;
  /** 直前に読んだ 1 行の値（スカラー・フロー）の終わりの位置 */
  private end = 0;
  /**
   * 深さごとの、直前のブロックのマッピングのキー（引用符なし・確かめ済み・重複なし）。
   * レコードのように同じ深さのマッピングは同じキーを同じ順に持つことが多いので、同じ文字列を使い回す
   * （切り出し・確かめ・重複の検査を省ける。Map の検索でもハッシュを計算し直さずに済む）
   */
  private readonly keyCache: string[][] = [];

  constructor(private readonly text: string) {}

  parse(): SrcNode {
    const text = this.text;
    if (text.length === 0 || text.charCodeAt(text.length - 1) !== LF) decline();
    this.lineEnd = text.indexOf('\n');
    if (this.indent() !== 0) decline();
    const root = this.blockMap(0, 0);
    if (!this.atEnd()) decline();
    return root;
  }

  private posAt(offset: number): SrcPos {
    return { line: this.line, column: offset - this.lineStart + 1 };
  }

  private nextLine(): void {
    this.lineStart = this.lineEnd + 1;
    this.line++;
    if (this.lineStart < this.text.length) this.lineEnd = this.text.indexOf('\n', this.lineStart);
  }

  private atEnd(): boolean {
    return this.lineStart >= this.text.length;
  }

  /** 今の行の先頭の空白の数 */
  private indent(): number {
    const text = this.text;
    let i = this.lineStart;
    while (text.charCodeAt(i) === SP) i++;
    return i - this.lineStart;
  }

  /**
   * ASCII 以外の文字を確かめる。正規形では生のまま書かれない文字（C1 制御文字・行区切り・BOM・
   * 非文字・対になっていないサロゲート）なら辞退する。サロゲートペアなら下位の位置を返す
   */
  private wide(c: number, i: number): number {
    if (c <= 0x9f) decline();
    if (c < 0x2028) return i;
    if (c >= 0xd800 && c <= 0xdfff) {
      if (c >= 0xdc00) decline();
      const low = this.text.charCodeAt(i + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) decline();
      return i + 1;
    }
    if (c === 0x2028 || c === 0x2029 || c === 0xfeff || c === 0xfffe || c === 0xffff) decline();
    return i;
  }

  private scalar(value: SrcScalarValue, source: string, implicit: boolean, offset: number): SrcScalar {
    return { kind: 'scalar', value, source, implicit, pos: this.posAt(offset) };
  }

  /** 引用符なしのスカラーの値（範囲の文字は確かめ済み）。先頭の文字が使えなければ辞退する */
  private plainValue(s: string): SrcScalarValue {
    if (s.length === 0) decline();
    const c = s.charCodeAt(0);
    if (c < 0x80 && INDICATOR[c] === 1) {
      // 先頭の `-` は数値（`-5`、`-1.5e3` など）に限る
      if (c !== DASH) decline();
      const value = resolvePlainScalar(s);
      if (typeof value === 'string') decline();
      return value;
    }
    if (c === SP || (c === DOT && s.startsWith('...'))) decline();
    return resolvePlainScalar(s);
  }

  private plain(start: number, end: number): SrcScalar {
    const s = this.text.slice(start, end);
    return this.scalar(this.plainValue(s), s, true, start);
  }

  /** ダブルクォートのスカラー（1 行）。終わりの位置を this.end に置く */
  private doubleQuoted(start: number): string {
    const text = this.text;
    const lineEnd = this.lineEnd;
    let out = '';
    let chunk = start + 1;
    for (let i = start + 1; i < lineEnd; i++) {
      const c = text.charCodeAt(i);
      if (c === DQ) {
        this.end = i + 1;
        return chunk === start + 1 ? text.slice(chunk, i) : out + text.slice(chunk, i);
      }
      if (c === BACKSLASH) {
        out += text.slice(chunk, i);
        const e = text[i + 1];
        if (e === 'x' || e === 'u' || e === 'U') {
          const length = e === 'x' ? 2 : e === 'u' ? 4 : 8;
          if (i + 2 + length > lineEnd) decline();
          for (let k = i + 2; k < i + 2 + length; k++) if (!isHexDigit(text.charCodeAt(k))) decline();
          const code = parseInt(text.slice(i + 2, i + 2 + length), 16);
          if (code > 0x10ffff) decline();
          out += String.fromCodePoint(code);
          i += 1 + length;
        } else {
          const decoded = e === undefined ? undefined : ESCAPES[e];
          if (decoded === undefined || i + 1 >= lineEnd) decline();
          out += decoded;
          i += 1;
        }
        chunk = i + 1;
      } else if (c < 0x7f) {
        if (c < 0x20) decline();
      } else {
        i = this.wide(c, i);
      }
    }
    return decline();
  }

  /** 引用符なしのキー（ブロック）。`:` の位置を返す */
  private plainKeyEnd(start: number): number {
    const text = this.text;
    const lineEnd = this.lineEnd;
    let prev = SP;
    for (let i = start; i < lineEnd; i++) {
      const c = text.charCodeAt(i);
      if (c < 0x7f) {
        if (c < 0x20) decline();
        if (c === COLON) {
          // 空白・改行が続かない `:` はキーの一部（yaml ライブラリの字句解析と同じ）
          const next = text.charCodeAt(i + 1);
          if (next === SP || next === LF) return i;
        }
        if (c === HASH && prev === SP) decline();
      } else {
        i = this.wide(c, i);
      }
      prev = c;
    }
    return decline();
  }

  /** マッピングのキーとして使える引用符なしのスカラーか（文字列になるものだけ。`1:` や `true:` は辞退） */
  private plainKey(start: number, end: number): string {
    const s = this.text.slice(start, end);
    if (typeof this.plainValue(s) !== 'string' || s === '<<' || s.charCodeAt(s.length - 1) === SP) decline();
    return s;
  }

  /** ブロックのマッピング。キーは今の行の indent の位置から始まる（`- ` の後ろを含む） */
  private blockMap(indent: number, depth: number): SrcMap {
    if (depth > MAX_DEPTH) decline();
    const text = this.text;
    const entries: SrcEntry[] = [];
    const map: SrcMap = { kind: 'map', entries, pos: this.posAt(this.lineStart + indent) };
    const cache = this.keyCache[depth];
    // true のあいだ、キーはすべて cache の中に順に見つかっている（重複が無いことが保証される）
    let inCache = cache !== undefined;
    let cursor = 0;
    let allPlain = true;
    let keys: Set<string> | undefined;
    for (;;) {
      const start = this.lineStart + indent;
      let key: string | undefined;
      let colon: number;
      if (text.charCodeAt(start) === DQ) {
        key = this.doubleQuoted(start);
        colon = this.end;
        if (text.charCodeAt(colon) !== COLON) decline();
        allPlain = false;
        inCache = false;
      } else {
        colon = -1;
        if (inCache) {
          // 確かめ済みのキーの直後が `: ` か `:\n` なら、plainKeyEnd もそこで止まる（文字を調べ直さない）
          for (let j = cursor; j < cache.length; j++) {
            const cached = cache[j];
            const end = start + cached.length;
            if (text.charCodeAt(end) !== COLON || !text.startsWith(cached, start)) continue;
            const after = text.charCodeAt(end + 1);
            if (after !== SP && after !== LF) continue;
            key = cached;
            colon = end;
            cursor = j + 1;
            break;
          }
        }
        if (key === undefined) {
          colon = this.plainKeyEnd(start);
          key = this.plainKey(start, colon);
          inCache = false;
        }
      }
      if (colon - start > MAX_KEY_SPAN) decline();
      if (!inCache) {
        if (keys === undefined) {
          keys = new Set();
          for (const entry of entries) keys.add(entry.key);
        }
        if (keys.has(key)) decline();
        keys.add(key);
      }
      const keyPos = this.posAt(start);
      const after = text.charCodeAt(colon + 1);
      let value: SrcNode;
      if (after === LF) {
        // 子のブロックは次の行から 2 つ深く字下げする
        this.nextLine();
        if (this.atEnd() || this.indent() !== indent + 2) decline();
        value = this.blockNode(indent + 2, depth + 1);
      } else if (after === SP) {
        value = this.inlineValue(colon + 2);
        this.nextLine();
      } else {
        decline();
      }
      entries.push({ key, keyPos, value });
      const next = this.atEnd() ? -1 : this.indent();
      if (next > indent) decline();
      if (next < indent) {
        if (!inCache && allPlain) this.keyCache[depth] = entries.map((entry) => entry.key);
        return map;
      }
    }
  }

  /** 今の行の indent の位置から始まるブロックのコレクション */
  private blockNode(indent: number, depth: number): SrcNode {
    const start = this.lineStart + indent;
    if (this.text.charCodeAt(start) === DASH && this.text.charCodeAt(start + 1) === SP) {
      return this.blockSeq(indent, depth);
    }
    return this.blockMap(indent, depth);
  }

  private blockSeq(indent: number, depth: number): SrcSeq {
    if (depth > MAX_DEPTH) decline();
    const text = this.text;
    const items: SrcNode[] = [];
    const seq: SrcSeq = { kind: 'seq', items, pos: this.posAt(this.lineStart + indent) };
    for (;;) {
      const dash = this.lineStart + indent;
      if (text.charCodeAt(dash) !== DASH || text.charCodeAt(dash + 1) !== SP) decline();
      if (this.isMapItem(dash + 2)) {
        // `- key: value` の要素。2 行目からのキーは `key` と同じ位置に揃える
        items.push(this.blockMap(indent + 2, depth + 1));
      } else {
        items.push(this.inlineValue(dash + 2));
        this.nextLine();
      }
      if (this.atEnd()) return seq;
      const next = this.indent();
      if (next < indent) return seq;
      if (next > indent) decline();
    }
  }

  /** シーケンスの要素がマッピング（`- key: value`）か */
  private isMapItem(start: number): boolean {
    const text = this.text;
    const c = text.charCodeAt(start);
    if (c === DQ) {
      this.doubleQuoted(start);
      return text.charCodeAt(this.end) === COLON;
    }
    if (c === LBRACKET || c === LBRACE) return false;
    const lineEnd = this.lineEnd;
    for (let i = start; i < lineEnd; i++) {
      if (text.charCodeAt(i) !== COLON) continue;
      const next = text.charCodeAt(i + 1);
      if (next === SP || next === LF) return true;
    }
    return false;
  }

  /** `key: ` や `- ` の後ろの 1 行の値。行末で終わらなければ辞退する */
  private inlineValue(start: number): SrcNode {
    const text = this.text;
    const c = text.charCodeAt(start);
    let node: SrcNode;
    if (c === DQ) {
      const s = this.doubleQuoted(start);
      node = this.scalar(s, s, false, start);
    } else if (c === LBRACKET) {
      node = this.flowSeq(start, 0);
    } else if (c === LBRACE) {
      node = this.flowMap(start, 0);
    } else {
      return this.blockPlain(start);
    }
    if (this.end !== this.lineEnd) decline();
    return node;
  }

  /** ブロックの中の引用符なしのスカラー（行末まで） */
  private blockPlain(start: number): SrcScalar {
    const text = this.text;
    const lineEnd = this.lineEnd;
    let prev = SP;
    for (let i = start; i < lineEnd; i++) {
      const c = text.charCodeAt(i);
      if (c < 0x7f) {
        if (c < 0x20) decline();
        // ` #` はコメント、`: ` はマッピングになる（emit.ts はどちらも引用符で囲む）
        if ((c === HASH && prev === SP) || (c === SP && prev === COLON)) decline();
      } else {
        i = this.wide(c, i);
      }
      prev = c;
    }
    const last = text.charCodeAt(lineEnd - 1);
    if (last === SP || last === COLON) decline();
    return this.plain(start, lineEnd);
  }

  /** フローの中の引用符なしのスカラーの終わり。末尾の空白 1 つ（` }` の前）は含めない */
  private flowPlainEnd(start: number): number {
    const text = this.text;
    const lineEnd = this.lineEnd;
    let i = start;
    for (; i < lineEnd; i++) {
      const c = text.charCodeAt(i);
      if (c < 0x7f) {
        if (c < 0x20) decline();
        if (FLOW_STOP[c] === 1) break;
      } else {
        i = this.wide(c, i);
      }
    }
    if (i > start && text.charCodeAt(i - 1) === SP) {
      i--;
      if (i === start || text.charCodeAt(i - 1) === SP) decline();
    }
    return i;
  }

  private flowNode(start: number, depth: number): SrcNode {
    const c = this.text.charCodeAt(start);
    if (c === DQ) {
      const s = this.doubleQuoted(start);
      return this.scalar(s, s, false, start);
    }
    if (c === LBRACKET) return this.flowSeq(start, depth);
    if (c === LBRACE) return this.flowMap(start, depth);
    const end = this.flowPlainEnd(start);
    this.end = end;
    return this.plain(start, end);
  }

  /** `[a, b]`（区切りは `, ` に限る） */
  private flowSeq(start: number, depth: number): SrcSeq {
    if (depth > MAX_DEPTH) decline();
    const text = this.text;
    const items: SrcNode[] = [];
    const seq: SrcSeq = { kind: 'seq', items, pos: this.posAt(start) };
    let i = start + 1;
    if (text.charCodeAt(i) === RBRACKET) {
      this.end = i + 1;
      return seq;
    }
    for (;;) {
      items.push(this.flowNode(i, depth + 1));
      const e = this.end;
      const c = text.charCodeAt(e);
      if (c === RBRACKET) {
        this.end = e + 1;
        return seq;
      }
      if (c !== COMMA || text.charCodeAt(e + 1) !== SP) decline();
      i = e + 2;
    }
  }

  /** `{ k: v, k2: v2 }`（空なら `{}`） */
  private flowMap(start: number, depth: number): SrcMap {
    if (depth > MAX_DEPTH) decline();
    const text = this.text;
    const entries: SrcEntry[] = [];
    const map: SrcMap = { kind: 'map', entries, pos: this.posAt(start) };
    let i = start + 1;
    const first = text.charCodeAt(i);
    if (first === RBRACE) {
      this.end = i + 1;
      return map;
    }
    if (first !== SP) decline();
    i++;
    for (;;) {
      let key: string;
      let e: number;
      if (text.charCodeAt(i) === DQ) {
        key = this.doubleQuoted(i);
        e = this.end;
      } else {
        e = this.flowPlainEnd(i);
        key = this.plainKey(i, e);
      }
      if (text.charCodeAt(e) !== COLON || text.charCodeAt(e + 1) !== SP) decline();
      for (const entry of entries) if (entry.key === key) decline();
      const keyPos = this.posAt(i);
      const value = this.flowNode(e + 2, depth + 1);
      entries.push({ key, keyPos, value });
      const v = this.end;
      const c = text.charCodeAt(v);
      if (c === SP && text.charCodeAt(v + 1) === RBRACE) {
        this.end = v + 2;
        return map;
      }
      if (c !== COMMA || text.charCodeAt(v + 1) !== SP) decline();
      i = v + 2;
    }
  }
}

/**
 * 正規形の YAML を構文木にする。正規形と判定できなければ null（yaml ライブラリの経路で読み直す）。
 * 受け付けた入力では、診断（エラー・警告）は出ない
 */
export function parseCanonicalYaml(text: string): SrcNode | null {
  try {
    return new CanonicalYamlParser(text).parse();
  } catch (e) {
    if (e === DECLINE) return null;
    throw e;
  }
}
