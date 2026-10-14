import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../model/diagnostic';
import { Calculator } from '../calc';
import { MemoryProjectFs } from '../io/memory-fs';
import { loadProject } from '../io/project';
import { loadSample, tableOf, testProject } from '../calc/test-project';
import type { TestProjectFiles } from '../calc/test-project';
import { ValidateCode as V } from './codes';
import { affectedTables, formatDiagnostic, validateProject, validateTable, validationDependencies } from './index';

/** 診断を「重大度 主キー 列 コード」の文字列にする（比べやすくするため） */
function summary(ds: readonly Diagnostic[]): string[] {
  return ds.map((d) => `${d.severity} ${d.recordKey ?? '-'} ${d.field ?? '-'} ${d.code}`);
}

async function validate(files: TestProjectFiles, table = 't'): Promise<Diagnostic[]> {
  const project = await testProject(files);
  return validateTable(project, new Calculator(project), tableOf(project, table));
}

const SKILL = `fields:
  - { name: cost, type: int }
records:
  - { id: 1, cost: 10 }
  - { id: 2, cost: 8 }
`;

describe('サンプル', () => {
  for (const sample of ['basic-yaml', 'basic-json']) {
    it(`${sample}: エラーも警告も無い`, async () => {
      const project = await loadSample(sample);
      expect(validateProject(project, new Calculator(project))).toEqual([]);
    });
  }

  it('サンプルの値を変えると、検査で見つかる（実効値を検査する。FR-VAL-02）', async () => {
    const project = await loadSample('basic-yaml');
    const character = tableOf(project, 'character');
    const r3 = character.records[2];
    r3.cells.set('hp', 6000); // warn_above 5000
    r3.cells.set('skill_ids', [1, 9]); // skill 9 は無い
    r3.cells.set('code', 'NO'); // unique
    r3.cells.delete('name'); // required
    const ds = validateTable(project, new Calculator(project), character);
    expect(summary(ds)).toEqual([
      'error 1 code validate.duplicateValue',
      'error 3 name validate.required',
      'warning 3 hp validate.warnAbove',
      'error 3 skill_ids validate.listElementRefNotFound',
      'error 3 code validate.duplicateValue',
    ]);
    expect(ds[3]).toEqual({
      severity: 'error',
      code: V.listElementRefNotFound,
      params: { index: 2, value: '9', ref: 'skill.id' },
      file: 'tables/character.yaml',
      table: 'character',
      recordUid: r3.uid,
      recordKey: '3',
      field: 'skill_ids',
    });
    expect(formatDiagnostic(ds[3])).toBe('2 番目の要素 9 が参照先 skill.id にありません');
  });
});

describe('常に行う検査（FR-VAL-03）', () => {
  it('型・整数の範囲・datetime の形式・列挙型・リストの要素・参照先・主キー', async () => {
    const ds = await validate({
      enums: 'enums:\n  - name: kind\n    values: [a, b]\n',
      tables: {
        skill: SKILL,
        t: `fields:
  - { name: n, type: int }
  - { name: big, type: int64 }
  - { name: f, type: float }
  - { name: flag, type: bool }
  - { name: kind, type: enum, enum_ref: kind }
  - { name: kinds, type: list<enum>, enum_ref: kind }
  - { name: when, type: datetime }
  - { name: nums, type: list<int> }
  - { name: skill, type: int, ref: skill.id }
  - { name: skills, type: list<int>, ref: skill.id }
records:
  - { id: 1, n: 1, big: 1, f: 1.5, flag: true, kind: a, kinds: [a, b], when: "2026-10-13T12:00:00+09:00", nums: [1], skill: 1, skills: [1, 2] }
  - { id: 2, n: abc, big: 9223372036854775808, f: x, flag: 1, kind: zzz, kinds: [a, zzz], when: "2026-13-01T00:00:00+09:00", nums: [1, 2.5, x], skill: 9, skills: [2, 9] }
  - { id: 3, n: 1.5, big: -9223372036854775808, when: "2026-10-13 12:00", nums: 3 }
  - { id: 4, n: 9007199254740992 }
  - { id: 4 }
  - { n: 1 }
`,
      },
    });
    expect(summary(ds)).toEqual([
      'error 2 n validate.typeMismatch',
      'error 2 big validate.intOutOfRange',
      'error 2 f validate.typeMismatch',
      'error 2 flag validate.typeMismatch',
      'error 2 kind validate.notInEnum',
      'error 2 kinds validate.listElementNotInEnum',
      'error 2 when validate.invalidDateTime',
      'error 2 nums validate.listElementNotInteger',
      'error 2 nums validate.listElementTypeMismatch',
      'error 2 skill validate.refNotFound',
      'error 2 skills validate.listElementRefNotFound',
      'error 3 n validate.notInteger',
      'error 3 big validate.intOutOfRange',
      'error 3 when validate.invalidDateTime',
      'error 3 nums validate.typeMismatch',
      'error 4 id validate.primaryKeyDuplicate',
      'error 4 n validate.intOutOfRange',
      'error 4 id validate.primaryKeyDuplicate',
      'error - id validate.primaryKeyMissing',
    ]);
    const byCode = (code: string) => ds.find((d) => d.code === code)?.params;
    expect(byCode(V.typeMismatch)).toEqual({ expected: 'int', actual: 'string', value: 'abc' });
    expect(byCode(V.intOutOfRange)).toEqual({ expected: 'int64', value: '9223372036854775808', limit: '±9,223,372,036,854,775,807' });
    expect(byCode(V.listElementNotInEnum)).toEqual({ index: 2, value: 'zzz', enum: 'kind' });
    expect(byCode(V.primaryKeyDuplicate)).toEqual({ value: '4', count: 2 });
  });
});

describe('列ごとのルール（FR-VAL-04）と警告（FR-VAL-05）', () => {
  it('required・min・max・max_length・max_items・regex・unique（リストは要素ごと）', async () => {
    const ds = await validate({
      tables: {
        t: `fields:
  - { name: name, type: string, validation: { required: true, max_length: 5 } }
  - { name: price, type: int, default: 1, validation: { required: true, min: 0, max: 100 } }
  - { name: big, type: int64, validation: { max: 9007199254740993 } }
  - { name: rate, type: float, validation: { min: 0.5 } }
  - { name: when, type: datetime, validation: { min: "2026-01-01T00:00:00+09:00", max: "2026-12-31T23:59:59+09:00" } }
  - { name: code, type: string, validation: { regex: "^[a-z]+$", unique: true } }
  - { name: tags, type: list<string>, validation: { max_length: 3, max_items: 2, regex: "^#" } }
  - { name: scores, type: list<int>, validation: { min: 1, max: 9 } }
records:
  - { id: 1, name: "😀😀😀😀😀", big: 9007199254740993, rate: 0.5, when: "2026-01-01T00:00:00+09:00", code: abc, tags: ["#a"], scores: [1, 9] }
  - { id: 2, name: "😀😀😀😀😀😀", price: 101, big: 9007199254740994, rate: 0.25, when: "2025-12-31T23:59:59+09:00", code: abc, tags: ["#abcd", x, "#b"], scores: [0, 10] }
  - { id: 3, price: -1, when: "2026-12-31T15:00:00Z", code: ABC }
  - { id: 4, code: xyz-1 }
`,
      },
    });
    expect(summary(ds)).toEqual([
      'error 1 code validate.duplicateValue',
      'error 2 name validate.tooLong',
      'error 2 price validate.aboveMax',
      'error 2 big validate.aboveMax',
      'error 2 rate validate.belowMin',
      'error 2 when validate.belowMin',
      'error 2 code validate.duplicateValue',
      'error 2 tags validate.listElementTooLong',
      'error 2 tags validate.listElementRegexMismatch',
      'error 2 tags validate.tooManyItems',
      'error 2 scores validate.listElementBelowMin',
      'error 2 scores validate.listElementAboveMax',
      'error 3 name validate.required',
      'error 3 price validate.belowMin',
      'error 3 when validate.aboveMax',
      'error 3 code validate.regexMismatch',
      'error 4 name validate.required',
      'error 4 code validate.regexMismatch',
    ]);
    const params = (code: string) => ds.filter((d) => d.code === code).map((d) => d.params);
    // 文字数はコードポイントで数える
    expect(params(V.tooLong)).toEqual([{ length: 6, max: 5 }]);
    expect(params(V.listElementTooLong)).toEqual([{ index: 1, length: 5, max: 3 }]);
    expect(params(V.listElementRegexMismatch)).toEqual([{ index: 2, value: 'x', pattern: '^#' }]);
    expect(params(V.listElementAboveMax)).toEqual([{ index: 2, value: '10', max: '9' }]);
    // default があれば required の列が未入力でもエラーにならない（P-10）。id 3・4 の price は default 1
    expect(ds.some((d) => d.recordKey === '1' && d.field === 'price')).toBe(false);
  });

  it('unique は未入力を対象外にし、式の結果も含めて重複を見つける', async () => {
    const ds = await validate({
      tables: {
        t: `fields:
  - { name: code, type: string, validation: { unique: true } }
  - { name: n, type: int64, formula: id - id + 1, validation: { unique: true } }
records:
  - { id: 1 }
  - { id: 2 }
  - { id: 3, n: 1 }
`,
      },
    });
    expect(summary(ds)).toEqual([
      'error 1 n validate.duplicateValue',
      'error 2 n validate.duplicateValue',
      'error 3 n validate.duplicateValue',
    ]);
    expect(ds[0].params).toEqual({ value: '1', count: 3 });
  });

  it('warn_above・warn_below・warn_deviation（母標準偏差）', async () => {
    const ds = await validate({
      tables: {
        t: `fields:
  - { name: v, type: int, anomaly: { warn_above: 90, warn_below: 5, warn_deviation: 1.5 } }
  - { name: same, type: float, anomaly: { warn_deviation: 0.1 } }
  - { name: one, type: int, anomaly: { warn_deviation: 0.1 } }
  - { name: list, type: list<float>, anomaly: { warn_above: 1.5 } }
records:
  - { id: 1, v: 10, same: 1, one: 5, list: [1, 2] }
  - { id: 2, v: 10, same: 1 }
  - { id: 3, v: 10, same: 1 }
  - { id: 4, v: 4, same: 1 }
  - { id: 5, v: 100, same: 1 }
`,
      },
    });
    // v: 平均 26.8、標準偏差 36.67…。100 だけが 1.5 倍を超えて離れる。same は標準偏差 0、one は値が 1 つなので判定しない
    expect(summary(ds)).toEqual([
      'warning 1 list validate.listElementWarnAbove',
      'warning 4 v validate.warnBelow',
      'warning 5 v validate.warnAbove',
      'warning 5 v validate.warnDeviation',
    ]);
    expect(ds[3].params).toEqual({ value: '100', mean: '26.8', sd: '36.6737', k: 1.5 });
    expect(formatDiagnostic(ds[3])).toBe('値 100 が列の平均 26.8 から標準偏差 36.6737 の 1.5 倍を超えて離れています');
  });
});

describe('式のエラー（FR-FML-13）', () => {
  it('エラーの種類・列・主キー・式の中の位置を持つ', async () => {
    const project = await testProject({
      tables: {
        t: `fields:
  - { name: zero, type: int }
  - { name: div, type: float, formula: 2 + 1 / zero }
  - { name: next, type: float, formula: 1 + div }
  - { name: half, type: int, formula: 3 / 2 }
  - { name: cell, type: int }
  - { name: a, type: int, formula: b }
  - { name: b, type: int, formula: a }
  - { name: text, type: int, formula: zero * 2 }
records:
  - { id: 1, zero: 0, cell: { override: "1 +" } }
  - { id: 2, zero: 1, half: 1, a: 1 }
  - { id: 3, zero: x, half: 2, a: 1 }
`,
      },
    });
    const calc = new Calculator(project);
    const ds = validateTable(project, calc, tableOf(project, 't'));
    expect(summary(ds)).toEqual([
      'error 1 div validate.formulaError',
      'error 1 next validate.formulaErrorPropagated',
      'error 1 half validate.formulaResultType',
      'error 1 cell validate.formulaError',
      'error 1 a validate.formulaErrorPropagated',
      'error 1 b validate.formulaErrorPropagated',
      'error 3 zero validate.typeMismatch',
      'error 3 div validate.formulaError',
      'error 3 next validate.formulaErrorPropagated',
      'error 3 text validate.formulaError',
    ]);
    const [div, next, half, cell, a] = ds;
    expect(div.params).toEqual({ error: '#DIV/0!', position: 5, cause: 'formula.divByZero' });
    expect(formatDiagnostic(div)).toBe('式のエラー #DIV/0!（5 文字目）: 0 で割ることはできません');
    expect(formatDiagnostic(div, 'en')).toBe('Formula error #DIV/0! (at position 5): Division by zero');
    expect(next.params).toEqual({ error: '#DIV/0!', position: 5, cause: 'formula.divByZero' });
    expect(half.params).toEqual({ error: '#VALUE!', cause: 'formula.result.notInteger', 'cause.expected': 'int', 'cause.value': '1.5' });
    expect(formatDiagnostic(half)).toBe('式の結果が列の型に合いません #VALUE!: 式の結果 1.5 は整数ではありません（列の型: int）');
    expect(cell.params?.error).toBe('#ERROR!');
    expect(a.params).toEqual({ error: '#REF!', position: 1, cause: 'formula.circular' });
  });
});

describe('列定義の検査（FR-VAL-07）', () => {
  it('列名・列挙型・ref・式・主キー・auto・ルールと型・default', async () => {
    const ds = await validate({
      enums: 'enums:\n  - name: kind\n    values: [a, b]\n',
      tables: {
        skill: `fields:
  - { name: cost, type: int }
  - { name: code, type: string, validation: { unique: true } }
records: []
`,
        t: `fields:
  - { name: x, type: int }
  - { name: x, type: int }
  - { name: id, type: int }
  - { name: Bad, type: int }
  - { name: 1x, type: int }
  - { name: "true", type: int }
  - { name: e1, type: enum }
  - { name: e2, type: list<enum>, enum_ref: nothing }
  - { name: r1, type: int, ref: skill }
  - { name: r2, type: int, ref: nothing.id }
  - { name: r3, type: int, ref: skill.nothing }
  - { name: r4, type: int, ref: skill.cost }
  - { name: r5, type: string, ref: skill.id }
  - { name: r6, type: list<int>, ref: skill.id }
  - { name: r7, type: list<string>, ref: skill.code }
  - { name: f1, type: int, formula: "1 +" }
  - { name: f2, type: int, formula: nothing + 1 }
  - { name: f3, type: int, formula: FOO(1) + RAND() + ROUND() }
  - { name: f4, type: int, formula: 'REF("nothing", 1, "x") + REF("skill", 1, "price") + REF(x, 1, "cost")' }
  - { name: f5, type: int, formula: 'X + REF("skill", 1, "COST")' }
  - { name: p, type: int, primary: true }
  - { name: au, type: string, auto: increment }
  - { name: v1, type: string, validation: { min: 1, max_items: 2 }, anomaly: { warn_above: 1 } }
  - { name: v2, type: int, validation: { max_length: 1, regex: "a" }, anomaly: { warn_deviation: 0 } }
  - { name: v3, type: string, validation: { regex: "(" } }
  - { name: v4, type: int, validation: { min: 10, max: 1 } }
  - { name: v5, type: datetime, validation: { min: "2026-01-01" } }
  - { name: v6, type: int, validation: { min: abc } }
  - { name: v7, type: list<int>, validation: { max_items: -1 }, anomaly: { warn_deviation: 2 } }
  - { name: d1, type: int, default: abc }
  - { name: d2, type: enum, enum_ref: kind, default: zzz }
  - { name: d3, type: string, default: "" }
  - { name: d4, type: list<int>, default: [] }
  - { name: d5, type: enum, enum_ref: kind, default: "" }
records: []
`,
      },
    });
    expect(summary(ds)).toEqual([
      'error - x validate.duplicateColumn',
      'error - id validate.duplicateBaseColumn',
      'error - Bad validate.invalidColumnName',
      'error - 1x validate.invalidColumnName',
      'error - true validate.invalidColumnName',
      'error - e1 validate.enumRefMissing',
      'error - e2 validate.enumNotFound',
      'error - r1 validate.refInvalidFormat',
      'error - r2 validate.refTableNotFound',
      'error - r3 validate.refColumnNotFound',
      'error - r4 validate.refTargetNotUnique',
      'error - r5 validate.refTypeMismatch',
      'error - f1 validate.columnFormulaError',
      'error - f2 validate.columnFormulaError',
      'error - f3 validate.columnFormulaError',
      'error - f3 validate.columnFormulaError',
      'error - f3 validate.columnFormulaError',
      'error - f4 validate.columnFormulaError',
      'error - f4 validate.columnFormulaError',
      'error - f4 validate.columnFormulaError',
      'error - au validate.autoNotAllowed',
      'error - v1 validate.ruleNotApplicable',
      'error - v1 validate.ruleNotApplicable',
      'error - v1 validate.ruleNotApplicable',
      'error - v2 validate.ruleNotApplicable',
      'error - v2 validate.ruleNotApplicable',
      'error - v2 validate.invalidRuleValue',
      'error - v3 validate.invalidRegex',
      'error - v4 validate.minGreaterThanMax',
      'error - v5 validate.invalidRuleValue',
      'error - v6 validate.invalidRuleValue',
      'error - v7 validate.invalidRuleValue',
      'error - v7 validate.ruleNotApplicable',
      'error - d1 validate.invalidDefault',
      'error - d2 validate.invalidDefault',
      'error - p validate.multiplePrimary',
    ]);
    const causes = ds.filter((d) => d.field?.startsWith('f')).map((d) => d.params?.cause);
    expect(causes).toEqual([
      'formula.syntax.unexpectedEnd',
      'formula.unknownColumn',
      'formula.unknownFunction',
      'formula.volatileFunction',
      'formula.argCount.range',
      'formula.ref.tableNotFound',
      'formula.ref.columnNotFound',
      'formula.ref.literalRequired',
    ]);
    const d1 = ds.find((d) => d.field === 'd1');
    expect(d1?.params).toEqual({
      value: 'abc',
      cause: V.typeMismatch,
      'cause.expected': 'int',
      'cause.actual': 'string',
      'cause.value': 'abc',
    });
    if (d1 !== undefined) {
      expect(formatDiagnostic(d1)).toBe('default の値 abc が列の型に合いません: int の列に string の値「abc」があります');
    }
    expect(ds.find((d) => d.field === 'p')?.params).toEqual({ fields: 'id, p' });
  });

  it('列レベル式の静的なエラーはセルごとには報告しない', async () => {
    const ds = await validate({
      tables: {
        t: `fields:
  - { name: f, type: int, formula: nothing + 1 }
records:
  - { id: 1 }
  - { id: 2 }
`,
      },
    });
    expect(summary(ds)).toEqual(['error - f validate.columnFormulaError']);
  });
});

describe('プロジェクト全体と共通設定', () => {
  it('読み込み時の診断と共通設定の検査を含める', async () => {
    const project = await testProject({
      enums: 'enums:\n  - name: kind\n    values: [a, b, a]\n  - name: kind\n    values: [c]\n',
      baseFields: 'base_fields:\n  - { name: id, type: int, primary: true }\n  - { name: key, type: string, primary: true }\n  - { name: id, type: int }\n',
      tables: {
        good: 'fields:\n  - { name: v, type: int }\nrecords:\n  - { id: 1, key: a, v: 1, extra: 1 }\n',
        broken: 'fields:\n  - { name: v, type: int, required: true }\nrecords: []\n',
      },
    });
    const ds = validateProject(project, new Calculator(project));
    expect(ds.map((d) => `${d.severity} ${d.file ?? '-'} ${d.table ?? '-'} ${d.field ?? '-'} ${d.code}`)).toEqual([
      'error config/base_fields.yaml - id validate.duplicateColumn',
      'error config/base_fields.yaml - id validate.multiplePrimary',
      'error config/base_fields.yaml - key validate.multiplePrimary',
      'error config/enums.yaml - - validate.duplicateEnumValue',
      'error config/enums.yaml - - validate.duplicateEnum',
      'error tables/broken.yaml broken v io.fieldKeyBelongsToValidation',
      'warning tables/good.yaml good - io.unknownRecordKey',
    ]);
  });
});

describe('検査の依存関係（FR-VAL-09）', () => {
  it('ref と REF の参照先。影響を受けるテーブルは推移的にたどる', async () => {
    const sample = await loadSample('basic-yaml');
    const calc = new Calculator(sample);
    expect(validationDependencies(calc, tableOf(sample, 'character'))).toEqual(['skill']);
    expect(validationDependencies(calc, tableOf(sample, 'stage'))).toEqual(['character']);
    expect(validationDependencies(calc, tableOf(sample, 'skill'))).toEqual([]);
    expect(affectedTables(sample, calc, ['skill'])).toEqual(['character', 'skill', 'stage']);
    expect(affectedTables(sample, calc, ['stage'])).toEqual(['stage']);

    const project = await testProject({
      tables: {
        a: 'fields:\n  - { name: v, type: int, formula: \'REF("b", 1, "v")\' }\nrecords: []\n',
        b: 'fields:\n  - { name: v, type: int }\nrecords:\n  - { id: 1, v: { override: \'REF("c", 1, "v")\' } }\n',
        c: 'fields:\n  - { name: v, type: int }\nrecords: []\n',
      },
    });
    const calc2 = new Calculator(project);
    expect(validationDependencies(calc2, tableOf(project, 'a'))).toEqual(['b']);
    expect(validationDependencies(calc2, tableOf(project, 'b'))).toEqual(['c']);
    expect(affectedTables(project, calc2, ['c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('性能（NFR-12）', () => {
  it('1 万行のテーブルの検査', async () => {
    const host = globalThis as unknown as { performance: { now(): number }; console: { log(message: string): void } };
    const rows = 10_000;
    const records = Array.from(
      { length: rows },
      (_, i) => `  - { id: ${i + 1}, name: n${i}, hp: ${1000 + (i % 500)}, defense: ${i % 100}, skill_ids: [${(i % 3) + 1}], code: c${i} }`,
    ).join('\n');
    const project = await testProject({
      tables: {
        skill: 'fields:\n  - { name: cost, type: int }\nrecords:\n  - { id: 1, cost: 10 }\n  - { id: 2, cost: 8 }\n  - { id: 3, cost: 12 }\n',
        character: `fields:
  - { name: name, type: string, validation: { required: true, max_length: 20 } }
  - { name: hp, type: int, validation: { required: true, min: 1, max: 99999 }, anomaly: { warn_above: 5000, warn_deviation: 3 } }
  - { name: defense, type: int, default: 0, validation: { min: 0, max: 999 } }
  - { name: effective_hp, type: float, formula: hp * (1 + defense / 100) }
  - { name: skill_ids, type: list<int>, ref: skill.id, validation: { max_items: 4 } }
  - { name: cost, type: int, formula: 'SUM(REF("skill", skill_ids, "cost"))' }
  - { name: code, type: string, validation: { regex: "^[a-z0-9]+$", unique: true } }
records:
${records}
`,
      },
    });
    const table = tableOf(project, 'character');
    // 暖機
    validateTable(project, new Calculator(project), table);
    const calc = new Calculator(project);
    let start = host.performance.now();
    const first = validateTable(project, calc, table);
    const cold = host.performance.now() - start;
    // 1 セルを変えて、計算し直しと検査をやり直す
    const record = table.records[5000];
    record.cells.set('hp', 100000);
    start = host.performance.now();
    calc.invalidateCell(table, record.uid, 'hp');
    const after = validateTable(project, calc, table);
    const edit = host.performance.now() - start;
    host.console.log(`[性能] 1 万行の検査: 式の計算を含めて ${cold.toFixed(1)}ms、1 セル編集後の再計算と再検査 ${edit.toFixed(1)}ms`);
    expect(first).toEqual([]);
    expect(summary(after)).toEqual(['error 5001 hp validate.aboveMax', 'warning 5001 hp validate.warnAbove', 'warning 5001 hp validate.warnDeviation']);
    expect(edit).toBeLessThan(1000);
  });
});

describe('性能（NFR-12、D-4 の 1 万行 × 50 列）', () => {
  it('1 セル編集後の再計算と再検査', { timeout: 60_000 }, async () => {
    const host = globalThis as unknown as { performance: { now(): number }; console: { log(message: string): void } };
    const rows = 10_000;
    const types = ['int', 'string', 'float', 'enum', 'list<int>', 'bool', 'datetime', 'int64'];
    const fields: Record<string, unknown>[] = [];
    for (let c = 0; c < 46; c++) {
      const field: Record<string, unknown> = { name: `c${c}`, type: types[c % types.length] };
      if (field.type === 'enum') field.enum_ref = 'kind';
      if (c % 7 === 0 && field.type === 'int') field.validation = { min: 0, max: 100000 };
      if (c % 9 === 1 && field.type === 'string') field.validation = { max_length: 30 };
      fields.push(field);
    }
    fields.push({ name: 'f1', type: 'float', formula: 'c0 * 1.5 + c2' });
    fields.push({ name: 'f2', type: 'string', formula: 'c1 & "-" & c3' });
    const value = (t: string, i: number, c: number): unknown => {
      switch (t) {
        case 'int':
          return (i * 31 + c) % 1000;
        case 'string':
          return `s${i}_${c}`;
        case 'float':
          return ((i + c) % 100) / 4;
        case 'enum':
          return ['a', 'b', 'c'][(i + c) % 3];
        case 'list<int>':
          return [i % 5, c];
        case 'bool':
          return (i + c) % 2 === 0;
        case 'datetime':
          return `2026-10-${String((i % 28) + 1).padStart(2, '0')}T12:00:00+09:00`;
        default:
          return i * 1000 + c;
      }
    };
    const records = Array.from({ length: rows }, (_, i) => {
      const record: Record<string, unknown> = { id: i + 1 };
      for (let c = 0; c < 46; c++) record[`c${c}`] = value(types[c % types.length], i, c);
      return record;
    });
    const fs = new MemoryProjectFs({
      'sheetcraft.json': JSON.stringify({ format_version: 1, storage: { format: 'json' }, timezone: 'Asia/Tokyo' }),
      'config/enums.json': JSON.stringify({ enums: [{ name: 'kind', values: ['a', 'b', 'c'] }] }),
      'tables/wide.json': JSON.stringify({ table: 'wide', fields, records }),
    });
    const loaded = await loadProject(fs);
    if (loaded.status !== 'ok') throw new Error('読み込めない');
    const project = loaded.project;
    const table = tableOf(project, 'wide');
    validateTable(project, new Calculator(project), table);
    const calc = new Calculator(project);
    let start = host.performance.now();
    expect(validateTable(project, calc, table)).toEqual([]);
    const full = host.performance.now() - start;
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const record = table.records[1000 * (i + 1)];
      record.cells.set('c0', 100001);
      start = host.performance.now();
      calc.invalidateCell(table, record.uid, 'c0');
      const ds = validateTable(project, calc, table);
      times.push(host.performance.now() - start);
      expect(ds.map((d) => d.code)).toEqual(Array.from({ length: i + 1 }, () => V.aboveMax));
    }
    host.console.log(
      `[性能] 1 万行 × 50 列の検査: 式の計算を含めて ${full.toFixed(1)}ms、` +
        `1 セル編集後の再計算と再検査 ${times.map((t) => t.toFixed(1)).join(' / ')}ms`,
    );
    expect(Math.min(...times)).toBeLessThan(1000);
  });
});
