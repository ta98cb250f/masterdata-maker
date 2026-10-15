import { describe, expect, test } from 'vitest';
import {
  defaultTimeZone,
  epochToLocal,
  formatDisplay,
  formatIsoOffset,
  fromSerial,
  isValidTimeZone,
  localToEpoch,
  parseIsoOffset,
  parseUserDateTime,
  toSerial,
  tzOffsetMinutes,
  utcMs,
} from './datetime';

const TOKYO = 'Asia/Tokyo';
const NY = 'America/New_York';

describe('parseIsoOffset', () => {
  test('時差付きの ISO 8601 を読む', () => {
    expect(parseIsoOffset('2026-10-13T12:00:00+09:00')).toEqual({
      epochMs: Date.UTC(2026, 9, 13, 3, 0, 0),
      offsetMinutes: 540,
    });
    expect(parseIsoOffset('2026-10-13T12:00:00Z')).toEqual({
      epochMs: Date.UTC(2026, 9, 13, 12, 0, 0),
      offsetMinutes: 0,
    });
    expect(parseIsoOffset('2026-10-13T12:00:00.5-05:30')).toEqual({
      epochMs: Date.UTC(2026, 9, 13, 17, 30, 0, 500),
      offsetMinutes: -330,
    });
    expect(parseIsoOffset('2026-10-13T12:00:00.123+00:00')?.epochMs).toBe(
      Date.UTC(2026, 9, 13, 12, 0, 0, 123),
    );
  });

  test('-00:00 の時差は 0', () => {
    expect(Object.is(parseIsoOffset('2026-10-13T12:00:00-00:00')?.offsetMinutes, 0)).toBe(true);
  });

  test('形式や値の範囲が正しくなければ null', () => {
    for (const s of [
      '2026-10-13 12:00:00+09:00',
      '2026-10-13T12:00:00',
      '2026-10-13T12:00+09:00',
      '2026-10-13T12:00:00+0900',
      '2026-10-13t12:00:00z',
      '2026-02-30T00:00:00Z',
      '2026-13-01T00:00:00Z',
      '2026-10-13T24:00:00Z',
      '2026-10-13T12:60:00Z',
      '2026-10-13T12:00:60Z',
      '2026-10-13T12:00:00+24:00',
      '2026-10-13T12:00:00.1234Z',
      ' 2026-10-13T12:00:00Z',
    ]) {
      expect(parseIsoOffset(s), s).toBeNull();
    }
  });

  test('閏年の 2 月 29 日', () => {
    expect(parseIsoOffset('2028-02-29T00:00:00Z')).not.toBeNull();
    expect(parseIsoOffset('2026-02-29T00:00:00Z')).toBeNull();
  });
});

describe('formatIsoOffset', () => {
  test('その瞬間のタイムゾーンの時差を使う', () => {
    expect(formatIsoOffset(Date.UTC(2026, 9, 13, 3), TOKYO)).toBe('2026-10-13T12:00:00+09:00');
    expect(formatIsoOffset(Date.UTC(2026, 0, 15, 17), NY)).toBe('2026-01-15T12:00:00-05:00');
    expect(formatIsoOffset(Date.UTC(2026, 6, 15, 16), NY)).toBe('2026-07-15T12:00:00-04:00');
    expect(formatIsoOffset(Date.UTC(2026, 9, 13, 3), 'UTC')).toBe('2026-10-13T03:00:00+00:00');
    expect(formatIsoOffset(Date.UTC(2026, 9, 13, 3), 'Asia/Kolkata')).toBe('2026-10-13T08:30:00+05:30');
  });

  test('秒未満は切り捨てる', () => {
    expect(formatIsoOffset(Date.UTC(2026, 9, 13, 3, 0, 0, 999), TOKYO)).toBe('2026-10-13T12:00:00+09:00');
  });

  test('読み直すと同じ瞬間になる（時差が分単位でない古い日時を含む）', () => {
    for (const e of [Date.UTC(2026, 9, 13, 3), Date.UTC(1850, 0, 1, 0, 0, 0), Date.UTC(1880, 5, 1, 12, 34, 56)]) {
      for (const tz of [TOKYO, NY, 'Europe/Amsterdam']) {
        expect(parseIsoOffset(formatIsoOffset(e, tz))?.epochMs, `${tz} ${e}`).toBe(e);
      }
    }
  });
});

describe('tzOffsetMinutes', () => {
  test('夏時間を含む時差', () => {
    expect(tzOffsetMinutes(Date.UTC(2026, 9, 13), TOKYO)).toBe(540);
    expect(tzOffsetMinutes(Date.UTC(2026, 0, 15), NY)).toBe(-300);
    expect(tzOffsetMinutes(Date.UTC(2026, 6, 15), NY)).toBe(-240);
  });
});

describe('localToEpoch', () => {
  test('現地時刻からエポックへ', () => {
    expect(localToEpoch(2026, 10, 13, 12, 0, 0, TOKYO)).toBe(Date.UTC(2026, 9, 13, 3));
    expect(localToEpoch(2026, 1, 15, 12, 0, 0, NY)).toBe(Date.UTC(2026, 0, 15, 17));
  });

  test('月や日のはみ出しは繰り上げる', () => {
    expect(localToEpoch(2026, 13, 1, 0, 0, 0, 'UTC')).toBe(Date.UTC(2027, 0, 1));
    expect(localToEpoch(2026, 1, 0, 0, 0, 0, 'UTC')).toBe(Date.UTC(2025, 11, 31));
  });

  test('存在しない時刻（夏時間の開始）は進めた幅だけ後ろの時刻になる', () => {
    // New York の 2026-03-08 02:30 は存在しない → 03:30 夏時間（07:30Z）
    expect(localToEpoch(2026, 3, 8, 2, 30, 0, NY)).toBe(Date.UTC(2026, 2, 8, 7, 30));
    expect(formatIsoOffset(localToEpoch(2026, 3, 8, 2, 30, 0, NY), NY)).toBe('2026-03-08T03:30:00-04:00');
  });

  test('2 回ある時刻（夏時間の終了）は早い方を選ぶ', () => {
    // New York の 2026-11-01 01:30 は夏時間（05:30Z）と標準時（06:30Z）の 2 回ある
    expect(localToEpoch(2026, 11, 1, 1, 30, 0, NY)).toBe(Date.UTC(2026, 10, 1, 5, 30));
  });

  test('切り替わりの前後の時刻', () => {
    expect(localToEpoch(2026, 3, 8, 1, 59, 59, NY)).toBe(Date.UTC(2026, 2, 8, 6, 59, 59));
    expect(localToEpoch(2026, 3, 8, 3, 0, 0, NY)).toBe(Date.UTC(2026, 2, 8, 7, 0, 0));
    expect(localToEpoch(2026, 11, 1, 2, 0, 0, NY)).toBe(Date.UTC(2026, 10, 1, 7, 0, 0));
  });
});

describe('シリアル値', () => {
  test('1899-12-30 の現地時刻からの日数', () => {
    expect(toSerial(Date.UTC(1899, 11, 30), 'UTC')).toBe(0);
    expect(toSerial(Date.UTC(1899, 11, 31), 'UTC')).toBe(1);
    // Googleスプレッドシートのシリアル値: 1900-01-01 は 2、2026-10-13 は 46308
    expect(toSerial(Date.UTC(1900, 0, 1), 'UTC')).toBe(2);
    expect(toSerial(Date.UTC(2026, 9, 12, 15), TOKYO)).toBe(46308);
    expect(toSerial(Date.UTC(2026, 9, 13, 3), TOKYO)).toBe(46308.5);
    expect(toSerial(Date.UTC(1899, 11, 29), 'UTC')).toBe(-1);
  });

  test('fromSerial は toSerial の逆', () => {
    expect(fromSerial(46308, TOKYO)).toBe(Date.UTC(2026, 9, 12, 15));
    expect(fromSerial(46308.5, TOKYO)).toBe(Date.UTC(2026, 9, 13, 3));
    expect(fromSerial(0, 'UTC')).toBe(Date.UTC(1899, 11, 30));
    for (const e of [Date.UTC(2026, 2, 8, 12), Date.UTC(2026, 10, 1, 12), Date.UTC(2000, 1, 29, 1, 2, 3)]) {
      expect(fromSerial(toSerial(e, NY), NY)).toBe(e);
    }
  });

  test('夏時間の切り替わりの日も壁時計の日数で数える', () => {
    // 2026-03-08（New York）は 23 時間しかないが、シリアル値の差は 1 日
    const a = localToEpoch(2026, 3, 8, 0, 0, 0, NY);
    const b = localToEpoch(2026, 3, 9, 0, 0, 0, NY);
    expect(b - a).toBe(23 * 3600_000);
    expect(toSerial(b, NY) - toSerial(a, NY)).toBe(1);
  });
});

describe('formatDisplay', () => {
  test('YYYY-MM-DD HH:mm:ss（タイムゾーンの現地時刻）', () => {
    expect(formatDisplay(Date.UTC(2026, 9, 13, 3, 4, 5), TOKYO)).toBe('2026-10-13 12:04:05');
    expect(formatDisplay(Date.UTC(2026, 9, 13, 3, 4, 5), NY)).toBe('2026-10-12 23:04:05');
    expect(formatDisplay(Date.UTC(2026, 0, 1, 0, 0, 0), 'UTC')).toBe('2026-01-01 00:00:00');
  });

  test('0〜99 年も 4 桁で表す', () => {
    expect(formatDisplay(utcMs(99, 1, 2, 3, 4, 5), 'UTC')).toBe('0099-01-02 03:04:05');
    expect(epochToLocal(utcMs(99, 1, 2), 'UTC').year).toBe(99);
  });
});

describe('parseUserDateTime', () => {
  test('P-19 の形式を受け付ける', () => {
    expect(parseUserDateTime('2026-10-13', TOKYO)).toEqual({ epochMs: Date.UTC(2026, 9, 12, 15) });
    expect(parseUserDateTime('2026/10/13', TOKYO)).toEqual({ epochMs: Date.UTC(2026, 9, 12, 15) });
    expect(parseUserDateTime('2026-10-13 12:34', TOKYO)).toEqual({ epochMs: Date.UTC(2026, 9, 13, 3, 34) });
    expect(parseUserDateTime('2026/10/13 12:34:56', TOKYO)).toEqual({
      epochMs: Date.UTC(2026, 9, 13, 3, 34, 56),
    });
    expect(parseUserDateTime('2026/1/5 9:05', TOKYO)).toEqual({ epochMs: Date.UTC(2026, 0, 5, 0, 5) });
    expect(parseUserDateTime('  2026-10-13  ', TOKYO)).toEqual({ epochMs: Date.UTC(2026, 9, 12, 15) });
  });

  test('時差付きなら時差も返す', () => {
    expect(parseUserDateTime('2026-10-13T12:00:00-04:00', TOKYO)).toEqual({
      epochMs: Date.UTC(2026, 9, 13, 16),
      offsetMinutes: -240,
    });
  });

  test('時差が無ければタイムゾーンで解釈する（夏時間）', () => {
    expect(parseUserDateTime('2026-07-15 12:00', NY)?.epochMs).toBe(Date.UTC(2026, 6, 15, 16));
    expect(parseUserDateTime('2026-01-15 12:00', NY)?.epochMs).toBe(Date.UTC(2026, 0, 15, 17));
  });

  test('読めなければ null', () => {
    for (const s of ['abc', '', '2026-13-01', '2026-02-30', '2026-10-13 25:00', '2026-10/13', '26-10-13', '2026-10-13 12']) {
      expect(parseUserDateTime(s, TOKYO), s).toBeNull();
    }
  });
});

describe('タイムゾーン', () => {
  test('既定のタイムゾーンは実行環境のもの', () => {
    expect(defaultTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(isValidTimeZone(defaultTimeZone())).toBe(true);
  });

  test('IANA タイムゾーン名の検査', () => {
    expect(isValidTimeZone(TOKYO)).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });
});
