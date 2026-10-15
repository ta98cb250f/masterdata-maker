import { describe, expect, it } from 'vitest';
import { createMatcher, defaultFindOptions } from './find';
import type { FindOptions, TextMatcher } from './find';

function matcher(options: Partial<FindOptions> & { query: string }): TextMatcher {
  const r = createMatcher({ ...defaultFindOptions(), ...options });
  if (!r.ok) throw new Error(r.error.code);
  return r.matcher;
}

describe('検索', () => {
  it('既定は大文字と小文字を区別せず、部分一致', () => {
    const m = matcher({ query: 'fire' });
    expect(m.test('Fire Ball')).toBe(true);
    expect(m.test('FIRE')).toBe(true);
    expect(m.test('fir')).toBe(false);
    expect(defaultFindOptions('x')).toEqual({
      query: 'x',
      matchCase: false,
      entireCell: false,
      regex: false,
      searchFormulas: false,
    });
  });

  it('大文字と小文字を区別する', () => {
    const m = matcher({ query: 'Fire', matchCase: true });
    expect(m.test('Fire Ball')).toBe(true);
    expect(m.test('fire ball')).toBe(false);
  });

  it('セル全体の一致', () => {
    const m = matcher({ query: 'SR', entireCell: true });
    expect(m.test('SR')).toBe(true);
    expect(m.test('sr')).toBe(true);
    expect(m.test('SSR')).toBe(false);
    expect(m.test('SR\n')).toBe(false);
  });

  it('正規表現でないときは記号を文字として扱う', () => {
    const m = matcher({ query: 'a.b(1)' });
    expect(m.test('xa.b(1)y')).toBe(true);
    expect(m.test('axb(1)')).toBe(false);
  });

  it('正規表現（RE2 構文）', () => {
    const m = matcher({ query: '^stage_\\d{2}$', regex: true });
    expect(m.test('stage_01')).toBe(true);
    expect(m.test('STAGE_01')).toBe(true);
    expect(m.test('stage_1')).toBe(false);
    const whole = matcher({ query: 'a|ab', regex: true, entireCell: true });
    expect(whole.test('ab')).toBe(true);
  });

  it('サロゲートペアと日本語', () => {
    expect(matcher({ query: '😀' }).test('a😀b')).toBe(true);
    expect(matcher({ query: 'アルス' }).test('勇者アルス')).toBe(true);
  });

  it('一致する部分の数', () => {
    expect(matcher({ query: 'a' }).countMatches('AbaA')).toBe(3);
    expect(matcher({ query: 'x' }).countMatches('abc')).toBe(0);
  });
});

describe('エラー', () => {
  it('正規表現の構文エラーは文言コード付きのエラー', () => {
    const r = createMatcher({ ...defaultFindOptions('(abc'), regex: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('sheet.find.error.invalidRegex');
      expect(r.error.params.detail).toContain('missing closing )');
    }
  });

  it('RE2 で使えない構文（先読み）もエラー', () => {
    const r = createMatcher({ ...defaultFindOptions('a(?=b)'), regex: true });
    expect(r.ok ? null : r.error.code).toBe('sheet.find.error.invalidRegex');
  });

  it('正規表現でなければ同じ文字列でもエラーにならない', () => {
    expect(createMatcher(defaultFindOptions('(abc')).ok).toBe(true);
  });

  it('検索語が空ならエラー', () => {
    const r = createMatcher(defaultFindOptions(''));
    expect(r.ok ? null : r.error.code).toBe('sheet.find.error.emptyQuery');
  });
});

describe('置換', () => {
  it('セルの中の一致をすべて置き換える。一致が無ければそのまま', () => {
    const m = matcher({ query: 'hp' });
    expect(m.replace('hp * 2 + HP', 'atk')).toBe('atk * 2 + atk');
    expect(m.replace('def', 'atk')).toBe('def');
  });

  it('正規表現でなければ置換の文字列をそのまま使う', () => {
    expect(matcher({ query: 'a' }).replace('a-a', '$1$$&')).toBe('$1$$&-$1$$&');
  });

  it('正規表現では $1 などのグループ参照を使える', () => {
    const m = matcher({ query: '(\\w+)_(\\d+)', regex: true });
    expect(m.replace('stage_01, boss_2', '$2-$1')).toBe('01-stage, 2-boss');
    expect(m.replace('stage_01', '[$0]')).toBe('[stage_01]');
    expect(m.replace('stage_01', '[$&]')).toBe('[stage_01]');
    expect(m.replace('stage_01', '$$1')).toBe('$1');
    // 無いグループの番号は文字のまま
    expect(m.replace('stage_01', '$3')).toBe('$3');
    expect(m.replace('stage_01', 'cost$')).toBe('cost$');
  });

  it('2 桁のグループ番号と名前付きグループ', () => {
    const m = matcher({ query: '(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)', regex: true });
    expect(m.replace('abcdefghijk', '$11|$10|$1')).toBe('k|j|a');
    const one = matcher({ query: '(a)', regex: true });
    expect(one.replace('a', '$10')).toBe('a0');
    const named = matcher({ query: '(?P<key>\\w+)=(?P<val>\\d+)', regex: true });
    expect(named.replace('hp=10', '$<val>:$<key>')).toBe('10:hp');
    expect(named.replace('hp=10', '$<nope>')).toBe('$<nope>');
  });

  it('一致しなかったグループは空文字', () => {
    const m = matcher({ query: '(a)|(b)', regex: true });
    expect(m.replace('b', '[$1][$2]')).toBe('[][b]');
  });

  it('大文字と小文字を区別しない置換と、セル全体の一致での置換', () => {
    expect(matcher({ query: 'ssr' }).replace('SSR / ssr', 'UR')).toBe('UR / UR');
    const whole = matcher({ query: 'SR', entireCell: true });
    expect(whole.replace('SR', 'R')).toBe('R');
    expect(whole.replace('SSR', 'R')).toBe('SSR');
  });
});
