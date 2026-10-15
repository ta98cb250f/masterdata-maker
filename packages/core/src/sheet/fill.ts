// フィル（連続データの自動入力。FR-FIL-01〜05、P-41）

export type FillValue =
  | { kind: 'number'; v: number }
  | { kind: 'bigint'; v: bigint }
  | { kind: 'datetime'; ms: number }
  | { kind: 'string'; v: string }
  | { kind: 'other'; v: unknown }
  | { kind: 'empty' };

const EMPTY: FillValue = { kind: 'empty' };

/** 小数点以下の桁数（`Number.prototype.toString` の表記から数える） */
function decimalsOf(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = String(Math.abs(n));
  const e = s.indexOf('e');
  const mantissa = e < 0 ? s : s.slice(0, e);
  const exp = e < 0 ? 0 : Number(s.slice(e + 1));
  const dot = mantissa.indexOf('.');
  const frac = dot < 0 ? 0 : mantissa.length - dot - 1;
  return Math.max(0, frac - exp);
}

/** 浮動小数の誤差を消すため、decimals 桁に丸める（丸められない大きさ・桁数ならそのまま） */
function roundDecimals(x: number, decimals: number): number {
  if (!Number.isFinite(x) || decimals > 20 || Math.abs(x) >= 1e21) return x;
  const r = Number(x.toFixed(decimals));
  return Object.is(r, -0) ? 0 : r;
}

/** 有効数字 15 桁に丸める（Googleスプレッドシートの表示の桁数。直線で延長した値の誤差を消す） */
function round15(x: number): number {
  if (!Number.isFinite(x)) return x;
  const r = Number(x.toPrecision(15));
  return Object.is(r, -0) ? 0 : r;
}

/** 最小二乗法の直線。x は 0, 1, …, n-1 */
function linearFit(ys: readonly number[]): { slope: number; intercept: number } {
  const n = ys.length;
  const mx = (n - 1) / 2;
  let my = 0;
  for (const y of ys) my += y;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - mx) * (ys[i] - my);
    sxx += (i - mx) * (i - mx);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

function isArithmetic(vs: readonly number[]): boolean {
  if (vs.length < 3) return true;
  const step = vs[1] - vs[0];
  let scale = 0;
  for (const v of vs) scale = Math.max(scale, Math.abs(v));
  const tol = scale * 1e-12;
  for (let i = 2; i < vs.length; i++) {
    if (Math.abs(vs[i] - vs[i - 1] - step) > tol) return false;
  }
  return true;
}

function extendNumbers(vs: readonly number[], count: number): FillValue[] {
  const n = vs.length;
  if (n === 1) return Array.from({ length: count }, () => ({ kind: 'number', v: vs[0] }));
  if (isArithmetic(vs)) {
    const step = (vs[n - 1] - vs[0]) / (n - 1);
    const decimals = Math.max(...vs.map(decimalsOf));
    return Array.from({ length: count }, (_, k) => ({ kind: 'number', v: roundDecimals(vs[0] + step * (n + k), decimals) }));
  }
  const { slope, intercept } = linearFit(vs);
  return Array.from({ length: count }, (_, k) => ({ kind: 'number', v: round15(intercept + slope * (n + k)) }));
}

function extendDatetimes(ms: readonly number[], count: number): FillValue[] {
  const n = ms.length;
  if (n === 1) return Array.from({ length: count }, () => ({ kind: 'datetime', ms: ms[0] }));
  const step = ms[1] - ms[0];
  let regular = true;
  for (let i = 2; i < n; i++) if (ms[i] - ms[i - 1] !== step) regular = false;
  if (regular) return Array.from({ length: count }, (_, k) => ({ kind: 'datetime', ms: ms[n - 1] + step * (k + 1) }));
  const { slope, intercept } = linearFit(ms);
  // 直線で延長した日時は秒に丸める
  return Array.from({ length: count }, (_, k) => ({ kind: 'datetime', ms: Math.round((intercept + slope * (n + k)) / 1000) * 1000 }));
}

function repeatPattern(source: readonly FillValue[], count: number): FillValue[] {
  return Array.from({ length: count }, (_, k) => source[k % source.length]);
}

function extendBigints(vs: readonly bigint[], source: readonly FillValue[], count: number): FillValue[] {
  const n = vs.length;
  if (n === 1) return Array.from({ length: count }, () => ({ kind: 'bigint', v: vs[0] }));
  const step = vs[1] - vs[0];
  for (let i = 2; i < n; i++) if (vs[i] - vs[i - 1] !== step) return repeatPattern(source, count);
  return Array.from({ length: count }, (_, k) => ({ kind: 'bigint', v: vs[n - 1] + step * BigInt(k + 1) }));
}

/** 末尾の数字で分ける（`stage_01` → `stage_` と `01`）。末尾が数字でなければ null */
function splitTrailingDigits(s: string): { prefix: string; digits: string } | null {
  let i = s.length;
  while (i > 0) {
    const c = s.charCodeAt(i - 1);
    if (c < 48 || c > 57) break;
    i--;
  }
  if (i === s.length) return null;
  return { prefix: s.slice(0, i), digits: s.slice(i) };
}

/** 末尾の数字を進めた文字列を作る。負になるときは絶対値にする（Excel と同じ。`a1, a0` → `a1, a2`） */
function withNumber(prefix: string, n: bigint, width: number): string {
  const abs = n < 0n ? -n : n;
  return prefix + abs.toString().padStart(width, '0');
}

function extendStrings(vs: readonly string[], source: readonly FillValue[], count: number, singleStep: bigint): FillValue[] | null {
  const parts = vs.map(splitTrailingDigits);
  if (parts.some((p) => p === null)) return null;
  const ps = parts as { prefix: string; digits: string }[];
  const prefix = ps[0].prefix;
  if (ps.some((p) => p.prefix !== prefix)) return null;
  const nums = ps.map((p) => BigInt(p.digits));
  const n = nums.length;
  // ゼロ埋めの桁数は、続ける側の端の値に合わせる（桁が増えるときは切り詰めない）
  const width = ps[n - 1].digits.length;
  let step = singleStep;
  if (n >= 2) {
    step = nums[1] - nums[0];
    for (let i = 2; i < n; i++) if (nums[i] - nums[i - 1] !== step) return repeatPattern(source, count);
  }
  return Array.from({ length: count }, (_, k) => ({ kind: 'string', v: withNumber(prefix, nums[n - 1] + step * BigInt(k + 1), width) }));
}

function extend(source: readonly FillValue[], count: number, singleStep: bigint): FillValue[] {
  if (count <= 0) return [];
  if (source.length === 0) return Array.from({ length: count }, () => EMPTY);
  const kind = source[0].kind;
  if (source.every((v) => v.kind === kind)) {
    switch (kind) {
      case 'number':
        return extendNumbers(source.map((v) => (v as { v: number }).v), count);
      case 'bigint':
        return extendBigints(source.map((v) => (v as { v: bigint }).v), source, count);
      case 'datetime':
        return extendDatetimes(source.map((v) => (v as { ms: number }).ms), count);
      case 'string': {
        const r = extendStrings(source.map((v) => (v as { v: string }).v), source, count, singleStep);
        if (r) return r;
        break;
      }
      default:
        break;
    }
  }
  return repeatPattern(source, count);
}

/**
 * 下・右へのフィル: 元の値の並び（上から・左から）に続く count 個を推定する。
 * - 数値: 1 つなら複製。等差なら等差で続ける。等差でなければ最小二乗法の直線で延長する（P-41）
 * - bigint: 1 つなら複製。等差なら正確に続ける。等差でなければ並びを繰り返す
 * - 日時: 1 つなら複製。間隔が一定なら続ける。一定でなければ直線で延長し、秒に丸める
 * - 末尾が数字で、その前の部分が同じ文字列: 末尾の数字を等差で進める（1 つだけなら 1 ずつ）。ゼロ埋めの桁数を保つ
 * - それ以外（種類の混在・その他・空を含む）: 並びを繰り返す
 */
export function extendSeries(source: readonly FillValue[], count: number): FillValue[] {
  return extend(source, count, 1n);
}

/**
 * 上・左へのフィル: 元の並びを逆にして推定し、結果を逆にする。
 * 返り値は表示順（上から・左から）で、最後の要素が元の並びの先頭のすぐ上（左）に入る。
 * 末尾が数字の文字列が 1 つだけのときは、離れるほど 1 ずつ減らす（`stage_05` の上は `stage_04`、その上は `stage_03`）
 */
export function extendSeriesBackward(source: readonly FillValue[], count: number): FillValue[] {
  return extend([...source].reverse(), count, -1n).reverse();
}

/** 連番入力（FR-FIL-05）: start から step ずつ増やした count 個の値。先頭は start */
export function seriesFill(start: number, step: number, count: number): number[];
export function seriesFill(start: bigint, step: bigint, count: number): bigint[];
export function seriesFill(start: number | bigint, step: number | bigint, count: number): (number | bigint)[] {
  if (count <= 0) return [];
  if (typeof start === 'bigint' && typeof step === 'bigint') {
    return Array.from({ length: count }, (_, k) => start + step * BigInt(k));
  }
  const s = Number(start);
  const d = Number(step);
  const decimals = Math.max(decimalsOf(s), decimalsOf(d));
  return Array.from({ length: count }, (_, k) => roundDecimals(s + d * k, decimals));
}
