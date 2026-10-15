import { describe, expect, it } from 'vitest';
import { RichCell } from '../model/cell';
import type { Table } from '../model/table';
import { parseTableFile } from './parse';
import { serializeTable } from './serialize';
import { defaultBaseFields } from '../model/defaults';

// 要件書 §1 の例（そのまま）
const SPEC_YAML = `table: character
display_name: キャラクター
fields:
  - name: name
    type: string
    display_name: 名前
  - name: rarity
    type: enum
    display_name: レアリティ
    enum_ref: rarity
  - name: hp
    type: int
    display_name: HP
records:
  - id: 1
    name: 勇者アルス
    rarity: SSR
    hp: 1200
  - id: 2
    name: 魔法使いリナ
    rarity: SR
    hp: { value: 800, color: red, comment: 次回調整予定 }
view:
  column_widths: { name: 160, hp: 80 }
`;

const SPEC_JSON = `{
  "table": "character",
  "display_name": "キャラクター",
  "fields": [
    { "name": "name", "type": "string", "display_name": "名前" },
    { "name": "rarity", "type": "enum", "display_name": "レアリティ", "enum_ref": "rarity" },
    { "name": "hp", "type": "int", "display_name": "HP" }
  ],
  "records": [
    {
      "id": 1,
      "name": "勇者アルス",
      "rarity": "SSR",
      "hp": 1200
    },
    {
      "id": 2,
      "name": "魔法使いリナ",
      "rarity": "SR",
      "hp": { "value": 800, "color": "red", "comment": "次回調整予定" }
    }
  ],
  "view": {
    "column_widths": { "name": 160, "hp": 80 }
  }
}
`;

function load(path: string, text: string): Table {
  const table = parseTableFile(path, text);
  if (table.kind !== 'table') throw new Error(JSON.stringify(table.diagnostics));
  return table;
}

describe('要件書 §1 の例の往復', () => {
  it('YAML の例を読んで書き出すと 1 バイトも変わらない', () => {
    const table = load('tables/character.yaml', SPEC_YAML);
    expect(table.diagnostics).toEqual([]);
    expect(serializeTable(table, defaultBaseFields(), 'yaml')).toBe(SPEC_YAML);
  });

  it('JSON の例を読んで書き出すと 1 バイトも変わらない', () => {
    const table = load('tables/character.json', SPEC_JSON);
    expect(table.diagnostics).toEqual([]);
    expect(serializeTable(table, defaultBaseFields(), 'json')).toBe(SPEC_JSON);
  });

  it('YAML の例を JSON で書くと JSON の例と一致し、YAML に戻すと元に戻る', () => {
    const fromYaml = load('tables/character.yaml', SPEC_YAML);
    const json = serializeTable(fromYaml, defaultBaseFields(), 'json');
    expect(json).toBe(SPEC_JSON);
    const fromJson = load('tables/character.json', json);
    expect(serializeTable(fromJson, defaultBaseFields(), 'yaml')).toBe(SPEC_YAML);
  });

  it('モデルの中身（§1 の画面の値）', () => {
    const table = load('tables/character.yaml', SPEC_YAML);
    expect(table.name).toBe('character');
    expect(table.display_name).toBe('キャラクター');
    expect(table.fields.map((f) => f.name)).toEqual(['name', 'rarity', 'hp']);
    expect(table.records).toHaveLength(2);
    expect(table.records[0].cells.get('id')).toBe(1);
    expect(table.records[0].cells.get('hp')).toBe(1200);
    const hp = table.records[1].cells.get('hp');
    expect(hp).toBeInstanceOf(RichCell);
    expect(hp).toMatchObject({ value: 800, color: 'red', comment: '次回調整予定' });
    expect(table.view.column_widths).toEqual([
      ['name', 160],
      ['hp', 80],
    ]);
  });

  it('§1 の差分の例: D2 を 1000 に変えると 1 行だけ変わる', () => {
    const table = load('tables/character.yaml', SPEC_YAML);
    const hp = table.records[1].cells.get('hp') as RichCell;
    hp.value = 1000;
    const after = serializeTable(table, defaultBaseFields(), 'yaml');
    const before = SPEC_YAML.split('\n');
    const lines = after.split('\n');
    expect(lines).toHaveLength(before.length);
    const diff = lines.flatMap((line, i) => (line === before[i] ? [] : [[before[i], line]]));
    expect(diff).toEqual([
      [
        '    hp: { value: 800, color: red, comment: 次回調整予定 }',
        '    hp: { value: 1000, color: red, comment: 次回調整予定 }',
      ],
    ]);
  });
});
