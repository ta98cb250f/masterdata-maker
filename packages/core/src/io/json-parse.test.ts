import { describe, expect, it } from 'vitest';
import { IoCode } from './codes';
import { parseJson } from './json-parse';

function firstError(text: string) {
  const result = parseJson(text);
  expect(result.node).toBeNull();
  return result.diagnostics[0];
}

describe('JSON の厳密なパーサー（DR-50）', () => {
  it('値・位置・数値の元の表記を読む。整数は BigInt', () => {
    const result = parseJson('{\n  "a": [1, -2.50, 1e3, 9007199254740993],\n  "b": "x\\n\\u3042\\/",\n  "c": [true, false, null]\n}');
    expect(result.diagnostics).toEqual([]);
    const root = result.node;
    expect(root?.kind).toBe('map');
    if (root?.kind !== 'map') return;
    expect(root.entries.map((e) => [e.key, e.keyPos])).toEqual([
      ['a', { line: 2, column: 3 }],
      ['b', { line: 3, column: 3 }],
      ['c', { line: 4, column: 3 }],
    ]);
    const a = root.entries[0].value;
    expect(a.kind === 'seq' && a.items.map((i) => (i.kind === 'scalar' ? [i.value, i.source] : null))).toEqual([
      [1n, '1'],
      [-2.5, '-2.50'],
      [1000, '1e3'],
      [9007199254740993n, '9007199254740993'],
    ]);
    const b = root.entries[1].value;
    expect(b.kind === 'scalar' && b.value).toBe('x\nあ/');
    const c = root.entries[2].value;
    expect(c.kind === 'seq' && c.items.map((i) => i.kind === 'scalar' && i.value)).toEqual([true, false, null]);
  });

  it('CRLF の改行を受け付ける', () => {
    const result = parseJson('{\r\n  "a": 1\r\n}\r\n');
    expect(result.node?.kind).toBe('map');
    expect(result.diagnostics).toEqual([]);
  });

  it('コメントを拒否する', () => {
    expect(firstError('{\n  // c\n  "a": 1\n}')).toMatchObject({ code: IoCode.jsonComment, line: 2, column: 3 });
    expect(firstError('{ "a": 1 /* c */ }')).toMatchObject({ code: IoCode.jsonComment });
    expect(firstError('{ "a": 1 }\n// c')).toMatchObject({ code: IoCode.jsonComment, line: 2, column: 1 });
  });

  it('末尾のカンマを拒否する', () => {
    expect(firstError('[1, 2, ]')).toMatchObject({ code: IoCode.jsonTrailingComma, line: 1, column: 8 });
    expect(firstError('{ "a": 1, }')).toMatchObject({ code: IoCode.jsonTrailingComma });
  });

  it('重複キーを拒否する（位置は 2 つ目のキー）', () => {
    const result = parseJson('{\n  "a": 1,\n  "a": 2\n}');
    expect(result.node).toBeNull();
    expect(result.diagnostics).toEqual([
      { severity: 'error', code: IoCode.duplicateKey, params: { key: 'a' }, line: 3, column: 3 },
    ]);
  });

  it('同じキーを持つオブジェクトが続いても、重複キーとエスケープしたキーを正しく扱う', () => {
    const result = parseJson('[{ "a": 1, "b": 2 }, { "a": 1, "a": 2 }, { "\\u0061": 1, "a": 2 }, { "ab": 1, "a": 2, "b": 3 }]');
    expect(result.node).toBeNull();
    expect(result.diagnostics).toEqual([
      { severity: 'error', code: IoCode.duplicateKey, params: { key: 'a' }, line: 1, column: 32 },
      { severity: 'error', code: IoCode.duplicateKey, params: { key: 'a' }, line: 1, column: 57 },
    ]);
    const ok = parseJson('[{ "a": 1, "b": 2 }, { "a": 1, "c": 3 }, { "b": 1, "a\\"": 2, "a": 3 }]');
    expect(ok.diagnostics).toEqual([]);
    const items = ok.node?.kind === 'seq' ? ok.node.items : [];
    expect(items.map((item) => (item.kind === 'map' ? item.entries.map((e) => e.key) : []))).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'a"', 'a'],
    ]);
  });

  it('単引用符・引用符なしのキー・NaN・Infinity を拒否する', () => {
    expect(firstError("{ 'a': 1 }")).toMatchObject({ code: IoCode.jsonSingleQuote });
    expect(firstError("['a']")).toMatchObject({ code: IoCode.jsonSingleQuote });
    expect(firstError('{ a: 1 }')).toMatchObject({ code: IoCode.jsonUnquotedKey, params: { text: 'a' } });
    expect(firstError('[NaN]')).toMatchObject({ code: IoCode.jsonInvalidLiteral, params: { text: 'NaN' } });
    expect(firstError('[Infinity]')).toMatchObject({ code: IoCode.jsonInvalidLiteral, params: { text: 'Infinity' } });
    expect(firstError('[-Infinity]')).toMatchObject({ code: IoCode.jsonInvalidNumber, params: { text: '-Infinity' } });
    expect(firstError('[undefined]')).toMatchObject({ code: IoCode.jsonInvalidLiteral });
    expect(firstError('[True]')).toMatchObject({ code: IoCode.jsonInvalidLiteral, params: { text: 'True' } });
  });

  it('RFC 8259 にない数値の書き方を拒否する', () => {
    for (const text of ['01', '+1', '.5', '1.', '0x1F', '1e', '1_000', '- 1']) {
      expect(firstError(`[${text}]`)).toMatchObject({ code: IoCode.jsonInvalidNumber });
    }
  });

  it('文字列の中の制御文字と不正なエスケープを拒否する', () => {
    expect(firstError('["a\tb"]')).toMatchObject({ code: IoCode.jsonControlChar, column: 4 });
    expect(firstError('["a\nb"]')).toMatchObject({ code: IoCode.jsonControlChar });
    expect(firstError('["\\x41"]')).toMatchObject({ code: IoCode.jsonInvalidEscape, params: { text: '\\x' } });
    expect(firstError('["\\u12"]')).toMatchObject({ code: IoCode.jsonInvalidEscape });
  });

  it('途中で終わるファイル・余分な内容・空のファイルを拒否する', () => {
    expect(firstError('{ "a": [1, 2')).toMatchObject({ code: IoCode.jsonUnexpectedEnd });
    expect(firstError('"abc')).toMatchObject({ code: IoCode.jsonUnexpectedEnd });
    expect(firstError('')).toMatchObject({ code: IoCode.jsonUnexpectedEnd, line: 1, column: 1 });
    expect(firstError('{} {}')).toMatchObject({ code: IoCode.jsonTrailingContent, column: 4 });
    expect(firstError('{ "a" 1 }')).toMatchObject({ code: IoCode.jsonUnexpectedChar, params: { char: '1' } });
    expect(firstError('[1 2]')).toMatchObject({ code: IoCode.jsonUnexpectedChar });
  });

  it('JSON の空白以外の空白文字（全角スペースなど）を拒否する', () => {
    expect(firstError(`[1,${String.fromCharCode(0x3000)}2]`)).toMatchObject({ code: IoCode.jsonUnexpectedChar });
  });

  it('対になっていないサロゲートのエスケープは受け付ける（RFC 8259 の構文上は正しい）', () => {
    const result = parseJson('["\\ud800"]');
    expect(result.diagnostics).toEqual([]);
  });
});
