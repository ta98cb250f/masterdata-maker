// 日時の処理（タイムゾーン・ISO 8601・シリアル値）。
// 瞬間はエポックからのミリ秒（epochMs）で表す。「壁時計の値」は、現地時刻の年月日時分秒を
// UTC とみなしてミリ秒にしたもの（wallMs）で、タイムゾーンに依存しない計算に使う。

export const DAY_MS = 86_400_000;

/** 現地時刻の各フィールド。month は 1〜12 */
export interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

/** 年月日時分秒を UTC のミリ秒にする。月や日のはみ出しは繰り上げる。0〜99 年もそのまま扱う */
export function utcMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, millisecond);
  return d.getTime();
}

/** 壁時計の値（wallMs）を各フィールドに分ける */
export function wallFields(wallMs: number): LocalDateTime {
  const d = new Date(wallMs);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    millisecond: d.getUTCMilliseconds(),
  };
}

function fieldsToWallMs(f: LocalDateTime): number {
  return utcMs(f.year, f.month, f.day, f.hour, f.minute, f.second, f.millisecond);
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      era: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** IANA タイムゾーン名として使えるか */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** プロジェクト設定にタイムゾーンが無いときの既定値（実行環境のタイムゾーン） */
export function defaultTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** 瞬間を、タイムゾーンの現地時刻の各フィールドにする */
export function epochToLocal(epochMs: number, timeZone: string): LocalDateTime {
  const parts = formatterFor(timeZone).formatToParts(new Date(epochMs));
  let year = 0;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let bc = false;
  for (const p of parts) {
    switch (p.type) {
      case 'year':
        year = Number(p.value);
        break;
      case 'month':
        month = Number(p.value);
        break;
      case 'day':
        day = Number(p.value);
        break;
      case 'hour':
        // 古い実装では 0 時が "24" になることがある
        hour = Number(p.value) % 24;
        break;
      case 'minute':
        minute = Number(p.value);
        break;
      case 'second':
        second = Number(p.value);
        break;
      case 'era':
        bc = p.value.startsWith('B');
        break;
      default:
        break;
    }
  }
  if (bc) year = 1 - year;
  const millisecond = ((epochMs % 1000) + 1000) % 1000;
  return { year, month, day, hour, minute, second, millisecond };
}

/** 瞬間の壁時計の値 */
export function toWallMs(epochMs: number, timeZone: string): number {
  return fieldsToWallMs(epochToLocal(epochMs, timeZone));
}

function offsetMs(epochMs: number, timeZone: string): number {
  return toWallMs(epochMs, timeZone) - epochMs;
}

/**
 * その瞬間のタイムゾーンの UTC からの時差（分）。
 * 地方平均時（LMT）を使う古い日時では、秒を含むため小数になることがある。
 */
export function tzOffsetMinutes(epochMs: number, timeZone: string): number {
  return offsetMs(epochMs, timeZone) / 60_000;
}

/**
 * 壁時計の値を瞬間にする。
 * 夏時間の切り替わりの扱い（JavaScript の Date や Temporal の "compatible" と同じ）:
 * - 存在しない時刻（時計を進める切り替え。例: New York の 2026-03-08 02:30）は、切り替え前の時差で
 *   解釈する。結果として進めた幅だけ後ろの時刻（03:30 夏時間）になる
 * - 2 回ある時刻（時計を戻す切り替え。例: New York の 2026-11-01 01:30）は、早い方（夏時間）を選ぶ
 */
export function wallMsToEpoch(wallMs: number, timeZone: string): number {
  const before = offsetMs(wallMs - DAY_MS, timeZone);
  const after = offsetMs(wallMs + DAY_MS, timeZone);
  const candidates: number[] = [];
  for (const o of before === after ? [before] : [before, after]) {
    const e = wallMs - o;
    if (offsetMs(e, timeZone) === o) candidates.push(e);
  }
  if (candidates.length === 0) {
    // 存在しない時刻: 切り替え前の時差で解釈する
    return wallMs - before;
  }
  return Math.min(...candidates);
}

/** 現地時刻（タイムゾーン）を瞬間にする。月や日のはみ出しは繰り上げる。夏時間の扱いは wallMsToEpoch を参照 */
export function localToEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
  millisecond = 0,
): number {
  return wallMsToEpoch(utcMs(year, month, day, hour, minute, second, millisecond), timeZone);
}

/** シリアル値の起点（1899-12-30 00:00:00）の壁時計の値 */
export const SERIAL_EPOCH_WALL_MS = utcMs(1899, 12, 30);

/** 瞬間をシリアル値（タイムゾーンの現地時刻での 1899-12-30 からの日数）にする */
export function toSerial(epochMs: number, timeZone: string): number {
  return (toWallMs(epochMs, timeZone) - SERIAL_EPOCH_WALL_MS) / DAY_MS;
}

/** シリアル値を壁時計の値にする（ミリ秒に丸める） */
export function serialToWallMs(serial: number): number {
  return SERIAL_EPOCH_WALL_MS + Math.round(serial * DAY_MS);
}

/** シリアル値（タイムゾーンの現地時刻）を瞬間にする */
export function fromSerial(serial: number, timeZone: string): number {
  return wallMsToEpoch(serialToWallMs(serial), timeZone);
}

function pad(n: number, width: number): string {
  const s = String(Math.abs(n)).padStart(width, '0');
  return n < 0 ? `-${s}` : s;
}

function formatFields(f: LocalDateTime, dateTimeSeparator: string): string {
  return (
    `${pad(f.year, 4)}-${pad(f.month, 2)}-${pad(f.day, 2)}` +
    `${dateTimeSeparator}${pad(f.hour, 2)}:${pad(f.minute, 2)}:${pad(f.second, 2)}`
  );
}

/**
 * 瞬間を時差付きの ISO 8601（秒まで）にする。例: "2026-10-13T12:00:00+09:00"。
 * 時差はその瞬間のタイムゾーンのもの。秒未満は切り捨てる。
 * 時差が分単位でない古い日時（LMT）は時差を分に丸め、表す瞬間が変わらないように現地時刻を合わせる。
 */
export function formatIsoOffset(epochMs: number, timeZone: string): string {
  const sec = Math.floor(epochMs / 1000) * 1000;
  const offMin = Math.round(offsetMs(sec, timeZone) / 60_000);
  const f = wallFields(sec + offMin * 60_000);
  const sign = offMin < 0 ? '-' : '+';
  const abs = Math.abs(offMin);
  return `${formatFields(f, 'T')}${sign}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`;
}

/** 画面の表示形式 "YYYY-MM-DD HH:mm:ss"（タイムゾーンの現地時刻。秒未満は切り捨て） */
export function formatDisplay(epochMs: number, timeZone: string): string {
  return formatFields(epochToLocal(epochMs, timeZone), ' ');
}

function daysInMonth(year: number, month: number): number {
  return wallFields(utcMs(year, month + 1, 0)).day;
}

function validFields(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean {
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  );
}

const ISO_OFFSET_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;

/**
 * 時差付きの ISO 8601 を厳密に読む: YYYY-MM-DDTHH:mm:ss(.sss)?(Z|±HH:MM)。
 * 秒未満は 1〜3 桁を受け付ける。形式や値の範囲が正しくなければ null
 */
export function parseIsoOffset(s: string): { epochMs: number; offsetMinutes: number } | null {
  const m = ISO_OFFSET_RE.exec(s);
  if (m === null) return null;
  const [, ys, mos, ds, hs, mis, ss, fs, zs] = m;
  const year = Number(ys);
  const month = Number(mos);
  const day = Number(ds);
  const hour = Number(hs);
  const minute = Number(mis);
  const second = Number(ss);
  if (!validFields(year, month, day, hour, minute, second)) return null;
  const ms = fs === undefined ? 0 : Number(fs.padEnd(3, '0'));
  let offsetMinutes = 0;
  if (zs !== 'Z') {
    const oh = Number(zs.slice(1, 3));
    const om = Number(zs.slice(4, 6));
    if (oh > 23 || om > 59) return null;
    offsetMinutes = (oh * 60 + om) * (zs[0] === '-' ? -1 : 1);
    if (offsetMinutes === 0) offsetMinutes = 0; // -00:00 の -0 を 0 にする
  }
  const epochMs = utcMs(year, month, day, hour, minute, second, ms) - offsetMinutes * 60_000;
  return { epochMs, offsetMinutes };
}

const USER_LOCAL_RE = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * 利用者の入力した日時を読む（P-19）。
 * `YYYY-MM-DD`、`YYYY-MM-DD HH:mm`、`YYYY-MM-DD HH:mm:ss`（区切りは `/` も可。月・日・時は 1 桁も可）、
 * 時差付きの ISO 8601。時差が無ければ timeZone の現地時刻として解釈し、offsetMinutes は返さない
 */
export function parseUserDateTime(
  text: string,
  timeZone: string,
): { epochMs: number; offsetMinutes?: number } | null {
  const s = text.trim();
  const iso = parseIsoOffset(s);
  if (iso !== null) return iso;
  const m = USER_LOCAL_RE.exec(s);
  if (m === null) return null;
  const year = Number(m[1]);
  const month = Number(m[3]);
  const day = Number(m[4]);
  const hour = m[5] === undefined ? 0 : Number(m[5]);
  const minute = m[6] === undefined ? 0 : Number(m[6]);
  const second = m[7] === undefined ? 0 : Number(m[7]);
  if (!validFields(year, month, day, hour, minute, second)) return null;
  return { epochMs: localToEpoch(year, month, day, hour, minute, second, timeZone) };
}
