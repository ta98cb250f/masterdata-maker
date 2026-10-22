// 性能の確認用（NFR-10、NFR-11）: 1 万行 × 50 列のテーブルを含むプロジェクトをメモリ上に生成する（`?sample=large`）。
// 画面テストでは、大きなテーブルの数と大きさを変えて生成する（globalThis.masterdataMakerSamples。main.tsx）
import type { Cell, ColorDef, EnumDef, FieldDef, FieldType, RawValue, StorageFormat, Table, TableRecord } from '@masterdata-maker/core';
import {
  RichCell,
  defaultBaseFields,
  defaultColors,
  emptyView,
  serializeColors,
  serializeEnums,
  serializeTable,
} from '@masterdata-maker/core';

export interface LargeSampleOptions {
  /** 行数（既定 10000） */
  rows?: number;
  /** 列数（共通列の id・version を含む。既定 50） */
  columns?: number;
  format?: StorageFormat;
  /** 大きなテーブルの数（既定 1。1 なら名前は big、2 以上なら big_001 から。どれも skill を参照する） */
  bigTables?: number;
}

const ENUMS: EnumDef[] = [
  { name: 'rarity', display_name: 'レアリティ', values: ['N', 'R', 'SR', 'SSR'] },
  { name: 'element', display_name: '属性', values: ['火', '水', '風', '光', '闇'] },
];

const WORDS = ['勇者', 'スライム', 'dragon', 'Knight', '魔法使い', 'ゴブリン', 'Wizard', '僧侶', '盗賊', 'archer'];

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

const TYPES: FieldType[] = ['string', 'int', 'float', 'enum', 'bool', 'datetime', 'int64', 'list<int>', 'list<string>', 'list<enum>'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function skillTable(uid: () => number): Table {
  const records: TableRecord[] = [];
  for (let i = 1; i <= 50; i++) {
    const cells = new Map<string, Cell>([
      ['id', i],
      ['name', `スキル${i}`],
      ['cost', (i * 7) % 30],
    ]);
    records.push({ uid: uid(), cells, extra: [] });
  }
  return {
    kind: 'table',
    uid: uid(),
    name: 'skill',
    display_name: 'スキル',
    fields: [
      { name: 'name', type: 'string', display_name: '名前' },
      { name: 'cost', type: 'int', display_name: 'コスト' },
    ],
    records,
    view: emptyView(),
    source: null,
    diagnostics: [],
  };
}

function bigTable(rows: number, columns: number, uid: () => number, name = 'big', seed = 42): Table {
  const rand = random(seed);
  const fields: FieldDef[] = [
    { name: 'name', type: 'string', display_name: '名前' },
    { name: 'hp', type: 'int', display_name: 'HP', validation: { min: 1, max: 99999 }, anomaly: { warn_above: 9900 } },
    { name: 'defense', type: 'int', display_name: '防御力', default: 0 },
    { name: 'effective_hp', type: 'float', display_name: '実効HP', formula: 'hp * (1 + defense / 100)' },
    { name: 'skill_ids', type: 'list<int>', display_name: 'スキル', ref: 'skill.id' },
    { name: 'locked', type: 'string', display_name: '編集不可', editable: false },
    { name: 'memo', type: 'string', display_name: 'メモ', export: false },
  ];
  const extra = Math.max(0, columns - 2 - fields.length);
  for (let i = 0; i < extra; i++) {
    const type = TYPES[i % TYPES.length];
    const field: FieldDef = { name: `col_${pad2(i)}`, type, display_name: `列${i}` };
    if (type === 'enum') field.enum_ref = 'rarity';
    if (type === 'list<enum>') field.enum_ref = 'element';
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
        return ENUMS[0].values[Math.floor(rand() * 4)];
      case 'datetime': {
        const day = 1 + Math.floor(rand() * 28);
        const hour = Math.floor(rand() * 24);
        return `2026-10-${pad2(day)}T${pad2(hour)}:00:00+09:00`;
      }
      case 'list<int>':
        return [Math.floor(rand() * 50) + 1, Math.floor(rand() * 50) + 1];
      case 'list<string>':
        return [WORDS[Math.floor(rand() * WORDS.length)], WORDS[Math.floor(rand() * WORDS.length)]];
      case 'list<enum>':
        return [ENUMS[1].values[Math.floor(rand() * 5)]];
      default:
        return `${WORDS[Math.floor(rand() * WORDS.length)]}${Math.floor(rand() * 1000)}`;
    }
  };

  const records: TableRecord[] = [];
  for (let r = 0; r < rows; r++) {
    const cells = new Map<string, Cell>();
    cells.set('id', r + 1);
    if (r % 7 === 0) cells.set('version', `0.${r % 3}.${r % 11}`);
    cells.set('name', `${WORDS[r % WORDS.length]}${r + 1}`);
    // 検査のエラー（min: 1 に反する）と警告（warn_above を超える）も少し混ぜる
    const hp = r % 1000 === 999 ? 0 : 100 + Math.floor(rand() * 9900);
    cells.set('hp', r % 97 === 0 ? new RichCell({ value: hp, color: 'red', comment: '調整中' }) : hp);
    if (r % 3 !== 0) cells.set('defense', Math.floor(rand() * 100));
    if (r % 50 === 0) cells.set('effective_hp', new RichCell({ override: 'hp * 2' }));
    cells.set('skill_ids', [1 + (r % 50), 1 + ((r * 3) % 50)]);
    cells.set('locked', `L${r + 1}`);
    if (r % 5 === 0) cells.set('memo', `メモ${r + 1}`);
    for (const field of fields.slice(7)) {
      if (rand() < 0.1) continue; // 未入力のセルも混ぜる
      cells.set(field.name, value(field.type));
    }
    records.push({ uid: uid(), cells, extra: [] });
  }
  return {
    kind: 'table',
    uid: uid(),
    name,
    display_name: name === 'big' ? '大きなテーブル' : `大きなテーブル ${name.slice(4)}`,
    fields,
    records,
    view: { column_widths: [['name', 140]], frozen_columns: 2 },
    source: null,
    diagnostics: [],
  };
}

/** 生成したプロジェクトのファイル一式（パス → 本文） */
export function generateLargeProjectFiles(options: LargeSampleOptions = {}): Record<string, string> {
  const rows = options.rows ?? 10_000;
  const columns = options.columns ?? 50;
  const format = options.format ?? 'yaml';
  let next = 1;
  const uid = (): number => next++;
  const baseFields = defaultBaseFields();
  const colors: ColorDef[] = defaultColors();
  const ext = format === 'yaml' ? 'yaml' : 'json';
  const config =
    format === 'yaml'
      ? 'format_version: 1\nstorage:\n  format: yaml\ntimezone: Asia/Tokyo\n'
      : '{\n  "format_version": 1,\n  "storage": {\n    "format": "json"\n  },\n  "timezone": "Asia/Tokyo"\n}\n';
  const files: Record<string, string> = {
    [`masterdata-maker.${ext}`]: config,
    [`config/enums.${ext}`]: serializeEnums(ENUMS, format),
    [`config/colors.${ext}`]: serializeColors(colors, format),
  };
  const bigTables = options.bigTables ?? 1;
  files[`tables/skill.${ext}`] = serializeTable(skillTable(uid), baseFields, format);
  for (let i = 1; i <= bigTables; i++) {
    const name = bigTables === 1 ? 'big' : `big_${String(i).padStart(3, '0')}`;
    files[`tables/${name}.${ext}`] = serializeTable(bigTable(rows, columns, uid, name, 41 + i), baseFields, format);
  }
  return files;
}
