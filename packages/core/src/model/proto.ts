// Protocol Buffers のフィールド番号（P-63）。テーブルファイルの `proto` に列名 → 番号と、使わなくなった番号（reserved）を
// 保存し、列の並べ替え・削除・出力対象の切り替えで番号が変わらないようにする
// （https://protobuf.dev/programming-guides/proto3/#assigning 、#deleting）
import type { FieldDef, FieldType } from './field';
import { elementType, isFieldExported, isListType } from './field';

/** フィールド番号に使える範囲（2^29 − 1 まで） */
export const PROTO_FIELD_NUMBER_MIN = 1;
export const PROTO_FIELD_NUMBER_MAX = 536_870_911;
/** protobuf の実装が予約している番号（.proto で使うと protoc がエラーにする） */
export const PROTO_IMPLEMENTATION_RESERVED_MIN = 19_000;
export const PROTO_IMPLEMENTATION_RESERVED_MAX = 19_999;

/** 使わなくなった番号。name は削除した列の名前（同じ名前の列を作り直したら外す） */
export interface ProtoReserved {
  number: number;
  name?: string;
}

/** テーブルのフィールド番号 */
export interface TableProto {
  /** 列名 → 番号（列の順） */
  fields: [string, number][];
  /** 番号の昇順 */
  reserved: ProtoReserved[];
}

export function cloneTableProto(proto: TableProto): TableProto {
  return { fields: proto.fields.map(([name, n]) => [name, n]), reserved: proto.reserved.map((r) => ({ ...r })) };
}

/** proto のスカラー型。string・enum（値は文字列で、番号を持たない）・datetime（DR-18 の文字列のまま）は string */
export function scalarProtoType(type: FieldType): 'int64' | 'double' | 'bool' | 'string' {
  switch (elementType(type)) {
    case 'int':
    case 'int64':
      return 'int64';
    case 'float':
      return 'double';
    case 'bool':
      return 'bool';
    default:
      return 'string';
  }
}

/** .proto でのラベルと型（`optional int64` など）。これが変わる型の変更では、古い番号のままだと古い .proto から作ったコードで読めない */
export function protoFieldKind(type: FieldType): string {
  return `${isListType(type) ? 'repeated' : 'optional'} ${scalarProtoType(type)}`;
}

/** フィールド番号として .proto に書けるか */
export function isValidProtoFieldNumber(n: number): boolean {
  return (
    Number.isInteger(n) &&
    n >= PROTO_FIELD_NUMBER_MIN &&
    n <= PROTO_FIELD_NUMBER_MAX &&
    !(n >= PROTO_IMPLEMENTATION_RESERVED_MIN && n <= PROTO_IMPLEMENTATION_RESERVED_MAX)
  );
}

/** proto の識別子にできるか（英字か _ で始まり、英数字と _ が続く）。型名・フィールド名・reserved の名前に使う */
export function isProtoIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function uniqueColumns(columns: readonly FieldDef[]): FieldDef[] {
  const seen = new Set<string>();
  return columns.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
}

/**
 * 番号を保存していないテーブル（`proto` の無いファイル）の番号。以前の出力と同じく出力する列の順に 1 から付け、
 * 続けて出力しない列に付ける（既に出力した .pb とそのまま読み合える）
 */
export function legacyProto(columns: readonly FieldDef[]): TableProto {
  const cols = uniqueColumns(columns);
  const ordered = [...cols.filter(isFieldExported), ...cols.filter((c) => !isFieldExported(c))];
  const numbers = new Map(ordered.map((c, i) => [c.name, i + 1]));
  return { fields: cols.map((c) => [c.name, numbers.get(c.name) as number]), reserved: [] };
}

function nextNumber(max: number): number {
  const n = max + 1;
  return n >= PROTO_IMPLEMENTATION_RESERVED_MIN && n <= PROTO_IMPLEMENTATION_RESERVED_MAX ? PROTO_IMPLEMENTATION_RESERVED_MAX + 1 : n;
}

/**
 * 保存されている番号（無ければ legacyProto）を今の列に合わせる。列に無い名前の番号は名前ごと reserved にし
 * （proto の識別子でない名前と、既に reserved にある名前は番号だけにする。.proto に書けない・重ねて書けないため）、
 * 番号の無い列には使った番号（reserved を含む）の最大 + 1 を列の順に付ける（19000〜19999 は飛ばす）。
 * 今の列名と同じ reserved の名前は外す（protoc は reserved の名前のフィールドをエラーにする）。
 * 結果の fields は列の順、reserved は番号の順。同じ入力からは同じ結果になる
 */
export function resolveProto(stored: TableProto | undefined, columns: readonly FieldDef[]): TableProto {
  const base = stored ?? legacyProto(columns);
  const cols = uniqueColumns(columns);
  const names = new Set(cols.map((c) => c.name));
  const assigned = new Map<string, number>();
  for (const [name, n] of base.fields) {
    if (!assigned.has(name)) assigned.set(name, n);
  }
  const reserved = base.reserved.map((r) => ({ ...r }));
  const reservedNames = new Set(reserved.flatMap((r) => (r.name === undefined ? [] : [r.name])));
  for (const [name, n] of assigned) {
    if (names.has(name)) continue;
    if (isProtoIdentifier(name) && !reservedNames.has(name)) {
      reserved.push({ number: n, name });
      reservedNames.add(name);
    } else {
      reserved.push({ number: n });
    }
  }
  let max = 0;
  for (const [, n] of base.fields) max = Math.max(max, n);
  for (const r of reserved) max = Math.max(max, r.number);
  const fields: [string, number][] = cols.map((c) => {
    let n = assigned.get(c.name);
    if (n === undefined) {
      n = nextNumber(max);
      max = n;
    }
    return [c.name, n];
  });
  for (const r of reserved) {
    if (r.name !== undefined && names.has(r.name)) delete r.name;
  }
  reserved.sort((a, b) => a.number - b.number || compareText(a.name ?? '', b.name ?? ''));
  return { fields, reserved };
}

/** 環境の照合順序に依らない比較（同じ入力から同じ結果にする。FR-OUT-03） */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 列の変更の後の番号。before は変更前の列（`proto` が無ければ、この列で以前の番号を決める）。
 * 保存されていた番号は先に before に合わせる（手で消した列の番号を reserved にしてから変更を当てる）。
 * rename は列名の変更（番号はそのまま）。proto の型が変わった列（int → string など）は古い番号を reserved にして
 * 新しい番号を付ける。結果は after の列に合わせる（resolveProto）
 */
export function protoAfterColumnChange(
  stored: TableProto | undefined,
  before: readonly FieldDef[],
  after: readonly FieldDef[],
  rename?: { from: string; to: string },
): TableProto {
  const base = resolveProto(stored, before);
  const renamed = (name: string) => (rename !== undefined && name === rename.from ? rename.to : name);
  const fields = new Map<string, number>();
  for (const [name, n] of base.fields) {
    const key = renamed(name);
    if (!fields.has(key)) fields.set(key, n);
  }
  const reserved = base.reserved.map((r) => ({ ...r }));
  const kinds = new Map<string, string>();
  for (const c of before) {
    const key = renamed(c.name);
    if (!kinds.has(key)) kinds.set(key, protoFieldKind(c.type));
  }
  for (const c of uniqueColumns(after)) {
    const kind = kinds.get(c.name);
    const n = fields.get(c.name);
    if (kind === undefined || n === undefined || kind === protoFieldKind(c.type)) continue;
    reserved.push({ number: n });
    fields.delete(c.name);
  }
  return resolveProto({ fields: [...fields], reserved }, after);
}

function sameProto(a: TableProto, b: TableProto): boolean {
  return (
    a.fields.length === b.fields.length &&
    a.fields.every(([name, n], i) => b.fields[i][0] === name && b.fields[i][1] === n) &&
    a.reserved.length === 0 &&
    b.reserved.length === 0
  );
}

/**
 * 列を変えるパッチの後にテーブルが持つ番号（protoAfterColumnChange）。`proto` の無いテーブルで、結果が変更後の列に
 * 以前の規則を当てたものと同じなら undefined のままにする（番号は同じで、ファイルに `proto` を書き足さずに済む）
 */
export function nextTableProto(
  stored: TableProto | undefined,
  before: readonly FieldDef[],
  after: readonly FieldDef[],
  rename?: { from: string; to: string },
): TableProto | undefined {
  const next = protoAfterColumnChange(stored, before, after, rename);
  return stored === undefined && sameProto(next, legacyProto(after)) ? undefined : next;
}
