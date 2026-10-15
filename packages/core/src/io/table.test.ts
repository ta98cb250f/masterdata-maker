import { describe, expect, it } from 'vitest';
import { RichCell } from '../model/cell';
import { defaultBaseFields } from '../model/defaults';
import type { Diagnostic } from '../model/diagnostic';
import type { BrokenTable, Table } from '../model/table';
import { UidAllocator } from '../model/uid';
import { IoCode } from './codes';
import { SerializeError } from './emit';
import { parseTableFile } from './parse';
import { serializeTable } from './serialize';

const BASE = defaultBaseFields();

function parse(text: string, path = 'tables/t.yaml'): Table | BrokenTable {
  return parseTableFile(path, text);
}

function load(text: string, path = 'tables/t.yaml'): Table {
  const table = parse(text, path);
  if (table.kind !== 'table') throw new Error(`読み込みエラー: ${JSON.stringify(table.diagnostics)}`);
  return table;
}

function broken(text: string, path = 'tables/t.yaml'): BrokenTable {
  const table = parse(text, path);
  if (table.kind !== 'broken') throw new Error('読み込みエラーになるはず');
  return table;
}

function codes(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((d) => d.code);
}

function yaml(table: Table): string {
  return serializeTable(table, BASE, 'yaml');
}

function json(table: Table): string {
  return serializeTable(table, BASE, 'json');
}

/** 1 列だけのテーブルの YAML */
function oneColumn(type: string, records: string, extra = ''): string {
  return `table: t\nfields:\n  - name: v\n    type: ${type}\n${extra}records:${records === '' ? ' []\n' : `\n${records}`}`;
}

describe('DR-42: 列の型で値を解釈する', () => {
  it('string 列の引用符なしの 1.10 は元の表記の文字列に復元して警告する', () => {
    const table = load(oneColumn('string', '  - id: 1\n    v: 1.10\n'));
    expect(table.records[0].cells.get('v')).toBe('1.10');
    expect(table.diagnostics).toMatchObject([
      {
        severity: 'warning',
        code: IoCode.numberRestoredAsString,
        params: { key: 'v', source: '1.10' },
        file: 'tables/t.yaml',
        table: 't',
        field: 'v',
        recordKey: '1',
        line: 7,
        column: 8,
      },
    ]);
    expect(yaml(table)).toContain('    v: "1.10"\n');
  });

  it('真偽値・整数・特殊な数値も元の表記に戻す', () => {
    const table = load(
      oneColumn('string', '  - id: 1\n    v: true\n  - id: 2\n    v: 007\n  - id: 3\n    v: .inf\n  - id: 4\n    v: 0x1F\n'),
    );
    expect(table.records.map((r) => r.cells.get('v'))).toEqual(['true', '007', '.inf', '0x1F']);
    expect(codes(table.diagnostics)).toEqual([
      IoCode.boolRestoredAsString,
      IoCode.numberRestoredAsString,
      IoCode.numberRestoredAsString,
      IoCode.numberRestoredAsString,
    ]);
  });

  it('YAML 1.2 では NO・2026-10-13 は文字列なので警告しない。保存では引用符で囲む', () => {
    const table = load(oneColumn('string', '  - id: 1\n    v: NO\n  - id: 2\n    v: 2026-10-13\n'));
    expect(table.records.map((r) => r.cells.get('v'))).toEqual(['NO', '2026-10-13']);
    expect(table.diagnostics).toEqual([]);
    expect(yaml(table)).toContain('    v: "NO"\n');
    expect(yaml(table)).toContain('    v: "2026-10-13"\n');
  });

  it('enum・datetime・list<string> の要素にも同じ規則を当てる', () => {
    const table = load(
      `table: t
fields:
  - name: e
    type: enum
    enum_ref: x
  - name: d
    type: datetime
  - name: l
    type: list<string>
records:
  - id: 1
    e: 1
    d: 2026-10-13T12:00:00+09:00
    l: [a, 1.10, yes]
`,
    );
    const cells = table.records[0].cells;
    expect(cells.get('e')).toBe('1');
    expect(cells.get('d')).toBe('2026-10-13T12:00:00+09:00');
    expect(cells.get('l')).toEqual(['a', '1.10', 'yes']);
    expect(codes(table.diagnostics)).toEqual([IoCode.numberRestoredAsString, IoCode.numberRestoredAsString]);
    const out = yaml(table);
    expect(out).toContain('    e: "1"\n');
    // DR-41: datetime は常に引用符で囲む
    expect(out).toContain('    d: "2026-10-13T12:00:00+09:00"\n');
    expect(out).toContain('    l: [a, "1.10", "yes"]\n');
  });

  it('型に合わない値は捨てずに保持し、元の値のまま書き戻す', () => {
    const text = oneColumn('int', '  - id: 1\n    v: abc\n  - id: 2\n    v: "1200"\n  - id: 3\n    v: 1.5\n  - id: 4\n    v: [1, 2]\n');
    const table = load(text);
    expect(table.records.map((r) => r.cells.get('v'))).toEqual(['abc', '1200', 1.5, [1, 2]]);
    expect(table.diagnostics).toEqual([]);
    expect(yaml(table)).toBe(text);
  });

  it('JSON では文字列の列の数値を復元せず、そのまま保持する（型の推定が無いため）', () => {
    const table = load(
      '{ "table": "t", "fields": [{ "name": "v", "type": "string" }], "records": [{ "id": 1, "v": 1.10 }] }',
      'tables/t.json',
    );
    expect(table.records[0].cells.get('v')).toBe(1.1);
    expect(table.diagnostics).toEqual([]);
  });
});

describe('DR-15・P-11・P-12: 未入力', () => {
  it('"" と [] は未入力（キーを持たない）。保存でキーを消す', () => {
    const table = load(
      `table: t
fields:
  - name: s
    type: string
  - name: l
    type: list<int>
records:
  - id: 1
    s: ""
    l: []
`,
    );
    expect([...table.records[0].cells.keys()]).toEqual(['id']);
    expect(table.diagnostics).toEqual([]);
    expect(yaml(table).endsWith('records:\n  - id: 1\n')).toBe(true);
  });

  it('null・~・空の値は未入力にして警告する', () => {
    const table = load(oneColumn('int', '  - id: 1\n    v: ~\n  - id: 2\n    v: null\n  - id: 3\n    v:\n'));
    expect(table.records.map((r) => r.cells.has('v'))).toEqual([false, false, false]);
    expect(codes(table.diagnostics)).toEqual([IoCode.nullAsEmpty, IoCode.nullAsEmpty, IoCode.nullAsEmpty]);
  });

  it('string・enum 列で元の表記がある null は文字列として復元する（空の値は未入力）', () => {
    const table = load(oneColumn('string', '  - id: 1\n    v: null\n  - id: 2\n    v: ~\n  - id: 3\n    v:\n'));
    expect(table.records.map((r) => r.cells.get('v'))).toEqual(['null', '~', undefined]);
    expect(codes(table.diagnostics)).toEqual([
      IoCode.nullRestoredAsString,
      IoCode.nullRestoredAsString,
      IoCode.nullAsEmpty,
    ]);
    expect(yaml(table)).toContain('    v: "null"\n');
  });

  it('datetime 列の null は復元せず未入力にする', () => {
    const table = load(oneColumn('datetime', '  - id: 1\n    v: null\n'));
    expect(table.records[0].cells.has('v')).toBe(false);
    expect(codes(table.diagnostics)).toEqual([IoCode.nullAsEmpty]);
  });

  it('JSON の null は未入力にして警告する', () => {
    const table = load(
      '{ "table": "t", "fields": [{ "name": "v", "type": "string" }], "records": [{ "id": 1, "v": null }] }',
      'tables/t.json',
    );
    expect(table.records[0].cells.has('v')).toBe(false);
    expect(codes(table.diagnostics)).toEqual([IoCode.nullAsEmpty]);
  });

  it('列の default の "" と [] はそのまま保持する（J-02、P-11）', () => {
    const text = `table: t
fields:
  - name: s
    type: string
    default: ""
  - name: l
    type: list<int>
    default: []
  - name: m
    type: list<float>
    default: [1.5, 2]
records: []
`;
    const table = load(text);
    expect(table.fields.map((f) => f.default)).toEqual(['', [], [1.5, 2]]);
    expect(yaml(table)).toBe(text);
  });

  it('リストの中の null は表せないので読み込みエラー', () => {
    const t = broken(oneColumn('list<int>', '  - id: 1\n    v: [1, null]\n'));
    expect(codes(t.diagnostics)).toEqual([IoCode.nullInList]);
  });
});

describe('DR-19・DR-36: 整数', () => {
  it('int64 は BigInt で精度を落とさずに読み書きする', () => {
    const text = oneColumn('int64', '  - id: 1\n    v: 9223372036854775807\n  - id: 2\n    v: -9007199254740993\n  - id: 3\n    v: 5\n');
    const table = load(text);
    expect(table.records.map((r) => r.cells.get('v'))).toEqual([9223372036854775807n, -9007199254740993n, 5n]);
    expect(yaml(table)).toBe(text);
    const fromJson = load(json(table), 'tables/t.json');
    expect(fromJson.records.map((r) => r.cells.get('v'))).toEqual([9223372036854775807n, -9007199254740993n, 5n]);
    expect(json(fromJson)).toContain('"v": 9223372036854775807');
  });

  it('int は安全な整数なら number、範囲外なら BigInt のまま保持する', () => {
    const text = oneColumn('int', '  - id: 1\n    v: 9007199254740991\n  - id: 2\n    v: 9007199254740993\n');
    const table = load(text);
    expect(table.records.map((r) => r.cells.get('v'))).toEqual([9007199254740991, 9007199254740993n]);
    expect(yaml(table)).toBe(text);
  });
});

describe('DR-35: 小数', () => {
  it('読み戻して同じ値になる最も短い表記で書く', () => {
    const table = load(oneColumn('float', '  - id: 1\n    v: 0.10\n  - id: 2\n    v: 3\n  - id: 3\n    v: 1e-7\n'));
    expect(table.records.map((r) => r.cells.get('v'))).toEqual([0.1, 3, 1e-7]);
    table.records[1].cells.set('v', 1 / 3);
    const out = yaml(table);
    expect(out).toContain('    v: 0.1\n');
    expect(out).toContain(`    v: ${String(1 / 3)}\n`);
    expect(out).toContain('    v: 1e-7\n');
  });

  it('NaN と Infinity は保存できない（専用のエラー）', () => {
    const table = load(oneColumn('float', '  - id: 1\n    v: .inf\n'));
    expect(table.records[0].cells.get('v')).toBe(Infinity);
    expect(() => yaml(table)).toThrow(SerializeError);
    table.records[0].cells.set('v', Number.NaN);
    try {
      json(table);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SerializeError);
      expect((e as SerializeError).code).toBe(IoCode.nonFiniteNumber);
      expect((e as SerializeError).params).toMatchObject({ table: 't', key: 'records[0].v' });
    }
  });
});

describe('RichCell（DR-11、P-04）', () => {
  it('値・セル単位式・セル色・メモを 1 行で書く。キーの順は固定', () => {
    const table = load(oneColumn('int', '  - id: 1\n    v: { comment: メモ, color: red, override: hp * 2, value: 3 }\n'));
    const cell = table.records[0].cells.get('v');
    expect(cell).toBeInstanceOf(RichCell);
    expect(yaml(table)).toContain('    v: { value: 3, override: hp * 2, color: red, comment: メモ }\n');
    expect(json(table)).toContain('"v": { "value": 3, "override": "hp * 2", "color": "red", "comment": "メモ" }');
  });

  it('値だけの RichCell は値だけのセルにする。空の注記は無いものとする', () => {
    const table = load(oneColumn('int', '  - id: 1\n    v: { value: 3 }\n  - id: 2\n    v: { value: 4, comment: "" }\n  - id: 3\n    v: {}\n'));
    expect(table.records.map((r) => r.cells.get('v'))).toEqual([3, 4, undefined]);
  });

  it('値がリストの RichCell と、フローの中で引用が要る式', () => {
    const text = oneColumn(
      'list<int>',
      '  - id: 1\n    v: { value: [1, 2], override: "IF(rarity = \\"SSR\\", hp * 2, hp)" }\n',
    );
    const table = load(text);
    const cell = table.records[0].cells.get('v') as RichCell;
    expect(cell.value).toEqual([1, 2]);
    expect(cell.override).toBe('IF(rarity = "SSR", hp * 2, hp)');
    expect(yaml(table)).toBe(text);
  });

  it('知らないキーは読み込みエラー（値は保持する）', () => {
    const t = broken(oneColumn('int', '  - id: 1\n    v: { value: 3, note: x }\n'));
    expect(t.diagnostics).toMatchObject([{ code: IoCode.unknownRichCellKey, params: { key: 'note', field: 'v' } }]);
  });
});

describe('DR-12: 列定義の知らないキー', () => {
  it('列の直下の required は validation.required の書き間違いとして読み込みエラーにする', () => {
    const t = broken(oneColumn('int', '  - id: 1\n', '    required: true\n'));
    expect(t.diagnostics).toMatchObject([
      { severity: 'error', code: IoCode.fieldKeyBelongsToValidation, params: { key: 'required', field: 'v' }, line: 5 },
    ]);
    expect(t.name).toBe('t');
  });

  it('知らないキー・validation と anomaly の中の知らないキー', () => {
    const t = broken(
      oneColumn('int', '', '    foo: 1\n    warn_above: 3\n    validation: { mn: 1 }\n    anomaly: { warn_over: 2 }\n'),
    );
    expect(codes(t.diagnostics)).toEqual([
      IoCode.unknownFieldKey,
      IoCode.fieldKeyBelongsToAnomaly,
      IoCode.unknownValidationKey,
      IoCode.unknownAnomalyKey,
    ]);
  });

  it('トップレベル・view の知らないキー、知らない型、auto の値', () => {
    expect(codes(broken('table: t\nfields: []\nrecords: []\nrows: []\n').diagnostics)).toEqual([IoCode.unknownTableKey]);
    expect(codes(broken('table: t\nfields: []\nrecords: []\nview: { zoom: 2 }\n').diagnostics)).toEqual([
      IoCode.unknownViewKey,
    ]);
    expect(codes(broken(oneColumn('integer', '')).diagnostics)).toEqual([IoCode.unknownFieldType]);
    expect(codes(broken(oneColumn('int', '', '    auto: uuid\n')).diagnostics)).toEqual([IoCode.invalidAuto]);
  });

  it('真偽値のキーに YAML 1.1 の yes は使えない', () => {
    expect(broken(oneColumn('int', '', '    export: yes\n')).diagnostics).toMatchObject([
      { code: IoCode.expectedBoolean, params: { key: 'v.export' } },
    ]);
  });

  it('table・name・type が無ければ読み込みエラー', () => {
    expect(broken('fields: []\nrecords: []\n', 'tables/abc.yaml')).toMatchObject({
      name: 'abc',
      diagnostics: [{ code: IoCode.missingKey, params: { key: 'table' } }],
    });
    expect(codes(broken('table: t\nfields:\n  - type: int\n').diagnostics)).toEqual([IoCode.missingKey]);
    expect(codes(broken('table: t\nfields:\n  - name: a\n').diagnostics)).toEqual([IoCode.missingKey]);
  });
});

describe('列定義の保持', () => {
  it('既定値と同じでも明示されたキーは書き戻す。全キーを DR-14 の順で書く', () => {
    const text = `table: t
fields:
  - name: v
    type: datetime
    display_name: 開始
    description: 説明
    export: true
    editable: true
    primary: false
    enum_ref: e
    ref: other.id
    formula: DATE(2026, 1, 1)
    default: "2026-01-01T00:00:00+09:00"
    validation: { required: false, min: "2026-01-01T00:00:00+09:00", max: "2027-01-01T00:00:00+09:00", max_length: 3, max_items: 2, regex: ^a$, unique: false }
    anomaly: { warn_above: 10, warn_below: -1, warn_deviation: 2.5 }
records: []
`;
    const table = load(text);
    expect(table.fields[0]).toMatchObject({ export: true, editable: true, primary: false });
    expect(yaml(table)).toBe(text);
    const fromJson = load(json(table), 'tables/t.json');
    expect(yaml(fromJson)).toBe(text);
  });

  it('キーの順が違う列定義は DR-14 の順に直す', () => {
    const table = load('table: t\nfields:\n  - type: int\n    display_name: 値\n    name: v\nrecords: []\n');
    expect(yaml(table)).toBe('table: t\nfields:\n  - name: v\n    type: int\n    display_name: 値\nrecords: []\n');
  });

  it('int64 列の min / max・anomaly は BigInt、int 列は number', () => {
    const table = load(
      `table: t
fields:
  - name: a
    type: int64
    validation: { min: 0, max: 9223372036854775807 }
    anomaly: { warn_above: 9007199254740993 }
  - name: b
    type: int
    validation: { min: 0, max: 10 }
records: []
`,
    );
    expect(table.fields[0].validation).toEqual({ min: 0n, max: 9223372036854775807n });
    expect(table.fields[0].anomaly).toEqual({ warn_above: 9007199254740993n });
    expect(table.fields[1].validation).toEqual({ min: 0, max: 10 });
  });
});

describe('DR-32・DR-34: レコードのキーの順と知らないキー', () => {
  it('キーは共通列 → テーブルの列の順に並べ直す', () => {
    const table = load(
      'table: t\nfields:\n  - name: a\n    type: int\n  - name: b\n    type: int\nrecords:\n  - b: 2\n    version: "1"\n    a: 1\n    id: 1\n',
    );
    expect(yaml(table)).toBe(
      'table: t\nfields:\n  - name: a\n    type: int\n  - name: b\n    type: int\nrecords:\n  - id: 1\n    version: "1"\n    a: 1\n    b: 2\n',
    );
  });

  it('列定義に無いキーは警告し、レコードの末尾に元の順で残す', () => {
    const table = load(
      'table: t\nfields:\n  - name: a\n    type: int\nrecords:\n  - zeta: { x: [1, null] }\n    id: 1\n    alpha: ~\n    a: 1\n',
    );
    expect(table.diagnostics).toMatchObject([
      { severity: 'warning', code: IoCode.unknownRecordKey, params: { key: 'zeta' }, recordKey: '1', line: 6 },
      { severity: 'warning', code: IoCode.unknownRecordKey, params: { key: 'alpha' } },
    ]);
    expect(table.records[0].extra).toEqual([
      ['zeta', new Map([['x', [1n, null]]])],
      ['alpha', null],
    ]);
    const out = yaml(table);
    expect(out).toBe(
      'table: t\nfields:\n  - name: a\n    type: int\nrecords:\n  - id: 1\n    a: 1\n    zeta: { x: [1, null] }\n    alpha: null\n',
    );
    // 書き出したものを読み直しても同じ
    expect(yaml(load(out))).toBe(out);
    expect(json(load(out))).toContain('"zeta": { "x": [1, null] },\n      "alpha": null\n');
  });

  it('全フィールドが未入力のレコードは {}', () => {
    const text = 'table: t\nfields: []\nrecords:\n  - {}\n  - id: 2\n';
    const table = load(text);
    expect(yaml(table)).toBe(text);
    expect(json(table)).toBe('{\n  "table": "t",\n  "fields": [],\n  "records": [\n    {},\n    {\n      "id": 2\n    }\n  ]\n}\n');
  });
});

describe('view（DR-06、P-05）', () => {
  it('column_widths と hidden_columns は列の順。列に無い名前は後ろに元の順', () => {
    const table = load(
      'table: t\nfields:\n  - name: a\n    type: int\n  - name: b\n    type: int\nrecords: []\nview:\n  hidden_columns: [zz, b, id]\n  frozen_columns: 1\n  column_widths: { y: 1, b: 2, x: 3, id: 4 }\n',
    );
    expect(yaml(table)).toBe(
      'table: t\nfields:\n  - name: a\n    type: int\n  - name: b\n    type: int\nrecords: []\nview:\n  column_widths: { id: 4, b: 2, \"y\": 1, x: 3 }\n  frozen_columns: 1\n  hidden_columns: [id, b, zz]\n',
    );
  });

  it('空の view はキー自体を書かない', () => {
    const table = load('table: t\nfields: []\nrecords: []\nview: {}\n');
    expect(yaml(table)).toBe('table: t\nfields: []\nrecords: []\n');
  });
});

describe('テキストの扱い（DR-31）', () => {
  it('BOM は警告して取り除き、CRLF は LF にして書く', () => {
    const table = load('\uFEFFtable: t\r\nfields: []\r\nrecords:\r\n  - id: 1\r\n');
    expect(codes(table.diagnostics)).toEqual([IoCode.bomRemoved]);
    expect(yaml(table)).toBe('table: t\nfields: []\nrecords:\n  - id: 1\n');
    expect(table.source?.text.startsWith('\uFEFF')).toBe(true);
  });

  it('改行を含む文字列はダブルクォートでエスケープして 1 行に書く', () => {
    const table = load(oneColumn('string', '  - id: 1\n    v: |\n      一行目\n      二行目\n'));
    expect(table.records[0].cells.get('v')).toBe('一行目\n二行目\n');
    expect(yaml(table)).toContain('    v: "一行目\\n二行目\\n"\n');
  });

  it('YAML のコメントは保存で消す（DR-44）', () => {
    const table = load('# 説明\ntable: t # 名前\nfields: []\nrecords: []\n');
    expect(table.diagnostics).toEqual([]);
    expect(yaml(table)).toBe('table: t\nfields: []\nrecords: []\n');
  });
});

describe('読み込み元の情報と内部番号', () => {
  it('ファイルの情報を持ち、内部番号はテーブル → レコードの順に採番する', () => {
    const uids = new UidAllocator(10);
    const table = parseTableFile('tables/t.yaml', 'table: t\nfields: []\nrecords:\n  - id: 1\n  - id: 2\n', { uids });
    expect(table.kind).toBe('table');
    if (table.kind !== 'table') return;
    expect(table.source).toEqual({ path: 'tables/t.yaml', format: 'yaml', text: expect.any(String) });
    expect(table.uid).toBe(10);
    expect(table.records.map((r) => r.uid)).toEqual([11, 12]);
    expect(uids.peek()).toBe(13);
  });

  it('DR-02: storage.format と違う拡張子は警告する。DR-04: ファイル名が <table>.<拡張子> でなければ警告する', () => {
    const table = parseTableFile('tables/chara.json', '{ "table": "character", "fields": [], "records": [] }', {
      storageFormat: 'yaml',
    });
    expect(table.kind).toBe('table');
    expect(table.diagnostics).toMatchObject([
      { severity: 'warning', code: IoCode.formatMismatch, params: { path: 'tables/chara.json', expected: 'yaml' } },
      {
        severity: 'warning',
        code: IoCode.fileNameMismatch,
        params: { path: 'tables/chara.json', expected: 'character.json' },
      },
    ]);
  });

  it('読み込みエラーのテーブルはエラーだけを持つ（P-40）', () => {
    const t = broken('table: t\nfields: [\n');
    expect(t).toMatchObject({ kind: 'broken', name: 't', source: { path: 'tables/t.yaml' } });
    expect(t.diagnostics[0]).toMatchObject({ severity: 'error', code: IoCode.yamlSyntaxError, file: 'tables/t.yaml' });
  });
});
