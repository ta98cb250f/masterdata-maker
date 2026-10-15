import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { RichCell } from '../model/cell';
import { defaultBaseFields } from '../model/defaults';
import type { Table } from '../model/table';
import { emitJson, emitYaml, map, scalar, seq, yamlDoubleQuote, yamlNeedsQuote } from './emit';
import { parseTableFile } from './parse';
import { serializeTable } from './serialize';

const ch = (code: number): string => String.fromCharCode(code);

// YAML 1.1 か 1.2 で文字列以外に読まれうる値、引用符なしでは書けない値
const TRICKY = [
  'NO', 'no', 'No', 'n', 'N', 'y', 'Y', 'yes', 'YES', 'on', 'On', 'OFF', 'off', 'true', 'True', 'FALSE',
  'null', 'Null', 'NULL', '~', '',
  '1.10', '1', '-1', '+1', '.5', '-.5', '1e3', '1_000', '0x1F', '0o17', '0b101', '017', '1:20', '190:20:30',
  '.inf', '-.Inf', '+.INF', '.nan', '.NaN',
  '2026-10-13', '2026-10-13T12:00:00+09:00', '2026-10-13 12:00:00',
  '<<', '=', '#f4cccc', '&a', '*a', '!a', '%a', '@a', '`a', '|', '>', "'a'", '"a"', '[a]', '{a}', '- a', '-', '? a',
  ':a', 'a:', 'a: b', 'a #b', 'a#b', 'x,y', ' a', 'a ', '---', '...',
  `a${ch(10)}b`, `a${ch(9)}b`, `a${ch(13)}b`, `a${ch(0x85)}b`, `a${ch(0x2028)}b`, `a${ch(0x2029)}b`, `${ch(0xfeff)}a`,
  `a${ch(0)}b`, `a${ch(0x7f)}b`, 'a\\b', 'a"b', "a'b", 'http://example.com/a?b=c#d',
  '勇者アルス', 'stage_01', 'hp * (1 + defense / 100)', 'IF(rarity = "SSR", hp * 2, hp)',
];

function tableWith(values: string[]): Table {
  const table = parseTableFile(
    'tables/t.yaml',
    'table: t\nfields:\n  - name: s\n    type: string\n  - name: l\n    type: list<string>\nrecords: []\n',
  );
  if (table.kind !== 'table') throw new Error('読み込みエラー');
  values.forEach((value, i) => {
    table.records.push({
      uid: 100 + i,
      // 未入力にならないよう、空文字はリストの要素と RichCell のメモでだけ試す
      cells: new Map<string, string | string[] | RichCell>([
        ...(value === '' ? [] : [['s', value] as [string, string]]),
        ['l', [value, value]],
      ]),
      // 知らないキーとして同じ文字列をキーにも使う
      extra: value === '' ? [] : [[value, value]],
    });
  });
  table.records.push({ uid: 999, cells: new Map([['s', new RichCell({ value: 'x', comment: 'NO' })]]), extra: [] });
  table.view.column_widths = values.filter((v) => v !== '').map((v, i) => [v, i]);
  return table;
}

describe('DR-41: 文字列の引用', () => {
  const table = tableWith(TRICKY);
  const text = serializeTable(table, defaultBaseFields(), 'yaml');

  for (const version of ['1.1', '1.2'] as const) {
    it(`書き出した YAML を YAML ${version} で読み直しても文字列のまま`, () => {
      const data = parse(text, { version }) as {
        records: Record<string, unknown>[];
        view: { column_widths: Record<string, number> };
      };
      TRICKY.forEach((value, i) => {
        const record = data.records[i];
        if (value !== '') {
          expect(record.s, JSON.stringify(value)).toBe(value);
          expect(record[value], JSON.stringify(value)).toBe(value);
        }
        expect(record.l, JSON.stringify(value)).toEqual([value, value]);
      });
      expect(data.records[TRICKY.length]).toEqual({ s: { value: 'x', comment: 'NO' } });
      // JS のオブジェクトでは整数風のキーが先に並ぶので、集合として比べる
      expect(Object.keys(data.view.column_widths).sort()).toEqual(TRICKY.filter((v) => v !== '').sort());
    });
  }

  it('書き出した YAML を読み込んで書き出すと同じになる', () => {
    const reread = parseTableFile('tables/t.yaml', text);
    expect(reread.kind).toBe('table');
    if (reread.kind !== 'table') return;
    expect(serializeTable(reread, defaultBaseFields(), 'yaml')).toBe(text);
  });

  it('要件書 DR-41 の例', () => {
    const root = map(
      [
        ['code', scalar('NO')],
        ['label', scalar('1.10')],
        ['note', scalar('null')],
        ['start_at', scalar('2026-10-13T12:00:00+09:00', true)],
        ['name', scalar('勇者アルス')],
      ],
      false,
    );
    expect(emitYaml(root)).toBe(
      'code: "NO"\nlabel: "1.10"\nnote: "null"\nstart_at: "2026-10-13T12:00:00+09:00"\nname: 勇者アルス\n',
    );
  });

  it('キーにも同じ規則を当てる（YAML 1.1 ではキー n が false になる）', () => {
    const text2 = emitYaml(map([['n', scalar(1)], ['yes', scalar(2)], ['a', map([['off', scalar(3)]], true)]], false));
    expect(text2).toBe('"n": 1\n"yes": 2\na: { "off": 3 }\n');
    expect(parse(text2, { version: '1.1' })).toEqual({ n: 1, yes: 2, a: { off: 3 } });
  });

  it('datetime の値は常に引用する。誤読の余地が無い値は引用しない', () => {
    expect(emitYaml(map([['a', scalar('abc', true)], ['b', scalar('abc')]], false))).toBe('a: "abc"\nb: abc\n');
  });

  it('フローの中では , [ ] { } : # を含む値を引用する', () => {
    expect(yamlNeedsQuote('a,b', false)).toBe(false);
    expect(yamlNeedsQuote('a,b', true)).toBe(true);
    expect(yamlNeedsQuote('a:b', false)).toBe(false);
    expect(yamlNeedsQuote('a:b', true)).toBe(true);
    expect(yamlNeedsQuote('次回調整予定', true)).toBe(false);
  });

  it('ダブルクォートの中のエスケープ', () => {
    expect(yamlDoubleQuote('a\\b"c\nd\te\rf')).toBe('"a\\\\b\\"c\\nd\\te\\rf"');
    expect(yamlDoubleQuote(`${ch(0)}${ch(0x1b)}${ch(0x7f)}${ch(0x85)}${ch(0x2028)}${ch(0x2029)}${ch(0xfeff)}`)).toBe(
      '"\\u0000\\u001B\\u007F\\u0085\\u2028\\u2029\\uFEFF"',
    );
    expect(yamlDoubleQuote('あ😀')).toBe('"あ😀"');
  });
});

describe('YAML と JSON の書き方', () => {
  const root = map(
    [
      ['a', seq([], false)],
      ['b', map([], false)],
      ['c', seq([scalar(1), scalar(2n)], true)],
      ['d', seq([map([['x', scalar(true)]], false), map([], false), scalar('s')], false)],
      ['e', map([['f', map([['g', scalar(null)]], false)]], false)],
    ],
    false,
  );

  it('YAML: 空のコレクションは [] と {}、ブロックの中のブロック', () => {
    expect(emitYaml(root)).toBe('a: []\nb: {}\nc: [1, 2]\nd:\n  - x: true\n  - {}\n  - s\ne:\n  f:\n    g: null\n');
  });

  it('JSON: ブロックは複数行、フローは 1 行', () => {
    expect(emitJson(root)).toBe(
      '{\n  "a": [],\n  "b": {},\n  "c": [1, 2],\n  "d": [\n    {\n      "x": true\n    },\n    {},\n    "s"\n  ],\n  "e": {\n    "f": {\n      "g": null\n    }\n  }\n}\n',
    );
  });

  it('JSON の文字列は JSON.stringify と同じエスケープ（ASCII 以外はそのまま）', () => {
    const value = `改行\n"引用"\\${ch(1)}${ch(0x2028)}`;
    expect(emitJson(map([['k', scalar(value)]], false))).toBe(`{\n  "k": ${JSON.stringify(value)}\n}\n`);
  });
});
