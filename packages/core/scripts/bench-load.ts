// テーブルの読み込みの時間を測る（通常のテストには入れない。時間がかかり、環境で揺れるため）。
//
// 実行方法（リポジトリのルートで）:
//   packages/cli/node_modules/.bin/esbuild packages/core/scripts/bench-load.ts --bundle --platform=node \
//     --format=cjs --outfile=/tmp/bench-load.cjs && node /tmp/bench-load.cjs
// （yaml ライブラリが CommonJS の require('process') を使うので、--format=cjs にする）
// 引数: 行数と列数（既定は 10000 行 × 50 列。列数は共通列の id・version を含む）。
// 3 つ目の引数に lib を付けると、yaml ライブラリの経路の時間も測る（大きいテーブルでは 1 回 10 秒以上かかる）
//   node /tmp/bench-load.cjs 10000 50 lib

import { RichCell } from '../src/model/cell';
import type { Cell, RawValue } from '../src/model/cell';
import { defaultBaseFields } from '../src/model/defaults';
import type { FieldDef, FieldType } from '../src/model/field';
import type { SourceFile, StorageFormat } from '../src/model/source';
import type { Table, TableRecord } from '../src/model/table';
import { UidAllocator } from '../src/model/uid';
import { decodeTable } from '../src/io/decode-table';
import { parseJson } from '../src/io/json-parse';
import { parseTableFile, parseText } from '../src/io/parse';
import { serializeTable } from '../src/io/serialize';
import { Reporter } from '../src/io/tree';
import { parseCanonicalYaml } from '../src/io/yaml-fast';
import { parseYamlWithLibrary } from '../src/io/yaml-parse';

const TYPES: FieldType[] = ['int', 'string', 'float', 'enum', 'list<int>', 'bool', 'datetime', 'int64', 'list<string>'];
const WORDS = ['勇者', 'スライム', 'dragon', 'Knight', '魔法使い', 'a,b', 'NO', '1.10', 'null', 'x: y', '一行目\n二行目'];

/** 再現できる乱数（mulberry32） */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTable(rows: number, columns: number): Table {
  const rand = random(42);
  const fields: FieldDef[] = [];
  for (let i = 0; i < columns - 2; i++) {
    const type = TYPES[i % TYPES.length];
    const field: FieldDef = { name: `col_${String(i).padStart(2, '0')}`, type, display_name: `列${i}` };
    if (type === 'enum') field.enum_ref = 'rarity';
    fields.push(field);
  }
  const value = (type: FieldType): RawValue => {
    switch (type) {
      case 'int':
        return Math.floor(rand() * 100000);
      case 'int64':
        return BigInt(Math.floor(rand() * 1e9)) * 1000000007n;
      case 'float':
        return Math.round(rand() * 1e6) / 100;
      case 'bool':
        return rand() < 0.5;
      case 'enum':
        return ['N', 'R', 'SR', 'SSR'][Math.floor(rand() * 4)];
      case 'datetime':
        return '2026-10-13T12:00:00+09:00';
      case 'list<int>':
        return [1, 2, Math.floor(rand() * 100)];
      case 'list<string>':
        return ['火', WORDS[Math.floor(rand() * WORDS.length)]];
      default:
        return WORDS[Math.floor(rand() * WORDS.length)] + String(Math.floor(rand() * 1000));
    }
  };
  const records: TableRecord[] = [];
  for (let r = 0; r < rows; r++) {
    const cells = new Map<string, Cell>();
    cells.set('id', r + 1);
    if (r % 10 === 0) cells.set('version', '0.1.2');
    for (const field of fields) {
      const v = value(field.type);
      cells.set(field.name, r % 97 === 0 ? new RichCell({ value: v, color: 'red', comment: 'メモ' }) : v);
    }
    records.push({ uid: r + 1, cells, extra: [] });
  }
  return {
    kind: 'table',
    uid: 0,
    name: 'bench',
    display_name: 'ベンチマーク',
    fields,
    records,
    view: { column_widths: [['col_00', 120]], frozen_columns: 1 },
    source: null,
    diagnostics: [],
  };
}

/** 中央値（ミリ秒） */
function measure(label: string, times: number, fn: () => unknown): number {
  fn();
  const samples: number[] = [];
  for (let i = 0; i < times; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  console.log(`${label.padEnd(44)} ${median.toFixed(median < 10 ? 3 : 1).padStart(9)} ms`);
  return median;
}

function bench(label: string, rows: number, columns: number, times: number): void {
  const table = makeTable(rows, columns);
  const baseFields = defaultBaseFields();
  console.log(`\n== ${label}: ${rows} 行 × ${columns} 列 ==`);
  for (const format of ['yaml', 'json'] as StorageFormat[]) {
    const text = serializeTable(table, baseFields, format);
    const path = `tables/bench.${format}`;
    console.log(`-- ${format}（${(text.length / 1e6).toFixed(2)}M 文字）`);
    measure(`${format}: parseTableFile 全体`, times, () => parseTableFile(path, text));
    measure(`${format}: 構文木の生成（parseText）`, times, () => parseText(text, format, new Reporter()));
    if (format === 'yaml') {
      if (parseCanonicalYaml(text) === null) console.log('   （専用の処理が辞退した）');
      if (withLibrary) {
        measure('yaml: 構文木の生成（yaml ライブラリの経路）', times, () => parseYamlWithLibrary(text, new Reporter()));
      }
    } else {
      measure('json: 構文木の生成（parseJson）', times, () => parseJson(text, new Reporter()));
    }
    const node = parseText(text, format, new Reporter()).node;
    const source: SourceFile = { path, format, text };
    measure(`${format}: 値の解釈（decodeTable）`, times, () =>
      decodeTable(node, new Reporter([], { file: path }), {
        baseFields,
        uids: new UidAllocator(),
        source,
        fallbackName: 'bench',
      }),
    );
  }
}

const rows = Number(process.argv[2] ?? 10000);
const columns = Number(process.argv[3] ?? 50);
const withLibrary = process.argv[4] === 'lib';
bench('大きいテーブル', rows, columns, 5);
bench('小さいテーブル', 100, 10, 200);
