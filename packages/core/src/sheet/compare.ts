// 並べ替えの比較（FR-SRT-01, 05、P-20）

/**
 * 並べ替え用の値。空文字の文字列は空欄として扱う（DR-15）。
 * error は式のエラー値（`#DIV/0!` など）
 */
export type SortKey =
  | { kind: 'number'; v: number }
  | { kind: 'bigint'; v: bigint }
  | { kind: 'datetime'; ms: number }
  | { kind: 'string'; v: string }
  | { kind: 'bool'; v: boolean }
  | { kind: 'error'; v: string }
  | { kind: 'empty' };

/** UTF-16 の単位を、コードポイント順（UTF-8 のバイト順）で比べられる値に直す */
function fixup(c: number): number {
  // サロゲート（U+D800〜U+DFFF）は U+10000 以上を表すので、U+E000〜U+FFFF より後に並べる
  if (c >= 0xe000) return c - 0x800;
  if (c >= 0xd800) return c + 0x2000;
  return c;
}

/** 文字列を Unicode のコードポイント順で比べる（UTF-8 のバイト順と同じ） */
export function compareCodePoints(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca !== cb) return fixup(ca) < fixup(cb) ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/** number と bigint を値の大小で比べる。NaN はどの数よりも大きいとする */
export function compareNumeric(a: number | bigint, b: number | bigint): number {
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) ? (Number.isNaN(b) ? 0 : 1) : -1;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (typeof a === 'bigint') return -compareBigNum(b as number, a);
  return compareBigNum(a, b as bigint);
}

/** number と bigint の比較 */
function compareBigNum(n: number, b: bigint): number {
  if (Number.isNaN(n)) return 1;
  if (n === Infinity) return 1;
  if (n === -Infinity) return -1;
  const fl = Math.floor(n);
  const bf = BigInt(fl);
  if (bf < b) return -1;
  if (bf > b) return 1;
  return n > fl ? 1 : 0;
}

// ---- セマンティック バージョニング（semver 2.0.0） ----

export interface SemVer {
  /** 数値の部分。桁数の制限が無いので文字列で持つ（先頭の 0 は無い） */
  major: string;
  minor: string;
  patch: string;
  /** プレリリースの識別子（`1.0.0-alpha.1` なら `['alpha', '1']`） */
  prerelease: string[];
  /** ビルドメタデータ（並べ替えには使わない） */
  build: string[];
}

function isDigits(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

/** 英数字とハイフンだけからなる空でない識別子か */
function isIdentifier(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45;
    if (!ok) return false;
  }
  return true;
}

function isNumericPart(s: string): boolean {
  return isDigits(s) && (s.length === 1 || s[0] !== '0');
}

/** semver 2.0.0 の形式の文字列を読む。読めなければ null（前後の空白や `v` の接頭辞も認めない） */
export function parseSemver(s: string): SemVer | null {
  let rest = s;
  let build: string[] = [];
  const plus = rest.indexOf('+');
  if (plus >= 0) {
    build = rest.slice(plus + 1).split('.');
    if (!build.every(isIdentifier)) return null;
    rest = rest.slice(0, plus);
  }
  let prerelease: string[] = [];
  const dash = rest.indexOf('-');
  if (dash >= 0) {
    prerelease = rest.slice(dash + 1).split('.');
    // 数字だけの識別子は先頭に 0 を付けない
    if (!prerelease.every((p) => isIdentifier(p) && (!isDigits(p) || isNumericPart(p)))) return null;
    rest = rest.slice(0, dash);
  }
  const core = rest.split('.');
  if (core.length !== 3 || !core.every(isNumericPart)) return null;
  return { major: core[0], minor: core[1], patch: core[2], prerelease, build };
}

/** 先頭に 0 の無い数字の文字列を、値として比べる */
function compareDigitStrings(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** semver の優先順位で比べる（ビルドメタデータは無視する） */
export function compareSemverParsed(a: SemVer, b: SemVer): number {
  const c =
    compareDigitStrings(a.major, b.major) || compareDigitStrings(a.minor, b.minor) || compareDigitStrings(a.patch, b.patch);
  if (c !== 0) return c;
  // プレリリースのある版は、無い版より前
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  const n = Math.min(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < n; i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    const xn = isDigits(x);
    const yn = isDigits(y);
    let d: number;
    if (xn && yn) d = compareDigitStrings(x, y);
    else if (xn !== yn) d = xn ? -1 : 1; // 数字だけの識別子は英数字の識別子より前
    else d = x < y ? -1 : x > y ? 1 : 0; // ASCII 順
    if (d !== 0) return d;
  }
  return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length < b.prerelease.length ? -1 : 1;
}

/**
 * `version` 列の比較（FR-SRT-05: `0.1.2` < `0.1.11`）。
 * semver として読めない文字列は、読める文字列の後にコードポイント順で並べる
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa && pb) return compareSemverParsed(pa, pb);
  if (pa) return -1;
  if (pb) return 1;
  return compareCodePoints(a, b);
}

// ---- 並べ替え ----

export type SortDirection = 'asc' | 'desc';

export interface CompareOptions {
  /** 文字列を semver として比べる（`version` 列） */
  semver?: boolean;
}

function isEmptyKey(k: SortKey): boolean {
  return k.kind === 'empty' || (k.kind === 'string' && k.v === '');
}

/**
 * 種類の順位。種類が混ざったときは、昇順で「数値（number と bigint は値で比べる）→ 日時 → 文字列 → 真偽値 → エラー」
 * の順にする（Excel の並べ替えの順序に合わせた。Googleスプレッドシートでは未検証）。空欄は常に末尾
 */
function rank(k: SortKey): number {
  switch (k.kind) {
    case 'number':
    case 'bigint':
      return 0;
    case 'datetime':
      return 1;
    case 'string':
      return 2;
    case 'bool':
      return 3;
    case 'error':
      return 4;
    case 'empty':
      return 5;
  }
}

/**
 * 並べ替え用の値を昇順で比べる。数値・bigint・日時は大小、文字列はコードポイント順（semver の指定があれば semver）、
 * 真偽値は FALSE < TRUE、エラーはエラー値の文字列のコードポイント順。空欄（空文字を含む）は末尾
 */
export function compareSortKeys(a: SortKey, b: SortKey, options: CompareOptions = {}): number {
  const ea = isEmptyKey(a);
  const eb = isEmptyKey(b);
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  switch (a.kind) {
    case 'number':
    case 'bigint':
      return compareNumeric(a.v, (b as { v: number | bigint }).v);
    case 'datetime': {
      const y = (b as { ms: number }).ms;
      return a.ms < y ? -1 : a.ms > y ? 1 : 0;
    }
    case 'string': {
      const y = (b as { v: string }).v;
      return options.semver ? compareSemver(a.v, y) : compareCodePoints(a.v, y);
    }
    case 'bool': {
      const y = (b as { v: boolean }).v;
      return a.v === y ? 0 : a.v ? 1 : -1;
    }
    case 'error':
      return compareCodePoints(a.v, (b as { v: string }).v);
    default:
      return 0;
  }
}

/**
 * 方向付きの比較。降順は昇順の逆（種類の順位も逆になる）だが、空欄は降順でも末尾（P-20）
 */
export function compareSortKeysDirected(a: SortKey, b: SortKey, direction: SortDirection, options: CompareOptions = {}): number {
  const ea = isEmptyKey(a);
  const eb = isEmptyKey(b);
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  const c = compareSortKeys(a, b, options);
  return direction === 'desc' ? -c : c;
}

export interface SortSpec {
  /** 行の番号から並べ替え用の値を得る */
  key: (row: number) => SortKey;
  direction: SortDirection;
  /** 文字列を semver として比べる（`version` 列） */
  semver?: boolean;
}

/**
 * 安定な並べ替え。rows（例: レコードのファイル上の順の番号）を specs の順に比べて並べ替えた、新しい配列を返す。
 * 値が等しい行は元の順を保つ
 */
export function sortRows(rows: readonly number[], specs: readonly SortSpec[]): number[] {
  const keys = specs.map((s) => rows.map((r) => s.key(r)));
  const idx = rows.map((_, i) => i);
  idx.sort((i, j) => {
    for (let s = 0; s < specs.length; s++) {
      const c = compareSortKeysDirected(keys[s][i], keys[s][j], specs[s].direction, { semver: specs[s].semver });
      if (c !== 0) return c;
    }
    return i - j;
  });
  return idx.map((i) => rows[i]);
}
