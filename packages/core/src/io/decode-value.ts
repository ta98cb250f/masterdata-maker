import type { Cell, ExtraValue, RawValue, RichCellInit } from '../model/cell';
import { RichCell } from '../model/cell';
import type { FieldDef, FieldType, ScalarFieldType } from '../model/field';
import { elementType, isListType } from '../model/field';
import { IoCode } from './codes';
import type { Reporter, SrcNode, SrcScalar } from './tree';

// 値の解釈。YAML のタグではなく列の型で解釈する（DR-42）

/**
 * cell: セルの値（`""` と `[]` は未入力。DR-15、P-11）
 * default: 列の default（`""` と `[]` もそのまま保持する。J-02、P-11）
 * element: リストの要素（`""` はそのまま。null は表せないのでエラー）
 */
export type ValueMode = 'cell' | 'default' | 'element';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function isSafeBigInt(value: bigint): boolean {
  return value <= MAX_SAFE && value >= -MAX_SAFE;
}

function isStringLike(type: ScalarFieldType): boolean {
  return type === 'string' || type === 'enum' || type === 'datetime';
}

function restoreSource(node: SrcScalar, r: Reporter, key: string): string {
  const code =
    node.value === null
      ? IoCode.nullRestoredAsString
      : typeof node.value === 'boolean'
        ? IoCode.boolRestoredAsString
        : IoCode.numberRestoredAsString;
  r.warn(code, node.pos, { key, source: node.source });
  return node.source;
}

function decodeScalar(
  node: SrcScalar,
  type: ScalarFieldType,
  r: Reporter,
  key: string,
  mode: ValueMode,
): RawValue | undefined {
  const v = node.value;
  if (typeof v === 'string') {
    if (v === '' && mode === 'cell') return undefined;
    return v;
  }
  if (v === null) {
    // P-12: 文字列・列挙型の列で元の表記があれば（例: 引用符なしの null）文字列として復元する
    if ((type === 'string' || type === 'enum') && node.implicit && node.source !== '') {
      return restoreSource(node, r, key);
    }
    if (mode === 'element') {
      r.error(IoCode.nullInList, node.pos, { key });
    } else {
      r.warn(IoCode.nullAsEmpty, node.pos, { key });
    }
    return undefined;
  }
  // DR-42: 引用符なしで数値・真偽値として読まれた値は、元の表記を文字列として復元する
  if (isStringLike(type) && node.implicit) return restoreSource(node, r, key);
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  // 整数（BigInt で読んでいる）
  if (type === 'int64') return v;
  if (type === 'float') return Number(v);
  return isSafeBigInt(v) ? Number(v) : v;
}

/** 列の型に従って値を解釈する。マッピングは表せないのでエラーにする */
export function decodeFieldValue(
  node: SrcNode,
  type: FieldType,
  r: Reporter,
  key: string,
  mode: ValueMode,
): RawValue | undefined {
  const elem = elementType(type);
  if (node.kind === 'scalar') return decodeScalar(node, elem, r, key, mode);
  if (node.kind === 'map') {
    r.error(IoCode.unsupportedValue, node.pos, { key });
    return undefined;
  }
  if (node.items.length === 0) return mode === 'cell' ? undefined : [];
  const items: RawValue[] = [];
  for (const item of node.items) {
    // リスト型でない列にリストがあっても、捨てずに保持する（検査で型エラーにする）
    const value = decodeFieldValue(item, isListType(type) ? elem : type, r, key, 'element');
    if (value !== undefined) items.push(value);
  }
  return items;
}

/** 文字列のキー（表示名・式など）。null は無視、引用符なしの数値・真偽値は表記を復元する */
export function decodeStringValue(node: SrcNode, r: Reporter, key: string): string | undefined {
  if (node.kind !== 'scalar') {
    r.error(IoCode.expectedString, node.pos, { key });
    return undefined;
  }
  const v = node.value;
  if (typeof v === 'string') return v;
  if (v === null) {
    r.warn(IoCode.nullValueIgnored, node.pos, { key });
    return undefined;
  }
  if (node.implicit) return restoreSource(node, r, key);
  r.error(IoCode.expectedString, node.pos, { key });
  return undefined;
}

/** リストの要素の文字列（列挙型の values など）。null は表せないのでエラー */
export function decodeStringElement(node: SrcNode, r: Reporter, key: string): string | undefined {
  if (node.kind === 'scalar' && node.value === null) {
    if (node.implicit && node.source !== '') return restoreSource(node, r, key);
    r.error(IoCode.nullInList, node.pos, { key });
    return undefined;
  }
  return decodeStringValue(node, r, key);
}

/** 真偽値のキー（export など）。null は無視する */
export function decodeBool(node: SrcNode, r: Reporter, key: string): boolean | undefined {
  if (node.kind === 'scalar') {
    if (typeof node.value === 'boolean') return node.value;
    if (node.value === null) {
      r.warn(IoCode.nullValueIgnored, node.pos, { key });
      return undefined;
    }
  }
  r.error(IoCode.expectedBoolean, node.pos, { key });
  return undefined;
}

/** 整数のキー（max_length・列幅など）。安全な整数の範囲に限る */
export function decodeInteger(node: SrcNode, r: Reporter, key: string): number | undefined {
  if (node.kind === 'scalar') {
    const v = node.value;
    if (typeof v === 'bigint' && isSafeBigInt(v)) return Number(v);
    if (typeof v === 'number' && Number.isSafeInteger(v)) return v;
    if (v === null) {
      r.warn(IoCode.nullValueIgnored, node.pos, { key });
      return undefined;
    }
  }
  r.error(IoCode.expectedInteger, node.pos, { key });
  return undefined;
}

/** 数値のキー（warn_deviation など） */
export function decodeNumber(node: SrcNode, r: Reporter, key: string): number | undefined {
  if (node.kind === 'scalar') {
    const v = node.value;
    if (typeof v === 'number') return v;
    if (typeof v === 'bigint') return Number(v);
    if (v === null) {
      r.warn(IoCode.nullValueIgnored, node.pos, { key });
      return undefined;
    }
  }
  r.error(IoCode.expectedNumber, node.pos, { key });
  return undefined;
}

/** 列の型に合わせた数値（int64 列は BigInt のまま、int 列は安全な範囲なら number） */
export function numberForType(value: number | bigint, type: FieldType): number | bigint {
  if (typeof value === 'number') return value;
  const elem = elementType(type);
  if (elem === 'int64') return value;
  if (elem === 'float') return Number(value);
  return isSafeBigInt(value) ? Number(value) : value;
}

const RICH_CELL_STRING_KEYS = ['override', 'color', 'comment'] as const;

/** セルを解釈する。マッピングは RichCell（DR-11） */
export function decodeCell(node: SrcNode, field: FieldDef, r: Reporter): Cell | undefined {
  if (node.kind !== 'map') return decodeFieldValue(node, field.type, r, field.name, 'cell');
  const init: RichCellInit = {};
  const extra: [string, ExtraValue][] = [];
  for (const entry of node.entries) {
    if (entry.key === 'value') {
      const value = decodeFieldValue(entry.value, field.type, r, field.name, 'cell');
      if (value !== undefined) init.value = value;
    } else if ((RICH_CELL_STRING_KEYS as readonly string[]).includes(entry.key)) {
      const s = decodeStringValue(entry.value, r, `${field.name}.${entry.key}`);
      // 空文字は未設定と同じ
      if (s !== undefined && s !== '') init[entry.key as (typeof RICH_CELL_STRING_KEYS)[number]] = s;
    } else {
      // 知らないキーは読み込みエラー。値は保持する
      r.error(IoCode.unknownRichCellKey, entry.keyPos, { key: entry.key, field: field.name });
      extra.push([entry.key, toExtraValue(entry.value)]);
    }
  }
  const cell = new RichCell({ ...init, extra });
  // セル色・メモ・セル単位式が無ければ値だけのセルにする
  return cell.hasAnnotations() ? cell : cell.value;
}

/** 構文木をそのままの構造の値にする（列定義に無いキーの保持に使う。DR-34） */
export function toExtraValue(node: SrcNode): ExtraValue {
  if (node.kind === 'scalar') return node.value;
  if (node.kind === 'seq') return node.items.map(toExtraValue);
  const map = new Map<string, ExtraValue>();
  for (const entry of node.entries) map.set(entry.key, toExtraValue(entry.value));
  return map;
}
