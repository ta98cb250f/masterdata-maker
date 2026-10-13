import type { DiagnosticParams } from '../model/diagnostic';
import { IoCode } from './codes';

// 正規形の書き出し（DR-30〜36、DR-40〜41、DR-50〜51）。
// 書き出す内容を「書き方の指定付きの木」（OutNode）にしてから、YAML か JSON のテキストにする

export type OutScalarValue = null | boolean | number | bigint | string;

export interface OutScalar {
  kind: 'scalar';
  value: OutScalarValue;
  /** 文字列を必ず引用符で囲む（datetime の値。DR-41） */
  quote?: boolean;
}

export interface OutSeq {
  kind: 'seq';
  items: OutNode[];
  /** true なら 1 行（フロー形式）。フローの中の子は常にフロー */
  flow: boolean;
}

export interface OutMap {
  kind: 'map';
  entries: [string, OutNode][];
  flow: boolean;
}

export type OutNode = OutScalar | OutSeq | OutMap;

/** 書き出せない値（NaN・Infinity など。DR-35） */
export class SerializeError extends Error {
  constructor(
    readonly code: string,
    readonly params: DiagnosticParams = {},
  ) {
    super(code);
    this.name = 'SerializeError';
  }
}

export function scalar(value: OutScalarValue, quote = false): OutScalar {
  return quote ? { kind: 'scalar', value, quote } : { kind: 'scalar', value };
}

export function seq(items: OutNode[], flow: boolean): OutSeq {
  return { kind: 'seq', items, flow };
}

export function map(entries: [string, OutNode][], flow: boolean): OutMap {
  return { kind: 'map', entries, flow };
}

/** DR-35: 読み戻して同じ値になる最も短い 10 進表記 */
export function formatNumber(value: number, key: string): string {
  if (!Number.isFinite(value)) throw new SerializeError(IoCode.nonFiniteNumber, { key, value: String(value) });
  return String(value);
}

// ---- YAML ----

// YAML 1.1 で null・真偽値になる語（小文字にして比べる。保守的に大文字小文字の混在も含める）
const YAML_SPECIAL_WORDS = new Set(['~', 'null', 'y', 'yes', 'n', 'no', 'true', 'false', 'on', 'off']);

// 先頭に来ると引用符なしでは書けない文字
const YAML_INDICATOR_START = /^[-?:,[\]{}#&*!|>'"%@`]/;
// 改行・タブ・制御文字・BOM・行区切りなど（エスケープが必要な文字）
const YAML_NEEDS_ESCAPE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff\ufffe\uffff]|[\ud800-\udfff]/u;

/**
 * DR-41: 文字列を引用符で囲む必要があるか。
 * YAML 1.1 と 1.2 のどちらかで文字列以外に読まれうるもの、引用符なしでは書けないものを囲む。
 * 迷うものは囲む（保守的に判定する）
 */
export function yamlNeedsQuote(s: string, flow: boolean): boolean {
  if (s === '') return true;
  if (YAML_SPECIAL_WORDS.has(s.toLowerCase())) return true;
  if (s === '<<' || s === '=') return true;
  // 数値・日時・60 進数・.5・+1 など
  if (/^[-+]?\.?[0-9]/.test(s)) return true;
  if (/^[-+]?\.(?:inf|nan)$/i.test(s)) return true;
  if (YAML_INDICATOR_START.test(s)) return true;
  if (s.startsWith('...')) return true;
  if (/^\s|\s$/u.test(s)) return true;
  if (s.includes(': ') || s.includes(' #') || s.endsWith(':')) return true;
  if (YAML_NEEDS_ESCAPE.test(s)) return true;
  // フローの中では区切りの文字を含められない。`:` と `#` も古いパーサーに配慮して囲む
  if (flow && /[,[\]{}:#]/.test(s)) return true;
  return false;
}

function hex4(code: number): string {
  return code.toString(16).toUpperCase().padStart(4, '0');
}

/** YAML のダブルクォートの文字列 */
export function yamlDoubleQuote(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else if (
      c < 0x20 ||
      (c >= 0x7f && c <= 0x9f) ||
      c === 0x2028 ||
      c === 0x2029 ||
      c === 0xfeff ||
      c === 0xfffe ||
      c === 0xffff ||
      (c >= 0xd800 && c <= 0xdfff)
    ) {
      out += `\\u${hex4(c)}`;
    } else out += ch;
  }
  return `${out}"`;
}

export function yamlString(s: string, flow: boolean, forceQuote = false): string {
  return forceQuote || yamlNeedsQuote(s, flow) ? yamlDoubleQuote(s) : s;
}

function yamlScalar(node: OutScalar, flow: boolean, key: string): string {
  const v = node.value;
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return formatNumber(v, key);
  return yamlString(v, flow, node.quote === true);
}

/** 1 行に収まる形（スカラー・フロー・空のコレクション） */
function yamlInline(node: OutNode, flow: boolean, key: string): string {
  if (node.kind === 'scalar') return yamlScalar(node, flow, key);
  if (node.kind === 'seq') {
    if (node.items.length === 0) return '[]';
    return `[${node.items.map((item) => yamlInline(item, true, key)).join(', ')}]`;
  }
  if (node.entries.length === 0) return '{}';
  const parts = node.entries.map(([k, v]) => `${yamlString(k, true)}: ${yamlInline(v, true, `${key}.${k}`)}`);
  return `{ ${parts.join(', ')} }`;
}

function isBlock(node: OutNode): node is OutSeq | OutMap {
  if (node.kind === 'scalar' || node.flow) return false;
  return node.kind === 'seq' ? node.items.length > 0 : node.entries.length > 0;
}

function yamlBlockMap(node: OutMap, indent: number, lines: string[], path: string): void {
  const pad = ' '.repeat(indent);
  for (const [k, v] of node.entries) {
    const key = yamlString(k, false);
    const childPath = path === '' ? k : `${path}.${k}`;
    if (isBlock(v)) {
      lines.push(`${pad}${key}:`);
      if (v.kind === 'map') yamlBlockMap(v, indent + 2, lines, childPath);
      else yamlBlockSeq(v, indent + 2, lines, childPath);
    } else {
      lines.push(`${pad}${key}: ${yamlInline(v, false, childPath)}`);
    }
  }
}

function yamlBlockSeq(node: OutSeq, indent: number, lines: string[], path: string): void {
  const pad = ' '.repeat(indent);
  node.items.forEach((item, i) => {
    const childPath = `${path}[${i}]`;
    if (!isBlock(item)) {
      lines.push(`${pad}- ${yamlInline(item, false, childPath)}`);
      return;
    }
    // 要素の 1 行目を `- ` の後ろに続け、残りは 2 つ深く字下げする
    const sub: string[] = [];
    if (item.kind === 'map') yamlBlockMap(item, indent + 2, sub, childPath);
    else yamlBlockSeq(item, indent + 2, sub, childPath);
    sub[0] = `${pad}- ${sub[0].slice(indent + 2)}`;
    lines.push(...sub);
  });
}

/** YAML 1.2 のテキストにする（インデント 2、LF、末尾の改行 1 つ。DR-31、DR-40） */
export function emitYaml(root: OutMap): string {
  if (!isBlock(root)) return `${yamlInline(root, false, '')}\n`;
  const lines: string[] = [];
  yamlBlockMap(root, 0, lines, '');
  return `${lines.join('\n')}\n`;
}

// ---- JSON ----

function jsonScalar(node: OutScalar, key: string): string {
  const v = node.value;
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return formatNumber(v, key);
  return JSON.stringify(v);
}

function jsonInline(node: OutNode, key: string): string {
  if (node.kind === 'scalar') return jsonScalar(node, key);
  if (node.kind === 'seq') {
    if (node.items.length === 0) return '[]';
    return `[${node.items.map((item) => jsonInline(item, key)).join(', ')}]`;
  }
  if (node.entries.length === 0) return '{}';
  const parts = node.entries.map(([k, v]) => `${JSON.stringify(k)}: ${jsonInline(v, `${key}.${k}`)}`);
  return `{ ${parts.join(', ')} }`;
}

function jsonNode(node: OutNode, indent: number, path: string): string {
  if (!isBlock(node)) return jsonInline(node, path);
  const pad = ' '.repeat(indent + 2);
  const end = ' '.repeat(indent);
  if (node.kind === 'seq') {
    const items = node.items.map((item, i) => `${pad}${jsonNode(item, indent + 2, `${path}[${i}]`)}`);
    return `[\n${items.join(',\n')}\n${end}]`;
  }
  const entries = node.entries.map(([k, v]) => {
    const childPath = path === '' ? k : `${path}.${k}`;
    return `${pad}${JSON.stringify(k)}: ${jsonNode(v, indent + 2, childPath)}`;
  });
  return `{\n${entries.join(',\n')}\n${end}}`;
}

/** JSON のテキストにする（インデント 2、LF、末尾の改行 1 つ。DR-31、DR-50〜51） */
export function emitJson(root: OutMap): string {
  return `${jsonNode(root, 0, '')}\n`;
}
