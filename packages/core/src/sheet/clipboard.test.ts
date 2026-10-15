import { describe, expect, it } from 'vitest';
import { parseTsv, planPaste, toHtmlTable, toTsv } from './clipboard';

describe('TSV の書き出し', () => {
  it('タブ・改行・" を含むセルだけを " で囲み、中の " は "" にする', () => {
    expect(toTsv([['a', 'b c', 'x"y'], ['1\n2', 'tab\there', '']])).toBe('a\tb c\t"x""y"\n"1\n2"\t"tab\there"\t');
  });

  it('末尾に改行を付けない。CR を含むセルも囲む', () => {
    expect(toTsv([['a'], ['b']])).toBe('a\nb');
    expect(toTsv([['a\rb']])).toBe('"a\rb"');
  });
});

describe('TSV の読み込み', () => {
  it('タブと改行で分ける', () => {
    expect(parseTsv('a\tb\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('" で囲まれたセルの中の改行・タブ・"" を扱う', () => {
    expect(parseTsv('"line1\nline2"\t"a\tb"\t"say ""hi"""')).toEqual([['line1\nline2', 'a\tb', 'say "hi"']]);
  });

  it('CRLF と CR の行区切り、末尾の改行（Excel が付ける）', () => {
    expect(parseTsv('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseTsv('a\rb\r')).toEqual([['a'], ['b']]);
    expect(parseTsv('a\n')).toEqual([['a']]);
    // 末尾の改行は 1 つだけ取り除く（2 つ目は空の行）
    expect(parseTsv('a\n\n')).toEqual([['a'], ['']]);
  });

  it('囲まれたセルの中の CRLF と CR は LF にする', () => {
    expect(parseTsv('"a\r\nb"\t"c\rd"\r\n')).toEqual([['a\nb', 'c\nd']]);
  });

  it('囲みが正しくないセルの " は文字としてそのまま扱う', () => {
    expect(parseTsv('"abc"def\tx')).toEqual([['"abc"def', 'x']]);
    expect(parseTsv('"unterminated\tb')).toEqual([['"unterminated', 'b']]);
    expect(parseTsv('ab"c\t"')).toEqual([['ab"c', '"']]);
    expect(parseTsv('5" disk')).toEqual([['5" disk']]);
  });

  it('空のセル・空のテキスト・行ごとに列数が違うとき', () => {
    expect(parseTsv('')).toEqual([['']]);
    expect(parseTsv('\t')).toEqual([['', '']]);
    expect(parseTsv('a\tb\tc\nd')).toEqual([
      ['a', 'b', 'c'],
      ['d', '', ''],
    ]);
    expect(parseTsv('""\tx')).toEqual([['', 'x']]);
  });
});

describe('受け入れ基準 2: セル内改行を含む 3×3 の往復', () => {
  const cells = [
    ['勇者アルス', 'SSR', '1200'],
    ['魔法使い\nリナ', 'SR', '800'],
    ['"引用"', 'タブ\tあり', ''],
  ];

  it('Googleスプレッドシートが書き出す形の TSV を読むと 9 個の値が一致する', () => {
    // Googleスプレッドシートの text/plain（改行を含むセルは " で囲まれる、という一般に知られた形。実物との突き合わせは未検証）
    const fromSheets = '勇者アルス\tSSR\t1200\n"魔法使い\nリナ"\tSR\t800\n"""引用"""\t"タブ\tあり"\t';
    expect(parseTsv(fromSheets)).toEqual(cells);
  });

  it('Excel が書き出す形（CRLF・末尾の改行あり）も読める', () => {
    const fromExcel = '勇者アルス\tSSR\t1200\r\n"魔法使い\nリナ"\tSR\t800\r\n"""引用"""\t"タブ\tあり"\t\r\n';
    expect(parseTsv(fromExcel)).toEqual(cells);
  });

  it('書き出して読み直すと 9 個の値が一致する', () => {
    const tsv = toTsv(cells);
    const back = parseTsv(tsv);
    expect(back).toEqual(cells);
    expect(back.flat()).toHaveLength(9);
  });

  it('HTML の表ではセル内の改行を <br> にする', () => {
    const html = toHtmlTable(cells);
    expect(html).toContain('<td>魔法使い<br>リナ</td>');
    expect(html).toContain('<td>&quot;引用&quot;</td>');
    expect(html).toContain('mso-data-placement:same-cell');
    expect((html.match(/<tr>/g) ?? []).length).toBe(3);
    expect((html.match(/<td>/g) ?? []).length).toBe(9);
  });
});

describe('HTML の表', () => {
  it('& < > をエスケープし、CRLF も <br> にする', () => {
    expect(toHtmlTable([['a<b>&c', 'x\r\ny']])).toContain('<tr><td>a&lt;b&gt;&amp;c</td><td>x<br>y</td></tr>');
  });
});

describe('貼り付けの形の計画', () => {
  it('1 セルを範囲に貼ると範囲全体を埋める（FR-CLP-03）', () => {
    const plan = planPaste({ rows: 1, cols: 1 }, { top: 2, left: 1, bottom: 5, right: 3 });
    expect(plan?.range).toEqual({ top: 2, left: 1, bottom: 5, right: 3 });
    expect(plan?.tiled).toBe(true);
    expect(plan?.sourceOf(4, 2)).toEqual({ row: 0, col: 0 });
  });

  it('貼り付け先がコピー元のちょうど整数倍なら敷き詰める（Googleスプレッドシートでは未検証。Excel と同じ規則）', () => {
    const plan = planPaste({ rows: 2, cols: 1 }, { top: 0, left: 0, bottom: 5, right: 1 });
    expect(plan?.range).toEqual({ top: 0, left: 0, bottom: 5, right: 1 });
    expect(plan?.tiled).toBe(true);
    expect(plan?.sourceOf(0, 0)).toEqual({ row: 0, col: 0 });
    expect(plan?.sourceOf(3, 1)).toEqual({ row: 1, col: 0 });
    expect(plan?.sourceOf(4, 1)).toEqual({ row: 0, col: 0 });
  });

  it('それ以外は貼り付け先の左上からコピー元の大きさで書く', () => {
    // 1 セルを選んで 3×3 を貼る
    const p1 = planPaste({ rows: 3, cols: 3 }, { top: 4, left: 2, bottom: 4, right: 2 });
    expect(p1?.range).toEqual({ top: 4, left: 2, bottom: 6, right: 4 });
    expect(p1?.tiled).toBe(false);
    expect(p1?.sourceOf(6, 3)).toEqual({ row: 2, col: 1 });
    // 整数倍でない範囲
    const p2 = planPaste({ rows: 2, cols: 2 }, { top: 0, left: 0, bottom: 2, right: 3 });
    expect(p2?.range).toEqual({ top: 0, left: 0, bottom: 1, right: 1 });
    // 同じ大きさ
    const p3 = planPaste({ rows: 2, cols: 2 }, { top: 1, left: 1, bottom: 2, right: 2 });
    expect(p3?.range).toEqual({ top: 1, left: 1, bottom: 2, right: 2 });
    expect(p3?.tiled).toBe(false);
  });

  it('コピー元が空なら null', () => {
    expect(planPaste({ rows: 0, cols: 3 }, { top: 0, left: 0, bottom: 0, right: 0 })).toBeNull();
  });
});
