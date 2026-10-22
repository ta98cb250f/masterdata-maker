import { describe, expect, it } from 'vitest';
import type { Cell, ExtraValue, RawValue } from '../model/cell';
import { RichCell } from '../model/cell';
import { defaultBaseFields } from '../model/defaults';
import type { FieldAnomaly, FieldDef, FieldType, FieldValidation } from '../model/field';
import { elementType, FIELD_TYPES, isListType } from '../model/field';
import type { Table, TableRecord } from '../model/table';
import { UidAllocator } from '../model/uid';
import { decodeBaseFields, decodeColors, decodeEnums, decodeProjectConfig } from './decode-config';
import { decodeTable } from './decode-table';
import { loadProject, planProjectWrite } from './project';
import { serializeTable } from './serialize';
import { createNodeProjectFs, readTree, repoRoot } from './testing-node-fs';
import type { ParseResult } from './tree';
import { Reporter } from './tree';
import { parseCanonicalYaml } from './yaml-fast';
import { parseYaml, parseYamlWithLibrary } from './yaml-parse';

// 正規形の YAML の専用の処理（yaml-fast.ts）を、yaml ライブラリの経路と突き合わせる

type Parse = (text: string, reporter: Reporter) => ParseResult;

function label(text: string): string {
  return JSON.stringify(text.length > 300 ? `${text.slice(0, 300)}…` : text);
}

/**
 * parseYaml（専用の処理を先に試す）の結果が yaml ライブラリの経路と完全に一致することを確かめる。
 * 専用の処理が受け付けたら、その構文木が一致し、ライブラリの経路でも診断が無いことも確かめる
 */
function compare(text: string): boolean {
  const lib = parseYamlWithLibrary(text, new Reporter());
  expect(parseYaml(text, new Reporter()), label(text)).toStrictEqual(lib);
  const fast = parseCanonicalYaml(text);
  if (fast === null) return false;
  expect(lib.diagnostics, label(text)).toStrictEqual([]);
  expect(fast, label(text)).toStrictEqual(lib.node);
  return true;
}

/** ファイルを読んで解釈した結果（モデルと診断） */
function decodeFile(parse: Parse, path: string, text: string): unknown {
  const reporter = new Reporter([], { file: path });
  const node = parse(text, reporter).node;
  const name = path.slice(path.lastIndexOf('/') + 1);
  let value: unknown;
  if (name === 'masterdata-maker.yaml') value = decodeProjectConfig(node, reporter, { path, format: 'yaml', text });
  else if (name === 'enums.yaml') value = decodeEnums(node, reporter);
  else if (name === 'base_fields.yaml') value = decodeBaseFields(node, reporter);
  else if (name === 'colors.yaml') value = decodeColors(node, reporter);
  else {
    value = decodeTable(node, reporter, {
      baseFields: defaultBaseFields(),
      uids: new UidAllocator(),
      source: { path, format: 'yaml', text },
      fallbackName: 't',
    });
  }
  return { value, diagnostics: reporter.items };
}

/** 専用の処理が受け付け、構文木も解釈の結果（モデル・診断）もライブラリの経路と一致する */
function expectSameAsLibrary(path: string, text: string): void {
  expect(compare(text), `${path}: 専用の処理が辞退した ${label(text)}`).toBe(true);
  expect(decodeFile(parseYaml, path, text), path).toStrictEqual(decodeFile(parseYamlWithLibrary, path, text));
}

/** 正規形でない入力: 専用の処理が辞退し、結果はライブラリの経路と同じ */
function expectDeclined(text: string): void {
  expect(parseCanonicalYaml(text), label(text)).toBeNull();
  expect(parseYaml(text, new Reporter()), label(text)).toStrictEqual(parseYamlWithLibrary(text, new Reporter()));
}

// ---- 乱数で作るテーブル ----

/** 再現できる乱数（mulberry32） */
class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}

// 文字列の材料: 引用が要るもの、YAML 1.1 / 1.2 で別の型に読まれるもの、改行・制御文字・サロゲートなど
const FRAGMENTS = [
  'a',
  'Z',
  'name',
  'x y',
  ' ',
  '  ',
  '0',
  '7',
  '1.10',
  '-',
  '+',
  '.',
  '...',
  '---',
  '?',
  ':',
  ': ',
  ' :',
  '#',
  ' #',
  ',',
  ', ',
  '[',
  ']',
  '{',
  '}',
  '&',
  '*',
  '!',
  '|',
  '>',
  "'",
  '"',
  '%',
  '@',
  '`',
  '\\',
  '~',
  '=',
  '<<',
  '(',
  'null',
  'Null',
  'NULL',
  'true',
  'False',
  'yes',
  'NO',
  'on',
  'y',
  '.inf',
  '-.inf',
  '.NaN',
  '0x1F',
  '0o17',
  '1e3',
  '1_000',
  '2026-10-13',
  '12:30',
  '\n',
  '\t',
  '\r',
  '\r\n',
  '\u0000',
  '\u0001',
  '\u001b',
  '\u001f',
  '\u007f',
  '\u0085',
  '\u009f',
  '\u00a0',
  '\u2028',
  '\u2029',
  '\ufeff',
  '\ufffe',
  '\uffff',
  '\ud800',
  '\udc00',
  '\ud83d\ude00',
  '勇者アルス',
  '：',
  '\u3000',
  'é',
];

function randomString(rand: Random, max = 6): string {
  const n = rand.int(max + 1);
  let s = '';
  for (let i = 0; i < n; i++) s += rand.pick(FRAGMENTS);
  return s;
}

function uniqueStrings(rand: Random, count: number, avoid: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const seen = new Set(avoid);
  for (let tries = 0; out.length < count && tries < count * 10; tries++) {
    const s = rand.chance(0.5) ? `k${rand.int(1000)}` : randomString(rand, 4);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function randomInt(rand: Random): number {
  return rand.pick([0, 1, -1, 42, 1200, MAX_SAFE, -MAX_SAFE, rand.int(2_000_000) - 1_000_000]);
}

function randomFloat(rand: Random): number {
  return rand.pick([
    0.5,
    -0.25,
    1e21,
    1e-7,
    -1.5e-10,
    123.456,
    0.1 + 0.2,
    5e-324,
    1.7976931348623157e308,
    -0,
    rand.next() * 1000,
  ]);
}

function randomBigInt(rand: Random): bigint {
  return rand.pick([9223372036854775807n, -9223372036854775808n, 2n ** 70n, BigInt(MAX_SAFE) + 2n, 0n, -5n]);
}

function scalarValue(rand: Random, type: FieldType): RawValue {
  // 型に合わない値も混ぜる（読み込みでは捨てずに保持する）
  if (rand.chance(0.1)) {
    return rand.pick<() => RawValue>([
      () => randomString(rand),
      () => randomInt(rand),
      () => randomFloat(rand),
      () => randomBigInt(rand),
      () => rand.chance(0.5),
    ])();
  }
  switch (elementType(type)) {
    case 'int':
      return randomInt(rand);
    case 'int64':
      return rand.chance(0.5) ? randomBigInt(rand) : randomInt(rand);
    case 'float':
      return randomFloat(rand);
    case 'bool':
      return rand.chance(0.5);
    case 'datetime':
      return rand.chance(0.7) ? '2026-10-13T12:00:00+09:00' : randomString(rand);
    default:
      return rand.chance(0.3) ? rand.pick(['N', 'R', 'SR', 'SSR', '火']) : randomString(rand);
  }
}

function randomValue(rand: Random, type: FieldType, depth = 0): RawValue {
  if (isListType(type) || (depth === 0 && rand.chance(0.05))) {
    const items: RawValue[] = [];
    const n = rand.int(5);
    for (let i = 0; i < n; i++) {
      items.push(depth < 2 && rand.chance(0.05) ? randomValue(rand, type, depth + 1) : scalarValue(rand, type));
    }
    return items;
  }
  return scalarValue(rand, type);
}

function randomExtra(rand: Random, depth = 0): ExtraValue {
  const kind = rand.int(depth < 2 ? 8 : 6);
  switch (kind) {
    case 0:
      return null;
    case 1:
      return rand.chance(0.5);
    case 2:
      return rand.chance(0.5) ? randomInt(rand) : randomFloat(rand);
    case 3:
      return randomBigInt(rand);
    case 4:
    case 5:
      return randomString(rand);
    case 6: {
      const items: ExtraValue[] = [];
      const n = rand.int(4);
      for (let i = 0; i < n; i++) items.push(randomExtra(rand, depth + 1));
      return items;
    }
    default: {
      const map = new Map<string, ExtraValue>();
      for (const key of uniqueStrings(rand, rand.int(4), new Set())) map.set(key, randomExtra(rand, depth + 1));
      return map;
    }
  }
}

function randomCell(rand: Random, type: FieldType): Cell {
  if (!rand.chance(0.15)) return randomValue(rand, type);
  const cell = new RichCell();
  if (rand.chance(0.7)) cell.value = randomValue(rand, type);
  if (rand.chance(0.3)) cell.override = rand.chance(0.5) ? 'hp * 2' : randomString(rand);
  if (rand.chance(0.4)) cell.color = rand.pick(['red', 'blue', '#f4cccc', randomString(rand)]);
  if (rand.chance(0.4)) cell.comment = randomString(rand);
  if (rand.chance(0.1)) {
    const keys = uniqueStrings(rand, 1 + rand.int(2), new Set(['value', 'override', 'color', 'comment']));
    cell.extra = keys.map((key) => [key, randomExtra(rand)]);
  }
  return cell;
}

function randomBound(rand: Random, type: FieldType): number | bigint | string {
  const t = elementType(type);
  if (t === 'datetime' || rand.chance(0.1)) return rand.chance(0.5) ? '2026-01-01T00:00:00+09:00' : randomString(rand);
  if (t === 'int64' && rand.chance(0.5)) return randomBigInt(rand);
  return rand.chance(0.5) ? randomInt(rand) : randomFloat(rand);
}

function randomField(rand: Random, name: string): FieldDef {
  const type = rand.pick(FIELD_TYPES);
  const field: FieldDef = { name, type };
  if (rand.chance(0.5)) field.display_name = randomString(rand);
  if (rand.chance(0.2)) field.description = randomString(rand);
  if (rand.chance(0.1)) field.export = rand.chance(0.5);
  if (rand.chance(0.1)) field.editable = rand.chance(0.5);
  if (rand.chance(0.05)) field.primary = rand.chance(0.5);
  if (rand.chance(0.05)) field.auto = 'increment';
  if (rand.chance(0.2)) field.enum_ref = rand.pick(['rarity', randomString(rand)]);
  if (rand.chance(0.1)) field.ref = rand.pick(['skill.id', randomString(rand)]);
  if (rand.chance(0.15)) field.formula = rand.pick(['hp * (1 + defense / 100)', 'IF(rarity = "SSR", hp * 2, hp)', randomString(rand)]);
  if (rand.chance(0.2)) field.default = rand.chance(0.1) ? rand.pick<RawValue>(['', []]) : randomValue(rand, type);
  if (rand.chance(0.3)) {
    const v: FieldValidation = {};
    if (rand.chance(0.5)) v.required = rand.chance(0.5);
    if (rand.chance(0.4)) v.min = randomBound(rand, type);
    if (rand.chance(0.4)) v.max = randomBound(rand, type);
    if (rand.chance(0.3)) v.max_length = rand.int(100);
    if (rand.chance(0.3)) v.max_items = rand.int(10);
    if (rand.chance(0.3)) v.regex = rand.pick(['^[A-Za-z0-9.]+$', '\\d+', randomString(rand)]);
    if (rand.chance(0.3)) v.unique = rand.chance(0.5);
    field.validation = v;
  }
  if (rand.chance(0.2)) {
    const a: FieldAnomaly = {};
    if (rand.chance(0.5)) a.warn_above = rand.chance(0.3) ? randomBigInt(rand) : randomInt(rand);
    if (rand.chance(0.5)) a.warn_below = randomFloat(rand);
    if (rand.chance(0.5)) a.warn_deviation = randomFloat(rand);
    field.anomaly = a;
  }
  return field;
}

function randomTable(seed: number): Table {
  const rand = new Random(seed);
  const baseFields = defaultBaseFields();
  const reserved = new Set(baseFields.map((f) => f.name));
  const fieldCount = rand.int(9);
  const names =
    rand.chance(0.3)
      ? uniqueStrings(rand, fieldCount, reserved)
      : Array.from({ length: fieldCount }, (_, i) => `f${i}`);
  const fields = names.map((name) => randomField(rand, name));
  const columns = [...baseFields, ...fields];
  const records: TableRecord[] = [];
  const recordCount = rand.int(25);
  for (let r = 0; r < recordCount; r++) {
    const cells = new Map<string, Cell>();
    if (!rand.chance(0.1)) {
      for (const column of columns) {
        if (rand.chance(0.7)) cells.set(column.name, randomCell(rand, column.type));
      }
    }
    const extraKeys = rand.chance(0.1) ? uniqueStrings(rand, 1 + rand.int(2), new Set(columns.map((c) => c.name))) : [];
    records.push({ uid: r + 1, cells, extra: extraKeys.map((key) => [key, randomExtra(rand)]) });
  }
  const table: Table = {
    kind: 'table',
    uid: 0,
    name: rand.chance(0.8) ? `table_${seed}` : randomString(rand) || 't',
    fields,
    records,
    view: { column_widths: [] },
    source: null,
    diagnostics: [],
  };
  if (rand.chance(0.5)) table.display_name = randomString(rand);
  if (rand.chance(0.3)) {
    table.view.column_widths = uniqueStrings(rand, 1 + rand.int(3), new Set()).map((name) => [name, rand.int(400)]);
  }
  if (rand.chance(0.3)) table.view.frozen_columns = rand.int(4);
  if (rand.chance(0.3)) table.view.hidden_columns = uniqueStrings(rand, rand.int(3), new Set());
  return table;
}

// ---- テスト ----

async function sampleYamlFiles(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const [path, text] of await readTree(`${repoRoot()}/samples/basic-yaml`)) files.set(`basic-yaml/${path}`, text);
  // basic-json を YAML に書き換えたもの
  const result = await loadProject(await createNodeProjectFs(`${repoRoot()}/samples/basic-json`));
  if (result.status !== 'ok') throw new Error(JSON.stringify(result));
  for (const file of planProjectWrite(result.project, { format: 'yaml' }).files) {
    if (file.path.endsWith('.yaml')) files.set(`basic-json/${file.path}`, file.text);
  }
  return files;
}

describe('サンプルを専用の処理で読むと、yaml ライブラリの経路と同じ結果になる', () => {
  it('basic-yaml と、basic-json を YAML にしたもの', async () => {
    const files = await sampleYamlFiles();
    // basic-yaml の 7 ファイルと、basic-json の設定以外の 6 ファイル（masterdata-maker.json は JSON のまま）
    expect(files.size).toBe(13);
    for (const [path, text] of files) expectSameAsLibrary(path, text);
  });
});

describe('乱数で作った正規形のテーブル', () => {
  it('専用の処理が受け付け、構文木・モデル・診断がライブラリの経路と一致する', () => {
    const baseFields = defaultBaseFields();
    for (let seed = 1; seed <= 250; seed++) {
      const text = serializeTable(randomTable(seed), baseFields, 'yaml');
      expectSameAsLibrary(`tables/seed_${seed}.yaml`, text);
    }
  });
});

describe('受け付ける書き方の細部（値・位置がライブラリの経路と一致する）', () => {
  const cases: [string, string][] = [
    ['ブロックの中の , [ ] { } # : を含む引用符なしの値', 'a: a,b\nb: a]b{c}\nc: a#b\nd: x:y\ne: http://example.com/a?b=c\n'],
    ['引用符なしの値の途中の引用符と記号', "a: a\"b\nb: c'd\nc: IF(rarity = \"SSR\", hp * 2, hp)\nd: a !b &c *d |e >f\n"],
    ['フローの中の引用符と記号', "a: [a\"b, c'd, e!f, g&h, i*j, k?l, m|n, o>p, q%r, s@t]\n"],
    ['`:` を含むキーと空白を含むキー', 'a:b: 1\nx y: 2\nキー: 3\n'],
    ['数値・null・真偽値の表記', 'a: -5\nb: +5\nc: 0o17\nd: 0x1F\ne: 1e+21\nf: .5\ng: 1.\nh: -.inf\ni: .NaN\nj: ~\nk: 007\nl: -0\nm: Null\nn: TRUE\no: False\np: 0.0\nq: -1.5e-3\n'],
    ['YAML 1.2 では文字列になる表記', 'a: yes\nb: NO\nc: on\nd: 0b101\ne: 1_000\nf: 2026-10-13\ng: 12:30:00\nh: <<\ni: =\nk: 0o8\nl: 0x\n'],
    ['フローの中の数値・null・真偽値', 'a: [-5, +5, 0o17, 0x1F, 1e+21, .5, 1., -.inf, .NaN, ~, null, true, FALSE]\n'],
    ['ダブルクォートのエスケープ', 'a: "\\0\\a\\b\\e\\f\\n\\r\\t\\v\\N\\_\\L\\P\\ \\"\\/\\\\"\nb: "\\x41\\u00e9\\U0001F600\\uD800\\udc00\\U0000D83D"\n'],
    ['引用符で囲んだキー', '"1": a\n"true": b\n"": c\n"a: b": d\n"\\n": e\nf: { "1": x, "": y, "a, b": z }\n'],
    ['サロゲートペア・全角の空白・NBSP（列は UTF-16 の単位）', 'a: 😀😀\nb: [😀, "😀", x]\nc: { 😀: 1, d: "\u3000" }\nd: a\u00a0b\n'],
    ['キーの多いフローのマッピング', `a: { ${Array.from({ length: 40 }, (_, i) => `k${i}: ${i}`).join(', ')} }\n`],
    ['空のフローとネスト', 'a: []\nb: {}\nc: [[], {}, [1, [2, [3]]], { x: [1], y: { z: {} } }]\n'],
    ['同じキーを持つレコードが続く（キーの使い回し）', 'records:\n  - a: 1\n    b: 2\n  - a: 3\n    a:b: 4\n    b: 5\n  - b: 6\n  - c: 7\n    a: 8\n  - a: 9\n    b: 10\n    c: 11\n'],
    ['ブロックの入れ子', 'a:\n  b:\n    c: 1\n  d:\n    - 1\n    - [2]\n    - e: 3\n      f:\n        - g: 4\n    - {}\n    - "h"\n    - "i": 5\nj: 6\n'],
  ];
  for (const [name, text] of cases) {
    it(name, () => {
      expect(compare(text), label(text)).toBe(true);
    });
  }
});

describe('正規形でない入力では専用の処理が辞退し、結果はライブラリの経路と同じ', () => {
  const longKey = 'k'.repeat(1100);
  const cases: [string, string][] = [
    ['コメントの行', '# comment\na: 1\n'],
    ['値の後ろのコメント', 'a: 1 # comment\n'],
    ['フローの後ろのコメント', 'a: [1] # comment\n'],
    ['単引用符', "a: 'x'\n"],
    ['フローの中の単引用符', "a: ['x']\n"],
    ['ブロックスカラー |', 'a: |\n  x\n'],
    ['ブロックスカラー >', 'a: >\n  x\n'],
    ['ブロックスカラー |-', 'a: |-\n  x\n'],
    ['アンカーとエイリアス', 'a: &x 1\nb: *x\n'],
    ['フローの中のアンカー', 'a: [&x 1, *x]\n'],
    ['標準のタグ', 'a: !!str 1\n'],
    ['独自のタグ', 'a: !custom 1\n'],
    ['複数行のフローのリスト', 'a: [1,\n  2]\n'],
    ['複数行のフローのマッピング', 'a: { b: 1,\n  c: 2 }\n'],
    ['値の前のタブ', 'a:\t1\n'],
    ['ダブルクォートの中の生のタブ', 'a: "x\ty"\n'],
    ['タブの字下げ', 'a:\n\t- 1\n'],
    ['ドキュメントの開始', '---\na: 1\n'],
    ['ドキュメントの終わり', 'a: 1\n...\n'],
    ['%YAML の指示', '%YAML 1.2\n---\na: 1\n'],
    ['%YAML 1.1 の指示', '%YAML 1.1\n---\na: NO\n'],
    ['複数のドキュメント', 'a: 1\n---\na: 2\n'],
    ['BOM', '\ufeffa: 1\n'],
    ['CRLF', 'a: 1\r\nb: 2\r\n'],
    ['CR だけ', 'a: 1\rb: 2\n'],
    ['知らないエスケープ', 'a: "\\q"\n'],
    ['16 進の桁が足りないエスケープ', 'a: "\\x4"\n'],
    ['範囲外の \\U', 'a: "\\U00110000"\n'],
    ['改行のエスケープ', 'a: "x\\\n  y"\n'],
    ['4 スペースの字下げ', 'a:\n    b: 1\n'],
    ['1 スペースの字下げ', 'a:\n b: 1\n'],
    ['親と同じ位置のシーケンス', 'a:\n- 1\n'],
    ['字下げの不揃い', 'a:\n  b: 1\n   c: 2\n'],
    ['シーケンスの要素の字下げの不揃い', 'a:\n  - b: 1\n     c: 2\n'],
    ['シーケンスの後ろのキーが同じ字下げ', 'a:\n  - 1\n  b: 2\n'],
    ['重複キー', 'a: 1\na: 2\n'],
    ['2 つ目のレコードの重複キー（キーの使い回しの後）', 'records:\n  - a: 1\n    b: 2\n  - a: 1\n    a: 2\n'],
    ['使い回したキーと引用符で囲んだキーの重複', 'records:\n  - a: 1\n    b: 2\n  - a: 1\n    "a": 2\n'],
    ['使い回したキーの後ろのレコードの重複', 'records:\n  - a: 1\n    b: 2\n  - a: 1\n    b: 2\n    b: 3\n'],
    ['引用符の有無だけ違う重複キー', '"a": 1\na: 2\n'],
    ['フローの中の重複キー', 'a: { b: 1, b: 2 }\n'],
    ['キーの多いフローのマッピングの重複キー', `a: { ${Array.from({ length: 40 }, (_, i) => `k${i}: ${i}`).join(', ')}, k3: 0 }\n`],
    ['文字列以外のキー（整数）', '1: x\n"1": y\n'],
    ['文字列以外のキー（同じ値の整数）', '1: x\n01: y\n'],
    ['文字列以外のキー（真偽値・null）', 'true: x\nnull: y\n'],
    ['マージキー', 'b: { x: 1 }\nc:\n  <<: { y: 2 }\n'],
    ['末尾に改行が無い', 'a: 1'],
    ['空のファイル', ''],
    ['改行だけ', '\n'],
    ['空行', 'a: 1\n\nb: 2\n'],
    ['末尾の空行', 'a: 1\n\n'],
    ['行末の空白', 'a: 1 \n'],
    ['空の値', 'a:\n'],
    ['空白の後ろの空の値', 'a: \n'],
    ['複数行の引用符なしの値', 'a: b\n  c\n'],
    ['シーケンスの中の複数行の値', 'a:\n  - b\n    c\n'],
    ['複数行のダブルクォート', 'a: "b\n  c"\n'],
    ['明示的なキー', '? a\n: 1\n'],
    ['フローをキーにする', 'a:\n  - [x]: 1\n'],
    ['ルートがシーケンス', '- 1\n'],
    ['ルートがスカラー', 'a\n'],
    ['ルートがフローのマッピング', '{ a: 1 }\n'],
    ['ルートが空のマッピング', '{}\n'],
    ['ルートの字下げ', '  a: 1\n'],
    ['シーケンスの入れ子', 'a:\n  - - 1\n'],
    ['空の要素', 'a:\n  -\n'],
    ['フローの区切りに空白が無い', 'a: [1,2]\n'],
    ['フローの括弧の内側の空白', 'a: [ 1, 2 ]\n'],
    ['フローのマッピングの括弧の内側に空白が無い', 'a: {b: 1}\n'],
    ['フローのマッピングの `:` の後ろに空白が無い', 'a: { b:1 }\n'],
    ['フローのマッピングの片側だけの空白', 'a: {b: 1 }\n'],
    ['フローの区切りの前の空白', 'a: [1 , 2]\n'],
    ['フローの末尾のカンマ', 'a: [1, ]\n'],
    ['フローの空の要素', 'a: [, 1]\n'],
    ['フローの中の # と :', 'a: [a#b, c:d]\n'],
    ['フローの中の空白 2 つ', 'a: [a  ]\n'],
    ['JSON の書き方', '{"a": 1}\n'],
    ['キーと `:` の間の空白', 'a : 1\n'],
    ['1024 文字を超えるキー', `${longKey}: 1\n`],
    ['生の制御文字', 'a: b\u0001c\n'],
    ['生の DEL', 'a: b\u007fc\n'],
    ['生の NEL', 'a: b\u0085c\n'],
    ['生の行区切り', 'a: b\u2028c\n'],
    ['生の非文字', 'a: b\uffffc\n'],
    ['対になっていないサロゲート', 'a: b\ud800c\n'],
    ['対になっていない下位のサロゲート', 'a: "b\udc00"\n'],
    ['記号で始まる値 @', 'a: @x\n'],
    ['記号で始まる値 `', 'a: `x\n'],
    ['記号で始まる値 %', 'a: %x\n'],
    ['記号で始まる値 -', 'a: -x\n'],
    ['- で始まる数値でない値', 'a: -.nan\n'],
    ['記号で始まる値 ?', 'a: ?x\n'],
    ['記号で始まる値 :', 'a: :x\n'],
    ['記号で始まる値 ,', 'a: ,x\n'],
    ['記号で始まる値 ]', 'a: ]\n'],
    ['... で始まる値', 'a: ...x\n'],
    ['`:` で終わる値', 'a: b:\n'],
    ['`: ` を含む値', 'a: b: c\n'],
    ['` #` を含む値', 'a: b #c\n'],
    ['引用符の後ろの余計な値', 'a: "x" y\n'],
    ['閉じていない引用符', 'a: "x\n'],
    ['閉じていないフロー', 'a: [1, 2\n'],
    ['閉じていないフローのマッピング', 'a: { b: 1\n'],
    ['深い入れ子', `a: ${'['.repeat(100)}${']'.repeat(100)}\n`],
  ];
  for (const [name, text] of cases) {
    it(name, () => expectDeclined(text));
  }
});

describe('正規形を壊した入力（専用の処理は、ライブラリの経路と同じ結果になるときだけ受け付ける）', () => {
  const PIECES = [
    ' ',
    '  ',
    '\n',
    ':',
    ': ',
    '#',
    ' #',
    '-',
    '- ',
    '"',
    "'",
    '\\',
    '[',
    ']',
    '{',
    '}',
    ',',
    ', ',
    '\t',
    '\r',
    '&',
    '*',
    '!',
    '|',
    '>',
    '?',
    '%',
    '@',
    'x',
    '0',
    '.',
    '~',
    '\ufeff',
    '\u2028',
    '\ud800',
    '---\n',
    '...\n',
  ];

  it('1 文字の挿入・削除・置換をランダムに加える', { timeout: 60_000 }, async () => {
    const bases = [...(await sampleYamlFiles()).values()];
    const baseFields = defaultBaseFields();
    // 乱数のテーブルは先頭の 30 行だけ使う（ライブラリの経路の時間を抑えるため）
    for (let seed = 1; seed <= 20; seed++) {
      const lines = serializeTable(randomTable(seed), baseFields, 'yaml').split('\n');
      bases.push(`${lines.slice(0, 30).join('\n').trimEnd()}\n`);
    }
    const rand = new Random(7);
    let accepted = 0;
    for (let i = 0; i < 1500; i++) {
      const base = rand.pick(bases);
      const at = rand.int(base.length + 1);
      const op = rand.int(3);
      const piece = rand.pick(PIECES);
      const text =
        op === 0
          ? base.slice(0, at) + piece + base.slice(at)
          : op === 1
            ? base.slice(0, at) + base.slice(at + 1)
            : base.slice(0, at) + piece + base.slice(at + 1);
      if (compare(text)) accepted++;
    }
    // 壊しても正規形のままのもの（値の文字が変わっただけなど）は受け付ける
    expect(accepted).toBeGreaterThan(150);
  });
});

describe('引用符なしのスカラーの解釈は YAML 1.2 core schema と同じ', () => {
  it('数値らしい表記をランダムに作って、ブロックとフローの両方で突き合わせる', () => {
    const rand = new Random(11);
    const chars = '0123456789.+-eExo_abcdfABCDF';
    const words = ['inf', 'Inf', 'INF', 'nan', 'NaN', 'NAN', 'null', 'Null', 'NULL', 'nULL', '~', 'true', 'True', 'TRUE', 'tRUE', 'false', 'False', 'FALSE', 'n', 'y'];
    let accepted = 0;
    for (let i = 0; i < 1500; i++) {
      let token = '';
      const n = 1 + rand.int(6);
      for (let k = 0; k < n; k++) token += rand.chance(0.15) ? rand.pick(words) : chars[rand.int(chars.length)];
      if (compare(`a: ${token}\nb: [${token}]\nc: { d: ${token} }\n`)) accepted++;
    }
    expect(accepted).toBeGreaterThan(500);
  });
});
