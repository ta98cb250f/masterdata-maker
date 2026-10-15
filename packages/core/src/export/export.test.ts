import { describe, expect, it } from 'vitest';
import { parse as parseYamlLib } from 'yaml';
import { Calculator } from '../calc';
import { loadSample, testProject } from '../calc/test-project';
import type { Diagnostic } from '../model/diagnostic';
import { ExportCode } from './codes';
import { formatDiagnostic } from '../validate/format';
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

const SKILL_JSON = `[
  {
    "id": 1,
    "version": null,
    "name": "ファイア",
    "cost": 10,
    "element": "火"
  },
  {
    "id": 2,
    "version": null,
    "name": "ヒール",
    "cost": 8,
    "element": "光"
  },
  {
    "id": 3,
    "version": null,
    "name": "ウィンド",
    "cost": 12,
    "element": "風"
  }
]
`;

const STAGE_JSON = `[
  {
    "id": 1,
    "version": "0.1.2",
    "name": "stage_01",
    "boss_id": 3
  },
  {
    "id": 2,
    "version": "0.1.11",
    "name": "stage_02",
    "boss_id": 2
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
      expect(result.files.map((f) => f.content)).toEqual([CHARACTER_JSON, SKILL_JSON, STAGE_JSON]);
      expect(result.files[0].content).not.toContain('memo');
      // 同じ入力からは必ず同じ出力（FR-OUT-03）
      expect(planExport(project, new Calculator(project))).toEqual(result);
      // エラーが無ければ、force を付けても出力は同じ（P-51 で値が null になるのは型に合わない値だけ）
      expect(planExport(project, new Calculator(project), { force: true })).toEqual(result);
      expect(planExport(project, calc, { format: 'yaml', force: true })).toEqual(planExport(project, calc, { format: 'yaml' }));
    });
  }

  it('YAML の出力: トップレベルはシーケンス、1 フィールド 1 行、リストはフロー、DR-41 の引用', async () => {
    const project = await loadSample('basic-yaml');
    const calc = new Calculator(project);
    const result = planExport(project, calc, { format: 'yaml', outDir: 'out/yaml' });
    expect(result.files.map((f) => f.path)).toEqual(['out/yaml/character.yaml', 'out/yaml/skill.yaml', 'out/yaml/stage.yaml']);
    const character = result.files[0].content as string;
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
    expect(result.files[2].content).toBe(STAGE_YAML);
    // YAML 1.1 と 1.2 のどちらで読んでも、文字列は文字列のまま
    for (const version of ['1.1', '1.2'] as const) {
      const rows = parseYamlLib(character, { version, intAsBigInt: true }) as Record<string, unknown>[];
      expect(rows.map((r) => r.code)).toEqual(['NO', '1.10', 'null']);
      expect(rows[0].power).toBe(9007199254740993n);
      expect(rows[2].start_at).toBeNull();
    }
    // JSON と YAML で同じデータ
    const json = planExport(project, calc).files[1].content as string;
    expect(JSON.parse(json)).toEqual(parseYamlLib(result.files[1].content as string));
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
        content: '[\n  {\n    "id": 2,\n    "hp": 800,\n    "defense": 30,\n    "effective_hp": 1040\n  }\n]\n',
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
    expect(result.files[0].content).toBe(
      '[\n  {\n    "id": 1,\n    "s": "",\n    "l": [],\n    "n": 5,\n    "none": null\n  },\n' +
        '  {\n    "id": 2,\n    "s": "a",\n    "l": [1],\n    "n": 1,\n    "none": "b"\n  }\n]\n',
    );
    // 列定義に無いキーは読み込み時の警告（DR-34）。警告だけなら出力する
    expect(result.diagnostics.map((d) => `${d.severity} ${d.code}`)).toEqual(['warning io.unknownRecordKey']);
    // キーの n は YAML 1.1 で false と読まれるので引用符で囲む（DR-41）
    expect(planExport(project, new Calculator(project), { format: 'yaml' }).files[0].content).toBe(
      '- id: 1\n  s: ""\n  l: []\n  "n": 5\n  none: null\n- id: 2\n  s: a\n  l: [1]\n  "n": 1\n  none: b\n',
    );
  });

  it('レコードが無ければ空の配列', async () => {
    const project = await testProject({ tables: { t: 'fields: []\nrecords: []\n' } });
    const calc = new Calculator(project);
    expect(planExport(project, calc).files[0].content).toBe('[]\n');
    expect(planExport(project, calc, { format: 'yaml' }).files[0].content).toBe('[]\n');
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
    expect(forced.files[0].content).toContain('"v": 11,\n    "w": null\n');
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

describe('--force で出力するときの、型に合わない値（P-51）', () => {
  const baseFields = 'base_fields:\n  - { name: id, type: int, primary: true }\n';

  /** 診断を「主キー 列 コード」の文字列にする */
  const summary = (ds: readonly Diagnostic[]): string[] => ds.map((d) => `${d.recordKey ?? '-'} ${d.field ?? '-'} ${d.code}`);

  it('型に合わない値は null（判定は常に行う検査と同じ。FR-VAL-03）。リストは一部の要素の誤りでも全体を null にする', async () => {
    const project = await testProject({
      baseFields,
      enums: 'enums:\n  - name: kind\n    values: [a, b]\n',
      tables: {
        t: `fields:
  - { name: n, type: int }
  - { name: big, type: int64 }
  - { name: f, type: float }
  - { name: flag, type: bool }
  - { name: kind, type: enum, enum_ref: kind }
  - { name: when, type: datetime }
  - { name: nums, type: list<int> }
  - { name: kinds, type: list<enum>, enum_ref: kind }
  - { name: d, type: int, default: abc }
  - { name: e, type: enum, enum_ref: kind, default: "" }
records:
  - { id: 1, n: 1, big: 2, f: 1.5, flag: true, kind: a, when: "2026-10-13T12:00:00+09:00", nums: [1, 2], kinds: [a, b], d: 3, e: b }
  - { id: 2, n: abc, big: 9223372036854775808, f: x, flag: 1, kind: zzz, when: "2026-10-13 12:00", nums: [1, x], kinds: [a, zzz] }
  - { id: 3, n: 1.5, when: "2026-13-01T00:00:00+09:00", nums: [1, 2.5] }
  - { id: 4, n: 9007199254740992, nums: 3 }
`,
      },
    });
    const calc = new Calculator(project);
    expect(planExport(project, calc).ok).toBe(false);
    const forced = planExport(project, calc, { force: true });
    expect(forced.ok).toBe(true);
    // null にした値は、どれも検査で型のエラーになっている
    expect(summary(forced.diagnostics)).toEqual([
      '- d validate.invalidDefault',
      '2 n validate.typeMismatch',
      '2 big validate.intOutOfRange',
      '2 f validate.typeMismatch',
      '2 flag validate.typeMismatch',
      '2 kind validate.notInEnum',
      '2 when validate.invalidDateTime',
      '2 nums validate.listElementTypeMismatch',
      '2 kinds validate.listElementNotInEnum',
      '3 n validate.notInteger',
      '3 when validate.invalidDateTime',
      '3 nums validate.listElementNotInteger',
      '4 n validate.intOutOfRange',
      '4 nums validate.typeMismatch',
    ]);
    const empty = { n: null, big: null, f: null, flag: null, kind: null, when: null, nums: null, kinds: null, d: null, e: '' };
    expect(JSON.parse(forced.files[0].content as string)).toEqual([
      { id: 1, n: 1, big: 2, f: 1.5, flag: true, kind: 'a', when: '2026-10-13T12:00:00+09:00', nums: [1, 2], kinds: ['a', 'b'], d: 3, e: 'b' },
      // 型に合わない default（d の abc）も null。default に書ける ""（e）はそのまま
      { id: 2, ...empty },
      { id: 3, ...empty },
      { id: 4, ...empty },
    ]);
    const yaml = planExport(project, calc, { force: true, format: 'yaml' }).files[0].content as string;
    expect(yaml.split('\n').slice(11, 22)).toEqual([
      '- id: 2',
      '  "n": null',
      '  big: null',
      '  f: null',
      '  flag: null',
      '  kind: null',
      '  when: null',
      '  nums: null',
      '  kinds: null',
      '  d: null',
      '  e: ""',
    ]);
  });

  it('検査ルールの違反・警告・ref の参照先が無い値は、型に合っているのでそのまま出す', async () => {
    const project = await testProject({
      baseFields,
      tables: {
        skill: 'fields: []\nrecords:\n  - { id: 1 }\n',
        t: `fields:
  - { name: name, type: string, validation: { required: true, max_length: 3, regex: "^[a-z]+$" } }
  - { name: hp, type: int, validation: { min: 1, max: 100 }, anomaly: { warn_above: 50 } }
  - { name: code, type: string, validation: { unique: true } }
  - { name: tags, type: list<string>, validation: { max_items: 1 } }
  - { name: when, type: datetime, validation: { min: "2026-01-01T00:00:00+09:00" } }
  - { name: skill, type: int, ref: skill.id }
  - { name: skills, type: list<int>, ref: skill.id }
records:
  - { id: 1, name: ABCD, hp: 0, code: x, tags: [a, b], when: "2025-12-31T00:00:00+09:00", skill: 9, skills: [1, 9] }
  - { id: 2, hp: 101, code: x }
  - { id: 3, name: ok, hp: 60, skills: [1] }
`,
      },
    });
    const calc = new Calculator(project);
    expect(planExport(project, calc).ok).toBe(false);
    const forced = planExport(project, calc, { force: true, tables: ['t'] });
    expect(forced.ok).toBe(true);
    expect(summary(forced.diagnostics)).toEqual([
      '1 name validate.tooLong',
      '1 name validate.regexMismatch',
      '1 hp validate.belowMin',
      '1 code validate.duplicateValue',
      '1 tags validate.tooManyItems',
      '1 when validate.belowMin',
      '1 skill validate.refNotFound',
      '1 skills validate.listElementRefNotFound',
      '2 name validate.required',
      '2 hp validate.aboveMax',
      '2 hp validate.warnAbove',
      '2 code validate.duplicateValue',
      '3 hp validate.warnAbove',
    ]);
    expect(JSON.parse(forced.files[0].content as string)).toEqual([
      { id: 1, name: 'ABCD', hp: 0, code: 'x', tags: ['a', 'b'], when: '2025-12-31T00:00:00+09:00', skill: 9, skills: [1, 9] },
      // required の違反は未入力なので null（FR-OUT-04）
      { id: 2, name: null, hp: 101, code: 'x', tags: null, when: null, skill: null, skills: null },
      { id: 3, name: 'ok', hp: 60, code: null, tags: null, when: null, skill: null, skills: [1] },
    ]);
  });
});

describe('版を指定した出力（FR-OUT-07、P-64）', () => {
  const ids = (text: string | Uint8Array): unknown[] => (JSON.parse(text as string) as { id: unknown }[]).map((r) => r.id);

  it('version が指定の版以下のレコードだけを出す。比較は semver（0.1.2 < 0.1.11）で、未入力は常に出す', async () => {
    const project = await loadSample('basic-yaml');
    const calc = new Calculator(project);
    const at = (version: string) => {
      const result = planExport(project, calc, { version, tables: ['character', 'stage'] });
      expect(result.ok).toBe(true);
      return Object.fromEntries(result.files.map((f) => [f.table, ids(f.content)]));
    };
    expect(at('0.1.11')).toEqual({ character: [1, 2, 3], stage: [1, 2] });
    expect(at('0.1.10')).toEqual({ character: [1, 2, 3], stage: [1] });
    expect(at('0.1.2')).toEqual({ character: [1, 2, 3], stage: [1] });
    // プレリリースの版は、その版より前（0.1.2-rc.1 < 0.1.2）
    expect(at('0.1.2-rc.1')).toEqual({ character: [1, 2], stage: [] });
    // 版を指定しなければすべて
    const all = planExport(project, calc, { tables: ['stage'] });
    expect(ids(all.files[0].content)).toEqual([1, 2]);
  });

  const files = {
    tables: {
      skill: `fields:
  - { name: cost, type: int }
records:
  - { id: 1, cost: 10 }
  - { id: 2, version: "1.1.0", cost: 20 }
`,
      unit: `fields:
  - { name: skill_id, type: int, ref: skill.id }
  - { name: cost, type: int, formula: 'REF("skill", skill_id, "cost")' }
records:
  - { id: 1, version: "1.0.0", skill_id: 1 }
  - { id: 2, version: "1.0.0", skill_id: 2 }
  - { id: 3, version: "1.1.0", skill_id: 2 }
`,
    },
  };

  it('残したレコードが、版で除いたレコードを ref や REF で参照していればエラー（force なら出力する）', async () => {
    const project = await testProject(files);
    const calc = new Calculator(project);
    expect(planExport(project, calc, { version: '1.1.0' }).ok).toBe(true);
    const blocked = planExport(project, calc, { version: '1.0.0' });
    expect(blocked.ok).toBe(false);
    expect(blocked.diagnostics.map((d) => `${d.table} ${d.recordKey} ${d.field} ${d.code}`)).toEqual([
      'unit 2 skill_id validate.refNotFound',
      'unit 2 cost validate.formulaErrorPropagated',
    ]);
    const forced = planExport(project, calc, { version: '1.0.0', force: true });
    expect(forced.ok).toBe(true);
    expect(forced.files.map((f) => [f.table, ids(f.content)])).toEqual([
      ['skill', [1]],
      ['unit', [1, 2]],
    ]);
    // 元のプロジェクトはそのまま（版を指定しない出力は全レコード）
    expect(planExport(project, calc).files.map((f) => ids(f.content))).toEqual([
      [1, 2],
      [1, 2, 3],
    ]);
  });

  it('semver として読めない version はエラーにして出力から除く。指定の版が読めなければ force でも出力しない', async () => {
    const project = await testProject({
      tables: { t: 'fields: []\nrecords:\n  - { id: 1, version: "1.0" }\n  - { id: 2, version: "1.0.0" }\n' },
    });
    const calc = new Calculator(project);
    const blocked = planExport(project, calc, { version: '2.0.0' });
    expect(blocked.ok).toBe(false);
    expect(blocked.diagnostics).toEqual([
      {
        severity: 'error',
        code: ExportCode.invalidRecordVersion,
        file: 'tables/t.yaml',
        table: 't',
        recordUid: project.tables[0].records[0].uid,
        recordKey: '1',
        field: 'version',
        params: { value: '1.0' },
      },
    ]);
    const forced = planExport(project, calc, { version: '2.0.0', force: true });
    expect(ids(forced.files[0].content)).toEqual([2]);
    // 版を指定しなければ version の書式は問わない
    expect(planExport(project, calc).ok).toBe(true);

    const invalid = planExport(project, calc, { version: 'v1', force: true });
    expect(invalid).toEqual({
      ok: false,
      blocked: true,
      files: [],
      diagnostics: [{ severity: 'error', code: ExportCode.invalidVersion, params: { value: 'v1' } }],
    });
  });

  it('比べるのは実効値（default があればその値）。ビルドメタデータは無視し、プレリリースの版は正式版より前', async () => {
    const project = await testProject({
      baseFields: 'base_fields:\n  - { name: id, type: int, primary: true }\n  - { name: version, type: string, default: "2.0.0" }\n',
      tables: { t: 'fields: []\nrecords:\n  - { id: 1 }\n  - { id: 2, version: "1.0.0+b" }\n  - { id: 3, version: "1.0.0" }\n' },
    });
    const calc = new Calculator(project);
    const at = (version: string) => ids(planExport(project, calc, { version }).files[0].content);
    expect(at('1.0.0')).toEqual([2, 3]);
    expect(at('1.0.0-rc.1')).toEqual([]);
    expect(at('2.0.0')).toEqual([1, 2, 3]);
  });

  it('選ばなかったテーブルでも、選んだテーブルから参照していれば、版を比べられなかったレコードを示す', async () => {
    const project = await testProject({
      tables: {
        skill: 'fields: []\nrecords:\n  - { id: 1, version: "1.0" }\n',
        unit: 'fields:\n  - { name: skill_id, type: int, ref: skill.id }\nrecords:\n  - { id: 1, version: "1.0.0", skill_id: 1 }\n',
        other: 'fields: []\nrecords:\n  - { id: 1, version: "x" }\n',
      },
    });
    const result = planExport(project, new Calculator(project), { version: '1.0.0', tables: ['unit'] });
    expect(result.diagnostics.map((d) => `${d.table} ${d.recordKey} ${d.field} ${d.code}`)).toEqual([
      'unit 1 skill_id validate.refNotFound',
      'skill 1 version export.invalidRecordVersion',
    ]);
    expect(formatDiagnostic(result.diagnostics[1], 'en')).toBe(
      'The version value 1.0 is not in semantic versioning format (e.g. 1.2.3), so it cannot be compared when exporting a specific version (this record is not exported)',
    );
  });

  it('version の式がエラーなら、検査と同じ式のエラーとして示し、そのレコードは出さない', async () => {
    const project = await testProject({
      tables: { t: 'fields: []\nrecords:\n  - { id: 1, version: { override: "1 / 0" } }\n  - { id: 2, version: "1.0.0" }\n' },
    });
    const calc = new Calculator(project);
    const result = planExport(project, calc, { version: '1.0.0', force: true });
    expect(result.diagnostics.map((d) => `${d.recordKey} ${d.field} ${d.code} ${d.params?.error}`)).toEqual(['1 version validate.formulaError #DIV/0!']);
    expect(ids(result.files[0].content)).toEqual([2]);
    expect(formatDiagnostic(planExport(project, calc, { version: 'v1' }).diagnostics[0], 'en')).toBe(
      'The version to export, v1, is not in semantic versioning format (e.g. 1.2.3)',
    );
  });
});
