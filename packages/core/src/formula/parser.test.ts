import { describe, expect, test } from 'vitest';
import { tokenize } from './lexer';
import { ParseCache, parseFormula } from './parser';
import type { Node } from './ast';
import type { FormulaError } from './values';

function ast(text: string): Node {
  const r = parseFormula(text);
  if (!r.ok) throw new Error(`parse failed: ${r.error.messageCode}`);
  return r.ast;
}

function syntaxError(text: string): FormulaError {
  const r = parseFormula(text);
  if (r.ok) throw new Error('expected a syntax error');
  return r.error;
}

/** 構文木を括弧付きの文字列にする（優先順位の確認用） */
function show(n: Node): string {
  switch (n.type) {
    case 'number':
      return String(n.value);
    case 'string':
      return JSON.stringify(n.value);
    case 'boolean':
      return n.value ? 'TRUE' : 'FALSE';
    case 'column':
      return n.name;
    case 'blank':
      return '_';
    case 'group':
      return show(n.expr);
    case 'unary':
      return `(${n.op}${show(n.operand)})`;
    case 'percent':
      return `(${show(n.operand)}%)`;
    case 'binary':
      return `(${show(n.left)} ${n.op} ${show(n.right)})`;
    case 'call':
      return `${n.name}(${n.args.map(show).join(', ')})`;
  }
}

describe('字句解析', () => {
  test('数値の表記', () => {
    const r = tokenize('1 1.5 .5 1e3 1E-3 1.');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tokens.filter((t) => t.type === 'number').map((t) => t.value)).toEqual([1, 1.5, 0.5, 1000, 0.001, 1]);
  });

  test('文字列の "" は " になる', () => {
    const r = tokenize('"a""b" ""');
    expect(r.ok && r.tokens.map((t) => t.value)).toEqual(['a"b', '', undefined]);
  });

  test('演算子と位置', () => {
    const r = tokenize('a<>b <= c>=d');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tokens.map((t) => [t.type, t.text, t.start, t.end])).toEqual([
      ['ident', 'a', 0, 1],
      ['op', '<>', 1, 3],
      ['ident', 'b', 3, 4],
      ['op', '<=', 5, 7],
      ['ident', 'c', 8, 9],
      ['op', '>=', 9, 11],
      ['ident', 'd', 11, 12],
      ['eof', '', 12, 12],
    ]);
  });
});

describe('構文解析', () => {
  test('先頭の = を取り除き、位置は = を除いたテキストの中で数える', () => {
    const r = parseFormula('=hp * 2');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe('hp * 2');
    expect(r.ast).toMatchObject({ type: 'binary', op: '*', start: 0, end: 6 });
    expect(parseFormula('hp * 2')).toMatchObject({ ok: true, source: 'hp * 2' });
  });

  test('演算子の優先順位（Excel の公式ヘルプの順序。Googleスプレッドシートでは第三者の報告で -2^2 = 4 を確認）', () => {
    expect(show(ast('-2^2'))).toBe('((-2) ^ 2)');
    expect(show(ast('2^-1'))).toBe('(2 ^ (-1))');
    expect(show(ast('1+2&3'))).toBe('((1 + 2) & 3)');
    expect(show(ast('2^3^2'))).toBe('((2 ^ 3) ^ 2)');
    expect(show(ast('1+2*3'))).toBe('(1 + (2 * 3))');
    expect(show(ast('(1+2)*3'))).toBe('((1 + 2) * 3)');
    expect(show(ast('10-2-3'))).toBe('((10 - 2) - 3)');
    expect(show(ast('1+1=2'))).toBe('((1 + 1) = 2)');
    expect(show(ast('"a"&"b"="ab"'))).toBe('(("a" & "b") = "ab")');
    expect(show(ast('2^3%'))).toBe('(2 ^ (3%))');
    expect(show(ast('-50%'))).toBe('((-50)%)');
    expect(show(ast('2*50%%'))).toBe('(2 * ((50%)%))');
    expect(show(ast('1<2<3'))).toBe('((1 < 2) < 3)');
    expect(show(ast('a<>b'))).toBe('(a <> b)');
    expect(show(ast('--1'))).toBe('(-(-1))');
  });

  test('関数呼び出し（名前は大文字と小文字を区別しない）と列の参照（小文字にする）', () => {
    expect(show(ast('sum(HP, Defense)'))).toBe('SUM(hp, defense)');
    expect(show(ast('Round(hp * (1 + defense / 100))'))).toBe('ROUND((hp * (1 + (defense / 100))))');
    expect(show(ast('NOW()'))).toBe('NOW()');
    expect(show(ast('SUM (1)'))).toBe('SUM(1)');
  });

  test('TRUE / FALSE は大文字と小文字を区別しない真偽値。直後が ( なら関数', () => {
    expect(ast('true')).toMatchObject({ type: 'boolean', value: true });
    expect(ast('False')).toMatchObject({ type: 'boolean', value: false });
    expect(ast('TRUE()')).toMatchObject({ type: 'call', name: 'TRUE', args: [] });
  });

  test('省略された引数', () => {
    expect(show(ast('IF(x,,1)'))).toBe('IF(x, _, 1)');
    expect(show(ast('F(,)'))).toBe('F(_, _)');
    expect(show(ast('F(1,)'))).toBe('F(1, _)');
  });

  test('ノードの位置', () => {
    const n = ast('IF(rarity = "SSR", hp * 2, hp)');
    expect(n).toMatchObject({ type: 'call', start: 0, end: 30, nameStart: 0, nameEnd: 2 });
    if (n.type !== 'call') return;
    expect(n.args.map((a) => [a.start, a.end])).toEqual([
      [3, 17],
      [19, 25],
      [27, 29],
    ]);
  });

  test('空白と改行は無視する', () => {
    expect(show(ast(' 1 +\n\t2 '))).toBe('(1 + 2)');
  });
});

describe('構文エラー（#ERROR!。位置付き。P-35）', () => {
  test('空の式', () => {
    expect(syntaxError('')).toMatchObject({ code: '#ERROR!', messageCode: 'formula.syntax.empty' });
    expect(syntaxError('=')).toMatchObject({ code: '#ERROR!', messageCode: 'formula.syntax.empty' });
    expect(syntaxError('=  ')).toMatchObject({ messageCode: 'formula.syntax.empty' });
  });

  test('途中で終わる式', () => {
    expect(syntaxError('1+')).toMatchObject({
      code: '#ERROR!',
      messageCode: 'formula.syntax.unexpectedEnd',
      messageArgs: { position: 2 },
      start: 2,
      end: 2,
    });
  });

  test('予期しないトークン（位置は 1 始まりで示す）', () => {
    const e = syntaxError('1 + * 2');
    expect(e).toMatchObject({
      messageCode: 'formula.syntax.unexpectedToken',
      messageArgs: { token: '*', position: 5 },
      start: 4,
      end: 5,
    });
    expect(e.position).toBe(5);
    expect(syntaxError('1 2')).toMatchObject({ messageArgs: { token: '2', position: 3 } });
    expect(syntaxError(')')).toMatchObject({ messageArgs: { token: ')', position: 1 } });
    expect(syntaxError('()')).toMatchObject({ messageArgs: { token: ')', position: 2 } });
    expect(syntaxError('2hp')).toMatchObject({ messageArgs: { token: 'hp', position: 2 } });
    expect(syntaxError('SUM(1 2)')).toMatchObject({ messageArgs: { token: '2', position: 7 } });
    expect(syntaxError('1e')).toMatchObject({ messageArgs: { token: 'e', position: 2 } });
  });

  test('閉じていない文字列', () => {
    expect(syntaxError('"abc')).toMatchObject({
      messageCode: 'formula.syntax.unterminatedString',
      messageArgs: { position: 1 },
      start: 0,
      end: 4,
    });
    expect(syntaxError('1 & "a""')).toMatchObject({ messageArgs: { position: 5 } });
  });

  test('閉じていない括弧', () => {
    expect(syntaxError('SUM(1, 2')).toMatchObject({
      messageCode: 'formula.syntax.missingCloseParen',
      messageArgs: { position: 4 },
    });
    expect(syntaxError('(1')).toMatchObject({ messageCode: 'formula.syntax.missingCloseParen' });
    expect(syntaxError('(')).toMatchObject({ messageCode: 'formula.syntax.missingCloseParen' });
    expect(syntaxError('IF(1,')).toMatchObject({ messageCode: 'formula.syntax.missingCloseParen' });
  });

  test('使えない文字', () => {
    expect(syntaxError('1 $ 2')).toMatchObject({
      messageCode: 'formula.syntax.unexpectedChar',
      messageArgs: { char: '$', position: 3 },
      start: 2,
      end: 3,
    });
    expect(syntaxError('A1:B2')).toMatchObject({ messageArgs: { char: ':', position: 3 } });
    expect(syntaxError('名前')).toMatchObject({ messageArgs: { char: '名', position: 1 } });
    expect(syntaxError('1+😀')).toMatchObject({ messageArgs: { char: '😀', position: 3 }, start: 2, end: 4 });
  });

  test('入れ子が深すぎる式', () => {
    expect(syntaxError(`${'('.repeat(500)}1${')'.repeat(500)}`)).toMatchObject({
      messageCode: 'formula.syntax.tooDeep',
    });
    expect(parseFormula(`${'('.repeat(100)}1${')'.repeat(100)}`).ok).toBe(true);
  });
});

describe('ParseCache', () => {
  test('同じテキストの解析結果を再利用する', () => {
    const cache = new ParseCache(2);
    const a = cache.get('=1+2');
    expect(cache.get('=1+2')).toBe(a);
    cache.get('b');
    cache.get('c');
    expect(cache.get('=1+2')).not.toBe(a);
  });
});
