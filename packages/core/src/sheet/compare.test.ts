import { describe, expect, it } from 'vitest';
import { compareCodePoints, compareNumeric, compareSemver, compareSortKeys, parseSemver, sortRows } from './compare';
import type { SortKey } from './compare';

const sorted = (xs: string[], cmp: (a: string, b: string) => number) => [...xs].sort(cmp);

/** UTF-8 のバイト列（core は Node.js の型を使わないので自前で変換する） */
function utf8(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
}

function compareBytes(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

describe('文字列のコードポイント順', () => {
  it('UTF-8 のバイト順と同じになる（サロゲートペアに注意）', () => {
    const xs = ['\u{1F600}', 'Ａ', 'b', 'a', 'B', 'あ', '', 'ab', ''];
    const byBytes = [...xs].sort((a, b) => compareBytes(utf8(a), utf8(b)));
    expect(utf8('\u{1F600}')).toEqual([0xf0, 0x9f, 0x98, 0x80]);
    expect(sorted(xs, compareCodePoints)).toEqual(byBytes);
    // UTF-16 の単位の順（JavaScript の既定）では U+1F600 が U+FF21 より前になってしまう
    expect('\u{1F600}' < 'Ａ').toBe(true);
    expect(compareCodePoints('\u{1F600}', 'Ａ')).toBe(1);
  });

  it('前方一致は短いほうが前', () => {
    expect(compareCodePoints('abc', 'abcd')).toBe(-1);
    expect(compareCodePoints('abc', 'abc')).toBe(0);
  });
});

describe('number と bigint の比較', () => {
  it('値の大小で比べる', () => {
    expect(compareNumeric(1, 2n)).toBe(-1);
    expect(compareNumeric(2n, 1.5)).toBe(1);
    expect(compareNumeric(9007199254740993n, 9007199254740992)).toBe(1);
    expect(compareNumeric(3, 3n)).toBe(0);
    expect(compareNumeric(-0.5, -1n)).toBe(1);
    expect(compareNumeric(Infinity, 10n ** 400n)).toBe(1);
  });
});

describe('セマンティック バージョニング（FR-SRT-05）', () => {
  it('0.1.2 < 0.1.11', () => {
    expect(compareSemver('0.1.2', '0.1.11')).toBe(-1);
    expect(compareCodePoints('0.1.2', '0.1.11')).toBe(1);
  });

  it('semver 2.0.0 の例の順', () => {
    // https://semver.org/spec/v2.0.0.html の 11 番の例
    const order = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '2.0.0',
      '2.1.0',
      '2.1.1',
    ];
    const shuffled = [...order].reverse();
    expect(sorted(shuffled, compareSemver)).toEqual(order);
  });

  it('ビルドメタデータは順位に使わない。桁数の多い数字も正しく比べる', () => {
    expect(compareSemver('1.0.0+build.1', '1.0.0+build.2')).toBe(0);
    expect(compareSemver('1.0.99999999999999999999', '1.0.100000000000000000000')).toBe(-1);
  });

  it('semver として読めない文字列は、読める文字列の後にコードポイント順', () => {
    const xs = ['v1.0.0', '1.2', '0.1.11', 'abc', '01.0.0', '0.1.2'];
    expect(sorted(xs, compareSemver)).toEqual(['0.1.2', '0.1.11', '01.0.0', '1.2', 'abc', 'v1.0.0']);
  });

  it('parseSemver', () => {
    expect(parseSemver('1.2.3-rc.1+exp.sha.5114f85')).toEqual({
      major: '1',
      minor: '2',
      patch: '3',
      prerelease: ['rc', '1'],
      build: ['exp', 'sha', '5114f85'],
    });
    expect(parseSemver('1.0.0-01')).toBeNull();
    expect(parseSemver('1.0.0-')).toBeNull();
    expect(parseSemver('1.0.0-x-y-z.--')).not.toBeNull();
    expect(parseSemver(' 1.0.0')).toBeNull();
  });
});

describe('並べ替え用の値の比較', () => {
  it('種類ごとの比較', () => {
    expect(compareSortKeys({ kind: 'number', v: 2 }, { kind: 'number', v: 10 })).toBe(-1);
    expect(compareSortKeys({ kind: 'bigint', v: 10n }, { kind: 'number', v: 2 })).toBe(1);
    expect(compareSortKeys({ kind: 'datetime', ms: 1 }, { kind: 'datetime', ms: 2 })).toBe(-1);
    expect(compareSortKeys({ kind: 'bool', v: false }, { kind: 'bool', v: true })).toBe(-1);
    expect(compareSortKeys({ kind: 'string', v: 'B' }, { kind: 'string', v: 'a' })).toBe(-1);
  });

  it('種類が混ざったときは 数値 → 日時 → 文字列 → 真偽値 → エラー → 空欄', () => {
    const keys: SortKey[] = [
      { kind: 'empty' },
      { kind: 'error', v: '#DIV/0!' },
      { kind: 'bool', v: true },
      { kind: 'string', v: 'a' },
      { kind: 'datetime', ms: 0 },
      { kind: 'number', v: 1 },
    ];
    expect([...keys].sort((a, b) => compareSortKeys(a, b)).map((k) => k.kind)).toEqual([
      'number',
      'datetime',
      'string',
      'bool',
      'error',
      'empty',
    ]);
  });
});

describe('安定な並べ替え（P-20）', () => {
  const values: (string | null)[] = ['b', null, 'a', 'c', '', 'a', null];
  const key = (row: number): SortKey => {
    const v = values[row];
    return v === null ? { kind: 'empty' } : { kind: 'string', v };
  };
  const rows = values.map((_, i) => i);

  it('昇順。空欄（空文字を含む）は末尾、同じ値は元の順', () => {
    expect(sortRows(rows, [{ key, direction: 'asc' }])).toEqual([2, 5, 0, 3, 1, 4, 6]);
  });

  it('降順でも空欄は末尾', () => {
    expect(sortRows(rows, [{ key, direction: 'desc' }])).toEqual([3, 0, 2, 5, 1, 4, 6]);
  });

  it('version 列は semver として並べる', () => {
    const vs = ['0.1.11', '0.1.2', '1.0.0', '1.0.0-beta', 'draft'];
    const k = (r: number): SortKey => ({ kind: 'string', v: vs[r] });
    const order = sortRows([0, 1, 2, 3, 4], [{ key: k, direction: 'asc', semver: true }]);
    expect(order.map((r) => vs[r])).toEqual(['0.1.2', '0.1.11', '1.0.0-beta', '1.0.0', 'draft']);
  });

  it('複数の列で並べる。元の配列は変えない', () => {
    const data = [
      { r: 'SR', hp: 800 },
      { r: 'SSR', hp: 1200 },
      { r: 'SR', hp: 900 },
      { r: 'SSR', hp: 1000 },
    ];
    const input = [0, 1, 2, 3];
    const order = sortRows(input, [
      { key: (i) => ({ kind: 'string', v: data[i].r }), direction: 'asc' },
      { key: (i) => ({ kind: 'number', v: data[i].hp }), direction: 'desc' },
    ]);
    expect(order).toEqual([2, 0, 1, 3]);
    expect(input).toEqual([0, 1, 2, 3]);
  });

  it('1 万行でも並べ替えられる', () => {
    const n = 10000;
    const vals = Array.from({ length: n }, (_, i) => (i * 7919) % n);
    const order = sortRows(
      vals.map((_, i) => i),
      [{ key: (i) => ({ kind: 'number', v: vals[i] }), direction: 'asc' }],
    );
    for (let i = 1; i < n; i++) expect(vals[order[i - 1]] <= vals[order[i]]).toBe(true);
  });
});
