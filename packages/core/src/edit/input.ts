// 入力値の変換（FR-EDT-03〜05、P-16〜19）と、セルの値を編集用のテキストにする処理
import type { Cell, RawValue } from '../model/cell';
import { cellValue, isEmptyValue, isRichCell } from '../model/cell';
import type { EnumDef } from '../model/common';
import type { FieldDef, FieldType, ScalarFieldType } from '../model/field';
import { cloneRawValue, elementType, isListType } from '../model/field';
import type { Project } from '../model/project';
import { formatListText, parseListText } from '../sheet/listtext';
import { defaultTimeZone, formatDisplay, formatIsoOffset, parseIsoOffset, parseUserDateTime, wallFields } from '../util/datetime';
import { EditCode } from './codes';

export type InputParams = Record<string, string | number>;

/** 入力値の変換の失敗。code は「abc は整数ではありません」、hint は「整数を入力してください」の文言コード */
export interface InputError {
  code: string;
  hint: string;
  params: InputParams;
  /** リストの要素で失敗したとき、その位置（1 から数える） */
  index?: number;
}

export type ParsedInput =
  | { ok: true; kind: 'empty' }
  | { ok: true; kind: 'value'; value: RawValue }
  /** セル単位式（先頭の `=` を除いたもの。P-04） */
  | { ok: true; kind: 'formula'; formula: string }
  | { ok: false; error: InputError };

export interface InputContext {
  enums: readonly EnumDef[];
  /** 日時の入力と表示に使うタイムゾーン（DR-07） */
  timeZone: string;
}

/**
 * input: 利用者の入力・他のアプリからの貼り付け。`=` で始まれば式、先頭の `'` は「式ではない文字列」の印（FR-EDT-04）
 * value: 値のテキスト（型の変換・値のみの貼り付け）。`=` と `'` を特別に扱わない
 */
export type InputMode = 'input' | 'value';

/** 型の変換に要る列定義の部分 */
export type FieldTypeInfo = Pick<FieldDef, 'type' | 'enum_ref'>;

export function projectTimeZone(project: Project): string {
  return project.config.timezone ?? defaultTimeZone();
}

export function inputContext(project: Project): InputContext {
  return { enums: project.common.enums.items, timeZone: projectTimeZone(project) };
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const INT64_MAX = 9_223_372_036_854_775_807n;

type ScalarResult = { ok: true; value: RawValue } | { ok: false; error: InputError };

function failure(code: string, hint: string, params: InputParams): { ok: false; error: InputError } {
  return { ok: false, error: { code, hint, params } };
}

/** 3 桁ごとの `,` を取り除く（Googleスプレッドシートから貼った `1,000` を受け付ける） */
function stripThousands(s: string): string {
  return /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(s) ? s.replaceAll(',', '') : s;
}

const DECIMAL_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * 10 進表記を正確に整数にする（指数表記も可。`1.5e3` → 1500n）。
 * 整数でなければ 'fraction'、10 進表記でなければ null。桁が大きすぎるものは 'huge'
 */
function decimalToBigInt(s: string): bigint | 'fraction' | 'huge' | null {
  const m = DECIMAL_RE.exec(s);
  if (m === null) return null;
  const [, sign, intPart, fracPart = '', expPart] = m;
  if (intPart === '' && fracPart === '') return null;
  const digits = (intPart + fracPart).replace(/^0+/, '');
  if (digits === '') return 0n;
  const exp = expPart === undefined ? 0 : Number(expPart);
  const scale = exp - fracPart.length;
  let n: bigint;
  if (scale >= 0) {
    if (digits.length + scale > 40) return 'huge';
    n = BigInt(digits) * 10n ** BigInt(scale);
  } else {
    const cut = -scale;
    const tail = cut >= digits.length ? digits : digits.slice(digits.length - cut);
    if (/[^0]/.test(tail)) return 'fraction';
    const head = cut >= digits.length ? '0' : digits.slice(0, digits.length - cut);
    if (head.length > 40) return 'huge';
    n = BigInt(head);
  }
  return sign === '-' ? -n : n;
}

function parseInt32(text: string, raw: string): ScalarResult {
  const n = decimalToBigInt(stripThousands(text));
  if (n === null || n === 'fraction') return failure(EditCode.notInt, EditCode.hintInt, { input: raw });
  if (n === 'huge' || n > MAX_SAFE || n < -MAX_SAFE) return failure(EditCode.intOutOfRange, EditCode.hintIntRange, { input: raw });
  return { ok: true, value: Number(n) };
}

function parseInt64(text: string, raw: string): ScalarResult {
  const n = decimalToBigInt(stripThousands(text));
  if (n === null || n === 'fraction') return failure(EditCode.notInt, EditCode.hintInt, { input: raw });
  if (n === 'huge' || n > INT64_MAX || n < -INT64_MAX) return failure(EditCode.int64OutOfRange, EditCode.hintInt64Range, { input: raw });
  return { ok: true, value: n };
}

const FLOAT_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseFloat64(text: string, raw: string): ScalarResult {
  let s = stripThousands(text);
  const percent = s.endsWith('%');
  if (percent) s = s.slice(0, -1).trimEnd();
  if (!FLOAT_RE.test(s)) return failure(EditCode.notNumber, EditCode.hintNumber, { input: raw });
  let n = Number(s);
  if (percent) n /= 100;
  // DR-35: NaN と無限大は保存できない
  if (!Number.isFinite(n)) return failure(EditCode.numberOutOfRange, EditCode.hintNumberRange, { input: raw });
  return { ok: true, value: n === 0 ? 0 : n };
}

function parseBool(text: string, raw: string): ScalarResult {
  // P-17: TRUE / FALSE（大文字と小文字は問わない）と 1 / 0
  const t = text.toUpperCase();
  if (t === 'TRUE' || t === '1') return { ok: true, value: true };
  if (t === 'FALSE' || t === '0') return { ok: true, value: false };
  return failure(EditCode.notBool, EditCode.hintBool, { input: raw });
}

const MAX_LISTED_VALUES = 20;

function listValues(values: readonly string[]): string {
  const shown = values.slice(0, MAX_LISTED_VALUES).join(', ');
  return values.length > MAX_LISTED_VALUES ? `${shown}, …` : shown;
}

function parseEnum(text: string, raw: string, enumRef: string | undefined, ctx: InputContext): ScalarResult {
  const def = enumRef === undefined ? undefined : ctx.enums.find((e) => e.name === enumRef);
  // 列挙型が定義されていなければ照合できないので、そのまま受け付ける（列定義の誤りは検査で示す）
  if (def === undefined) return { ok: true, value: text.trim() };
  if (def.values.includes(text)) return { ok: true, value: text };
  const t = text.trim();
  if (def.values.includes(t)) return { ok: true, value: t };
  // P-18: 大文字と小文字を無視して 1 つだけ一致すれば、定義された値にする
  const lower = t.toLowerCase();
  const matches = def.values.filter((v) => v.toLowerCase() === lower);
  if (matches.length === 1) return { ok: true, value: matches[0] };
  const params = { input: raw, enum: def.name, values: listValues(def.values) };
  if (matches.length > 1) return failure(EditCode.enumAmbiguous, EditCode.hintEnum, { ...params, candidates: matches.join(', ') });
  return failure(EditCode.notEnum, EditCode.hintEnum, params);
}

function pad(n: number, width: number): string {
  return String(Math.abs(n)).padStart(width, '0');
}

/** 瞬間を、指定の時差の ISO 8601（秒まで）にする */
export function formatWithOffset(epochMs: number, offsetMinutes: number): string {
  const f = wallFields(epochMs + offsetMinutes * 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return (
    `${pad(f.year, 4)}-${pad(f.month, 2)}-${pad(f.day, 2)}T${pad(f.hour, 2)}:${pad(f.minute, 2)}:${pad(f.second, 2)}` +
    `${sign}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`
  );
}

function parseDateTime(text: string, raw: string, timeZone: string): ScalarResult {
  const parsed = parseUserDateTime(text, timeZone);
  if (parsed === null) return failure(EditCode.notDateTime, EditCode.hintDateTime, { input: raw });
  // DR-18: 秒まで持つ。秒未満を黙って捨てない
  if (parsed.epochMs % 1000 !== 0) return failure(EditCode.dateTimeSubsecond, EditCode.hintDateTimeSeconds, { input: raw });
  // P-19: 時差が無ければプロジェクトのタイムゾーンの時差を付ける
  const iso =
    parsed.offsetMinutes === undefined ? formatIsoOffset(parsed.epochMs, timeZone) : formatWithOffset(parsed.epochMs, parsed.offsetMinutes);
  return { ok: true, value: iso };
}

function parseScalar(text: string, type: ScalarFieldType, enumRef: string | undefined, ctx: InputContext): ScalarResult {
  if (type === 'string') return { ok: true, value: text };
  const t = text.trim();
  switch (type) {
    case 'int':
      return parseInt32(t, text);
    case 'int64':
      return parseInt64(t, text);
    case 'float':
      return parseFloat64(t, text);
    case 'bool':
      return parseBool(t, text);
    case 'enum':
      return parseEnum(text, text, enumRef, ctx);
    case 'datetime':
      return parseDateTime(t, text, ctx.timeZone);
  }
}

/** 値のテキストを列の型で解釈する（`=` と `'` は特別に扱わない） */
function parseValueText(text: string, field: FieldTypeInfo, ctx: InputContext): ParsedInput {
  const type = field.type;
  if (isListType(type)) {
    // P-16: 要素を `, ` でつないだ表記。空のリストは未入力（P-11）
    if (text.trim() === '') return { ok: true, kind: 'empty' };
    const items = parseListText(text);
    const elem = elementType(type);
    const values: RawValue[] = [];
    for (let i = 0; i < items.length; i++) {
      const r = parseScalar(items[i], elem, field.enum_ref, ctx);
      if (!r.ok) return { ok: false, error: { ...r.error, index: i + 1 } };
      values.push(r.value);
    }
    return { ok: true, kind: 'value', value: values };
  }
  // DR-15: 空のテキストは未入力。string 以外は前後の空白だけでも未入力
  if (text === '' || (type !== 'string' && text.trim() === '')) return { ok: true, kind: 'empty' };
  const r = parseScalar(text, type, field.enum_ref, ctx);
  return r.ok ? { ok: true, kind: 'value', value: r.value } : r;
}

/**
 * セルへの入力のテキストを、列の型の値・セル単位式・未入力のどれかにする。失敗したら呼び出し側は確定させない（FR-EDT-05）。
 * - `=` で始まればセル単位式（先頭の `=` を除いて保存する。構文エラーの式も受け付け、セルにエラーを表示する）
 * - 先頭の `'` は「式ではない文字列」の印。string 列では後ろをそのまま文字列にし、他の型では後ろを型に従って変換する
 * - 空のテキストは未入力（DR-15）
 */
export function parseCellInput(text: string, field: FieldTypeInfo, ctx: InputContext, mode: InputMode = 'input'): ParsedInput {
  if (mode === 'value') return parseValueText(text, field, ctx);
  if (text.startsWith('=')) {
    const formula = text.slice(1);
    if (formula.trim() === '') return failure(EditCode.emptyFormula, EditCode.hintFormula, { input: text });
    return { ok: true, kind: 'formula', formula };
  }
  if (text.startsWith("'")) {
    const rest = text.slice(1);
    if (field.type === 'string') return rest === '' ? { ok: true, kind: 'empty' } : { ok: true, kind: 'value', value: rest };
    return parseValueText(rest, field, ctx);
  }
  return parseValueText(text, field, ctx);
}

// ---- 値 → テキスト ----

function scalarText(value: RawValue, type: ScalarFieldType | FieldType, timeZone: string): string {
  if (Array.isArray(value)) return formatListText(value.map((v) => scalarText(v, type, timeZone)));
  if (typeof value === 'string') {
    if (type === 'datetime') {
      const p = parseIsoOffset(value);
      return p === null ? value : formatDisplay(p.epochMs, timeZone);
    }
    return value;
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'bigint') return value.toString();
  return String(value);
}

/**
 * 値を表示・コピー用のテキストにする。datetime は `YYYY-MM-DD HH:mm:ss`（タイムゾーンの現地時刻）、
 * リストは P-16 の表記（`1, 3, 7`）、真偽値は TRUE / FALSE
 */
export function formatValueText(value: RawValue, type: FieldType, timeZone: string): string {
  if (Array.isArray(value)) {
    const elem = isListType(type) ? elementType(type) : type;
    return formatListText(value.map((v) => scalarText(v, elem, timeZone)));
  }
  return scalarText(value, type, timeZone);
}

/** セルが持つセル単位式（値があれば値が優先されるので、値の無いときだけ） */
export function cellFormula(cell: Cell | undefined): string | undefined {
  if (!isRichCell(cell) || cell.override === undefined || cell.override === '') return undefined;
  return isEmptyValue(cell.value) ? cell.override : undefined;
}

/**
 * セルを編集用のテキストにする（数式バー・セル内の編集で使う）。
 * セル単位式は `=` 付き。`=` や `'` で始まる値には、式と区別するため先頭に `'` を付ける（parseCellInput で元に戻る）
 */
export function cellEditText(cell: Cell | undefined, field: Pick<FieldDef, 'type'>, timeZone: string): string {
  const formula = cellFormula(cell);
  if (formula !== undefined) return `=${formula}`;
  const value = cellValue(cell);
  if (isEmptyValue(value)) return '';
  const text = formatValueText(value as RawValue, field.type, timeZone);
  return text.startsWith('=') || text.startsWith("'") ? `'${text}` : text;
}

export type ConvertResult = { ok: true; value: RawValue | undefined } | { ok: false; error: InputError; text: string };

function sameValueType(from: FieldTypeInfo, to: FieldTypeInfo): boolean {
  if (from.type !== to.type) return false;
  if (from.type === 'enum' || from.type === 'list<enum>') return from.enum_ref === to.enum_ref;
  return true;
}

/**
 * 値を別の列の型に変換する（貼り付け・フィル・型の変更）。同じ型ならそのまま（型に合わない値も保つ）。
 * 違う型なら、表示用のテキストにしてから変換先の型で解釈する
 */
export function convertValue(value: RawValue, from: FieldTypeInfo, to: FieldTypeInfo, ctx: InputContext): ConvertResult {
  if (sameValueType(from, to)) return { ok: true, value: cloneRawValue(value) };
  const text = formatValueText(value, from.type, ctx.timeZone);
  const r = parseCellInput(text, to, ctx, 'value');
  if (!r.ok) return { ok: false, error: r.error, text };
  return { ok: true, value: r.kind === 'value' ? r.value : undefined };
}

/**
 * P-19: datetime の新しい値が既存の値と同じ瞬間なら、既存の値（元の時差）を保つ。
 * それ以外は新しい値を返す
 */
export function keepSameInstant(next: RawValue | undefined, old: RawValue | undefined, type: FieldType): RawValue | undefined {
  if (type !== 'datetime' || typeof next !== 'string' || typeof old !== 'string' || next === old) return next;
  const a = parseIsoOffset(next);
  const b = parseIsoOffset(old);
  return a !== null && b !== null && a.epochMs === b.epochMs ? old : next;
}
