import { describe, expect, it } from 'vitest';
import { formatListText, parseListText } from './listtext';

describe('リストのテキスト（P-16）', () => {
  it('要素を ", " でつなぐ', () => {
    expect(formatListText(['1', '3', '7'])).toBe('1, 3, 7');
    expect(formatListText(['火'])).toBe('火');
    expect(formatListText([])).toBe('');
  });

  it(', や " を含む要素、前後に空白のある要素、空文字の要素は " で囲む', () => {
    expect(formatListText(['a, b', 'c'])).toBe('"a, b", c');
    expect(formatListText(['say "hi"'])).toBe('"say ""hi"""');
    expect(formatListText([' x', 'y '])).toBe('" x", "y "');
    expect(formatListText(['', 'a'])).toBe('"", a');
  });

  it('読み込み: カンマの前後の空白を許す', () => {
    expect(parseListText('1, 3, 7')).toEqual(['1', '3', '7']);
    expect(parseListText('1,3 ,  7')).toEqual(['1', '3', '7']);
    expect(parseListText('"a, b" , c')).toEqual(['a, b', 'c']);
    expect(parseListText('"say ""hi"""')).toEqual(['say "hi"']);
  });

  it('空のテキストは空のリスト', () => {
    expect(parseListText('')).toEqual([]);
    expect(parseListText('   ')).toEqual([]);
  });

  it('空の要素', () => {
    expect(parseListText('a,,b')).toEqual(['a', '', 'b']);
    expect(parseListText('a,')).toEqual(['a', '']);
    expect(parseListText('""')).toEqual(['']);
  });

  it('囲みが正しくない要素の " は文字として扱う', () => {
    expect(parseListText('"ab"c, d')).toEqual(['"ab"c', 'd']);
    expect(parseListText('"open, d')).toEqual(['"open', 'd']);
    expect(parseListText('5" disk, 3')).toEqual(['5" disk', '3']);
  });

  it('往復すると元に戻る', () => {
    const cases: string[][] = [
      [],
      [''],
      ['1', '3', '7'],
      ['a, b', ' c ', 'd"e', '', 'f'],
      ['改行\nを含む', 'タブ\tも'],
      ['"', ',', '""'],
    ];
    for (const items of cases) expect(parseListText(formatListText(items))).toEqual(items);
  });
});
