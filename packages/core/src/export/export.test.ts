import { describe, expect, it } from 'vitest';
import { parse as parseYamlLib } from 'yaml';
import { Calculator } from '../calc';
import { loadSample, testProject } from '../calc/test-project';
import { ExportCode } from './codes';
import { planExport } from './index';

const CHARACTER_JSON = `[
  {
    "id": 1,
    "version": null,
    "name": "勇者アルス",
    "rarity": "SSR",
    "hp": 1200,
    "defense": 30,
    "effective_hp": 1560,
    "skill_ids": [1, 3],
    "element": ["火", "光"],
    "start_at": "2026-10-13T12:00:00+09:00",
    "power": 9007199254740993,
    "code": "NO"
  },
  {
    "id": 2,
    "version": null,
    "name": "魔法使いリナ",
    "rarity": "SR",
    "hp": 800,
    "defense": 10,
    "effective_hp": 1600,
    "skill_ids": [1, 2],
    "element": ["水"],
    "start_at": "2026-10-20T00:00:00+09:00",
    "power": 12000,
    "code": "1.10"
  },
  {
    "id": 3,
    "version": "0.1.2",
    "name": "盗賊カイ",
    "rarity": "R",
    "hp": 650,
    "defense": 0,
    "effective_hp": 650,
    "skill_ids": null,
    "element": ["風", "闇"],
    "start_at": null,
    "power": 800,
    "code": "null"
  }
]
`;

const STAGE_YAML = `- id: 1
  version: "0.1.2"
  name: stage_01
  boss_id: 3
- id: 2
  version: "0.1.11"
  name: stage_02
  boss_id: 2
`;

describe('サンプルの出力（FR-OUT-01〜04）', () => {
  for (const sample of ['basic-yaml', 'basic-json']) {
    it(`${sample}: 正規形の JSON。export: false の列は無く、式は計算結果、未入力は default か null`, async () => {
      const project = await loadSample(sample);
      const calc = new Calculator(project);
      const result = planExport(project, calc);
      expect(result.ok).toBe(true);
      expect(result.diagnostics).toEqual([]);
      expect(result.files.map((f) => f.path)).toEqual(['build/character.json', 'build/skill.json', 'build/stage.json']);
      expect(result.files[0].text).toBe(CHARACTER_JSON);
      expect(result.files[0].text).not.toContain('memo');
      // 同じ入力からは必ず同じ出力（FR-OUT-03）
      expect(planExport(project, new Calculator(project))).toEqual(result);
    });
  }

  it('YAML の出力: トップレベルはシーケンス、1 フィールド 1 行、リストはフロー、DR-41 の引用', async () => {
    const project = await loadSample('basic-yaml');
    const calc = new Calculator(project);
    const result = planExport(project, calc, { format: 'yaml', outDir: 'out/yaml' });
    expect(result.files.map((f) => f.path)).toEqual(['out/yaml/character.yaml', 'out/yaml/skill.yaml', 'out/yaml/stage.yaml']);
    const character = result.files[0].text;
    expect(character.split('\n').slice(0, 13)).toEqual([
      '- id: 1',
      '  version: null',
      '  name: 勇者アルス',
      '  rarity: SSR',
      '  hp: 1200',
      '  defense: 30',
      '  effective_hp: 1560',
      '  skill_ids: [1, 3]',
      '  element: [火, 光]',
      '  start_at: "2026-10-13T12:00:00+09:00"',
      '  power: 9007199254740993',
      '  code: "NO"',
      '- id: 2',
    ]);
    expect(character).toContain('\n  code: "1.10"\n');
    expect(character).toContain('\n  code: "null"\n');
    expect(result.files[2].text).toBe(STAGE_YAML);
    // YAML 1.1 と 1.2 のどちらで読んでも、文字列は文字列のまま
    for (const version of ['1.1', '1.2'] as const) {
      const rows = parseYamlLib(character, { version, intAsBigInt: true }) as Record<string, unknown>[];
      expect(rows.map((r) => r.code)).toEqual(['NO', '1.10', 'null']);
      expect(rows[0].power).toBe(9007199254740993n);
      expect(rows[2].start_at).toBeNull();
    }
    // JSON と YAML で同じデータ
    const json = planExport(project, calc).files[1].text;
    expect(JSON.parse(json)).toEqual(parseYamlLib(result.files[1].text));
  });
});

describe('§9.1 の例', () => {
  it('effective_hp は 1040。セル色とメモは含めない', async () => {
    const project = await testProject({
      baseFields: 'base_fields:\n  - { name: id, type: int, primary: true, auto: increment }\n',
      tables: {
        character: `fields:
  - { name: hp, type: int }
  - { name: defense, type: int }
  - { name: effective_hp, type: float, formula: hp * (1 + defense / 100) }
records:
  - id: 2
    hp: { value: 800, color: red, comment: 次回調整予定 }
    defense: 30
`,
      },
    });
    const result = planExport(project, new Calculator(project));
    expect(result.files).toEqual([
      {
        path: 'build/character.json',
        table: 'character',
        text: '[\n  {\n    "id": 2,\n    "hp": 800,\n    "defense": 30,\n    "effective_hp": 1040\n  }\n]\n',
      },
    ]);
  });
});

describe('default と null（FR-OUT-04）', () => {
  it('未入力は default があればその値（"" と [] も）、無ければ null。列定義に無いキーは出さない', async () => {
    const project = await testProject({
      baseFields: 'base_fields:\n  - { name: id, type: int, primary: true }\n',
      tables: {
        t: `fields:
  - { name: s, type: string, default: "" }
  - { name: l, type: list<int>, default: [] }
  - { name: n, type: int, default: 5 }
  - { name: none, type: string }
  - { name: hidden, type: string, export: false, default: x }
records:
  - { id: 1, extra_key: 1 }
  - { id: 2, s: a, l: [1], n: 1, none: b, hidden: y }
`,
      },
    });
    const result = planExport(project, new Calculator(project));
    expect(result.ok).toBe(true);
    expect(result.files[0].text).toBe(
      '[\n  {\n    "id": 1,\n    "s": "",\n    "l": [],\n    "n": 5,\n    "none": null\n  },\n' +
        '  {\n    "id": 2,\n    "s": "a",\n    "l": [1],\n    "n": 1,\n    "none": "b"\n  }\n]\n',
    );
    // 列定義に無いキーは読み込み時の警告（DR-34）。警告だけなら出力する
    expect(result.diagnostics.map((d) => `${d.severity} ${d.code}`)).toEqual(['warning io.unknownRecordKey']);
    // キーの n は YAML 1.1 で false と読まれるので引用符で囲む（DR-41）
    expect(planExport(project, new Calculator(project), { format: 'yaml' }).files[0].text).toBe(
      '- id: 1\n  s: ""\n  l: []\n  "n": 5\n  none: null\n- id: 2\n  s: a\n  l: [1]\n  "n": 1\n  none: b\n',
    );
  });

  it('レコードが無ければ空の配列', async () => {
    const project = await testProject({ tables: { t: 'fields: []\nrecords: []\n' } });
    const calc = new Calculator(project);
    expect(planExport(project, calc).files[0].text).toBe('[]\n');
    expect(planExport(project, calc, { format: 'yaml' }).files[0].text).toBe('[]\n');
  });
});

describe('検査エラーと --force（FR-OUT-05）', () => {
  const files = {
    tables: {
      bad: `fields:
  - { name: v, type: int, validation: { max: 10 } }
  - { name: w, type: int, formula: 1 / 0 }
records:
  - { id: 1, v: 11 }
`,
      good: 'fields:\n  - { name: v, type: int }\nrecords:\n  - { id: 1, v: 1 }\n',
      broken: 'fields:\n  - { name: v, type: int, unknown: 1 }\nrecords: []\n',
    },
  };

  it('エラーがあれば出力しない。force なら出力し、式のエラーは null にする。読み込みエラーのテーブルは出力しない', async () => {
    const project = await testProject(files);
    const calc = new Calculator(project);
    const blocked = planExport(project, calc);
    expect(blocked.ok).toBe(false);
    expect(blocked.files).toEqual([]);
    expect(blocked.diagnostics.map((d) => `${d.table} ${d.code}`)).toEqual([
      'bad validate.aboveMax',
      'bad validate.formulaError',
      'broken io.unknownFieldKey',
    ]);

    const forced = planExport(project, calc, { force: true });
    expect(forced.ok).toBe(true);
    expect(forced.diagnostics).toEqual(blocked.diagnostics);
    expect(forced.files.map((f) => f.path)).toEqual(['build/bad.json', 'build/good.json']);
    expect(forced.files[0].text).toContain('"v": 11,\n    "w": null\n');
  });

  it('テーブルを選べる。選ばなかったテーブルのエラーでは止めない。無いテーブルはエラー', async () => {
    const project = await testProject(files);
    const calc = new Calculator(project);
    const good = planExport(project, calc, { tables: ['good'] });
    expect(good.ok).toBe(true);
    expect(good.files.map((f) => f.path)).toEqual(['build/good.json']);
    const unknown = planExport(project, calc, { tables: ['good', 'nothing'] });
    expect(unknown.ok).toBe(false);
    expect(unknown.diagnostics).toEqual([
      { severity: 'error', code: ExportCode.unknownTable, table: 'nothing', params: { name: 'nothing' } },
    ]);
  });
});
