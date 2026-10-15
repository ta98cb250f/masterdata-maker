import { describe, expect, it } from 'vitest';
import { RichCell } from '../model/cell';
import type { TableRecord } from '../model/table';
import { DateTimeValue, EMPTY, FList, FormulaError } from '../formula';
import { Calculator, valueKey } from './calculator';
import { loadSample, tableOf, testProject, uidOf } from './test-project';

// core は DOM と Node の型を持たないので、計測と出力は globalThis から取る
const host = globalThis as unknown as { performance: { now(): number }; console: { log(message: string): void } };
const now = (): number => host.performance.now();

function errorOf(v: unknown): FormulaError {
  expect(v).toBeInstanceOf(FormulaError);
  return v as FormulaError;
}

describe('サンプルの実効値（P-10）', () => {
  for (const sample of ['basic-yaml', 'basic-json']) {
    it(`${sample}: effective_hp は hp * (1 + defense / 100)、セル単位式は列レベル式より優先、default を使う`, async () => {
      const project = await loadSample(sample);
      const calc = new Calculator(project);
      const character = tableOf(project, 'character');
      const r1 = calc.getCell(character, uidOf(character, 1), 'effective_hp');
      expect(r1).toEqual({ value: 1560, raw: 1560, source: 'formula' });
      // id 2 はセル単位式 hp * 2（列レベル式なら 880）
      const r2 = calc.getCell(character, uidOf(character, 2), 'effective_hp');
      expect(r2).toEqual({ value: 1600, raw: 1600, source: 'override' });
      // id 3 は defense が未入力なので default の 0
      expect(calc.getCell(character, uidOf(character, 3), 'defense')).toEqual({ value: 0, raw: 0, source: 'default' });
      expect(calc.getCell(character, uidOf(character, 3), 'effective_hp').raw).toBe(650);
      // 値・未入力・int64・datetime・リスト
      expect(calc.getCell(character, uidOf(character, 2), 'hp')).toEqual({ value: 800, raw: 800, source: 'value' });
      expect(calc.getCell(character, uidOf(character, 3), 'skill_ids')).toEqual({ value: EMPTY, raw: undefined, source: 'empty' });
      expect(calc.getCell(character, uidOf(character, 1), 'power').value).toBe(9007199254740993n);
      expect(calc.getCell(character, uidOf(character, 1), 'start_at').value).toBeInstanceOf(DateTimeValue);
      expect(calc.getCell(character, uidOf(character, 1), 'skill_ids').value).toEqual(new FList([1, 3]));
      // テーブル名でも引ける。無いテーブル・列・レコードは未入力
      expect(calc.getCell('character', uidOf(character, 1), 'hp').raw).toBe(1200);
      expect(calc.getCell('nothing', 1, 'hp').source).toBe('empty');
      expect(calc.getCell(character, 999_999, 'hp').source).toBe('empty');
      expect(calc.getCell(character, uidOf(character, 1), 'nothing').source).toBe('empty');
    });
  }
});

describe('依存の順の計算（FR-FML-09）', () => {
  it('a = b + 1、b = 10 なら a は 11（a が b より前の列でも）', async () => {
    const project = await testProject({
      tables: {
        t: `fields:
  - { name: a, type: int, formula: b + 1 }
  - { name: b, type: int }
  - { name: c, type: int, formula: a * 2 }
  - { name: d, type: int, formula: e + 1 }
  - { name: e, type: int, formula: B * 3 }
records:
  - id: 1
    b: 10
`,
      },
    });
    const calc = new Calculator(project);
    const t = tableOf(project, 't');
    const uid = uidOf(t, 1);
    expect(calc.getCell(t, uid, 'c').raw).toBe(22);
    expect(calc.getCell(t, uid, 'a').raw).toBe(11);
    // 列名は大文字と小文字を区別しない（P-30）。式の中の B は b
    expect(calc.getCell(t, uid, 'd').raw).toBe(31);
  });
});

describe('結果の型の検査（FR-FML-12、P-13）', () => {
  it('int の列の式が 1.5 を返したらエラー、int64 の列は整数を BigInt にする', async () => {
    const project = await testProject({
      enums: 'enums:\n  - name: color\n    values: [red, blue]\n',
      tables: {
        t: `fields:
  - { name: half, type: int, formula: 3 / 2 }
  - { name: big, type: int64, formula: "1000" }
  - { name: text, type: string, formula: 1 + 1 }
  - { name: color, type: enum, enum_ref: color, formula: '"green"' }
  - { name: when, type: datetime, formula: 'DATE(2026, 10, 13)' }
  - { name: empty, type: string, formula: '""' }
records:
  - id: 1
`,
      },
    });
    const calc = new Calculator(project);
    const t = tableOf(project, 't');
    const uid = uidOf(t, 1);
    const half = calc.getCell(t, uid, 'half');
    expect(half.source).toBe('formula');
    expect(half.raw).toBeUndefined();
    expect(half.error?.messageCode).toBe('formula.result.notInteger');
    expect(half.value).toBe(half.error);
    expect(calc.getCell(t, uid, 'big')).toEqual({ value: 1000n, raw: 1000n, source: 'formula' });
    expect(calc.getCell(t, uid, 'text').error?.messageCode).toBe('formula.result.typeMismatch');
    expect(calc.getCell(t, uid, 'color').error?.messageCode).toBe('formula.result.notInEnum');
    expect(calc.getCell(t, uid, 'when').raw).toBe('2026-10-13T00:00:00+09:00');
    expect(calc.getCell(t, uid, 'empty')).toEqual({ value: EMPTY, raw: undefined, source: 'formula' });
  });
});

describe('REF（FR-FML-04、P-31）', () => {
  const files = {
    tables: {
      skill: `fields:
  - { name: cost, type: int }
  - { name: tags, type: list<string> }
records:
  - { id: 1, cost: 10, tags: [a, b] }
  - { id: 2, cost: 8 }
  - { id: 3, cost: 12, tags: [c] }
`,
      character: `fields:
  - { name: skill_ids, type: list<int>, ref: skill.id }
  - { name: total, type: int, formula: 'SUM(REF("skill", skill_ids, "cost"))' }
  - { name: first, type: int, formula: 'REF("skill", 1, "COST")' }
  - { name: tags, type: list<string>, formula: 'REF("skill", skill_ids, "tags")' }
  - { name: no_table, type: int, formula: 'REF("nothing", 1, "cost")' }
  - { name: no_column, type: int, formula: 'REF("skill", 1, "price")' }
  - { name: no_key, type: int, formula: 'REF("skill", 99, "cost")' }
records:
  - { id: 1, skill_ids: [1, 3] }
  - { id: 2, skill_ids: [2, 9] }
`,
    },
  };

  it('キーのリストならリストを返す。テーブル・列・キーが無ければエラー', async () => {
    const project = await testProject(files);
    const calc = new Calculator(project);
    const c = tableOf(project, 'character');
    const u1 = uidOf(c, 1);
    expect(calc.getCell(c, u1, 'total').raw).toBe(22);
    expect(calc.getCell(c, u1, 'first').raw).toBe(10);
    // 参照先の値がリストなら平らにする
    expect(calc.getCell(c, u1, 'tags').raw).toEqual(['a', 'b', 'c']);
    expect(errorOf(calc.getCell(c, u1, 'no_table').value).origin.messageCode).toBe('formula.ref.tableNotFound');
    expect(errorOf(calc.getCell(c, u1, 'no_column').value).origin.messageCode).toBe('formula.ref.columnNotFound');
    const noKey = errorOf(calc.getCell(c, u1, 'no_key').value);
    expect(noKey.code).toBe('#N/A');
    expect(noKey.origin.messageArgs).toEqual({ table: 'skill', key: '99' });
    // リストの要素の 1 つでも見つからなければエラー
    expect(errorOf(calc.getCell(c, uidOf(c, 2), 'total').value).code).toBe('#N/A');
  });

  it('number と bigint の同じ整数は同じキー', async () => {
    const project = await testProject({
      tables: {
        big: `fields:
  - { name: v, type: string }
records:
  - { id: 1, v: one }
`,
        user: `fields:
  - { name: k, type: int64 }
  - { name: v, type: string, formula: 'REF("big", k, "v")' }
records:
  - { id: 1, k: 1 }
`,
      },
    });
    const calc = new Calculator(project);
    const user = tableOf(project, 'user');
    // k は int64 なので 1n、big の id は int なので 1
    expect(calc.getCell(user, uidOf(user, 1), 'k').value).toBe(1n);
    expect(calc.getCell(user, uidOf(user, 1), 'v').raw).toBe('one');
    expect(valueKey(1)).toBe(valueKey(1n));
    expect(valueKey(1.5)).not.toBe(valueKey(1));
    expect(valueKey('1')).not.toBe(valueKey(1));
    expect(valueKey(EMPTY)).toBeUndefined();
    expect(calc.findRecordByKey('big', 1n)?.cells.get('v')).toBe('one');
  });
});

describe('循環参照（FR-FML-11、P-33）', () => {
  it('列レベル式の循環は #REF!（循環参照）', async () => {
    const project = await testProject({
      tables: {
        t: `fields:
  - { name: a, type: int, formula: b + 1 }
  - { name: b, type: int, formula: a + 1 }
  - { name: self, type: int, formula: self + 1 }
  - { name: c, type: int, formula: a * 2 }
  - { name: text, type: string, formula: '"a" & "b"' }
records:
  - id: 1
`,
      },
    });
    const calc = new Calculator(project);
    const t = tableOf(project, 't');
    const uid = uidOf(t, 1);
    for (const name of ['a', 'b', 'self', 'c']) {
      const e = errorOf(calc.getCell(t, uid, name).value);
      expect(e.code, name).toBe('#REF!');
      expect(e.origin.messageCode, name).toBe('formula.circular');
    }
    // 文字列の中の列名は依存とみなさない
    expect(calc.getCell(t, uid, 'text').raw).toBe('ab');
  });

  it('セル単位式を通した循環も見つける', async () => {
    const project = await testProject({
      tables: {
        t: `fields:
  - { name: a, type: int, formula: b + 1 }
  - { name: b, type: int }
records:
  - { id: 1, b: { override: a * 2 } }
  - { id: 2, b: 5 }
`,
      },
    });
    const calc = new Calculator(project);
    const t = tableOf(project, 't');
    expect(errorOf(calc.getCell(t, uidOf(t, 1), 'a').value).origin.messageCode).toBe('formula.circular');
    expect(calc.getCell(t, uidOf(t, 1), 'b').source).toBe('override');
    expect(calc.getCell(t, uidOf(t, 2), 'a').raw).toBe(6);
  });

  it('REF を通したテーブル間の循環も見つける', async () => {
    const project = await testProject({
      tables: {
        t1: `fields:
  - { name: a, type: int, formula: 'REF("t2", id, "b") + 1' }
records:
  - id: 1
`,
        t2: `fields:
  - { name: b, type: int, formula: 'REF("t1", id, "a") + 1' }
  - { name: c, type: int, formula: 'REF("t2", 1, "c")' }
records:
  - id: 1
`,
      },
    });
    const calc = new Calculator(project);
    const t1 = tableOf(project, 't1');
    const t2 = tableOf(project, 't2');
    expect(errorOf(calc.getCell(t1, uidOf(t1, 1), 'a').value).origin.messageCode).toBe('formula.circular');
    expect(errorOf(calc.getCell(t2, uidOf(t2, 1), 'b').value).origin.messageCode).toBe('formula.circular');
    // 自分自身を REF で参照
    expect(errorOf(calc.getCell(t2, uidOf(t2, 1), 'c').value).origin.messageCode).toBe('formula.circular');
  });

  it('主キーが式で、その式が自分のテーブルを REF で引くと循環参照', async () => {
    const project = await testProject({
      baseFields: 'base_fields:\n  - { name: id, type: int, primary: true, formula: \'REF("t", 1, "x")\' }\n',
      tables: {
        t: `fields:
  - { name: x, type: int }
records:
  - { x: 1 }
`,
      },
    });
    const calc = new Calculator(project);
    const t = tableOf(project, 't');
    expect(errorOf(calc.getCell(t, t.records[0].uid, 'id').value).origin.messageCode).toBe('formula.circular');
  });
});

describe('深い参照の連鎖', () => {
  const rows = 3000;
  function chainYaml(cycle: boolean): string {
    const records = Array.from({ length: rows }, (_, i) => `  - { id: ${i + 1}, amount: 1 }`).join('\n');
    const formula = cycle
      ? `'REF("t", IF(id = ${rows}, 1, id + 1), "total") + amount'`
      : `'IF(id = 1, amount, REF("t", id - 1, "total") + amount)'`;
    return `fields:
  - { name: amount, type: int }
  - { name: total, type: int, formula: ${formula} }
records:
${records}
`;
  }

  it('前の行を参照する累計を末尾の行から計算しても、スタックが溢れない', async () => {
    const project = await testProject({ tables: { t: chainYaml(false) } });
    const calc = new Calculator(project);
    const t = tableOf(project, 't');
    expect(calc.getCell(t, t.records[rows - 1].uid, 'total').raw).toBe(rows);
    expect(calc.getCell(t, t.records[999].uid, 'total').raw).toBe(1000);
  });

  it('長い循環も循環参照になり、止まる', async () => {
    const project = await testProject({ tables: { t: chainYaml(true) } });
    const calc = new Calculator(project);
    const t = tableOf(project, 't');
    const e = errorOf(calc.getCell(t, t.records[0].uid, 'total').value);
    expect(e.origin.messageCode).toBe('formula.circular');
    expect(errorOf(calc.getCell(t, t.records[rows - 1].uid, 'total').value).code).toBe('#REF!');
  });
});

describe('キャッシュと無効化（FR-FML-14）', () => {
  const files = {
    tables: {
      skill: `fields:
  - { name: cost, type: int }
  - { name: double, type: int, formula: cost * 2 }
records:
  - { id: 1, cost: 10 }
  - { id: 2, cost: 8 }
`,
      character: `fields:
  - { name: hp, type: int }
  - { name: bonus, type: int, formula: hp + 1 }
  - { name: skill_id, type: int }
  - { name: cost, type: int, formula: 'REF("skill", skill_id, "double")' }
  - { name: unrelated, type: int, formula: '1 + 1' }
records:
  - { id: 1, hp: 100, skill_id: 1 }
  - { id: 2, hp: 200, skill_id: 2 }
`,
    },
  };

  function setValue(record: TableRecord, field: string, value: number): void {
    record.cells.set(field, value);
  }

  it('同じテーブルの依存はそのレコードだけ、REF の依存は列ごと捨てる', async () => {
    const project = await testProject(files);
    const calc = new Calculator(project);
    const c = tableOf(project, 'character');
    const s = tableOf(project, 'skill');
    const [c1, c2] = c.records;
    expect(calc.getCell(c, c1.uid, 'bonus').raw).toBe(101);
    expect(calc.getCell(c, c2.uid, 'bonus').raw).toBe(201);
    expect(calc.getCell(c, c1.uid, 'cost').raw).toBe(20);
    const unrelated = calc.getCell(c, c1.uid, 'unrelated');

    // 知らせなければキャッシュの値のまま
    setValue(c1, 'hp', 150);
    expect(calc.getCell(c, c1.uid, 'bonus').raw).toBe(101);
    const bonus2 = calc.getCell(c, c2.uid, 'bonus');
    calc.invalidateCell(c, c1.uid, 'hp');
    expect(calc.getCell(c, c1.uid, 'bonus').raw).toBe(151);
    // 他のレコードと、依存しない列のキャッシュは残る
    expect(calc.getCell(c, c2.uid, 'bonus')).toBe(bonus2);
    expect(calc.getCell(c, c1.uid, 'unrelated')).toBe(unrelated);

    // 他のテーブルの値を変えると、REF で参照する列を計算し直す（推移的に double → cost）
    setValue(s.records[0], 'cost', 50);
    calc.invalidateCell(s, s.records[0].uid, 'cost');
    expect(calc.getCell(c, c1.uid, 'cost').raw).toBe(100);
    expect(calc.getCell(c, c1.uid, 'unrelated')).toBe(unrelated);
  });

  it('主キーの変更と行の追加は REF の照合に反映される', async () => {
    const project = await testProject(files);
    const calc = new Calculator(project);
    const c = tableOf(project, 'character');
    const s = tableOf(project, 'skill');
    const c2 = c.records[1];
    expect(calc.getCell(c, c2.uid, 'cost').raw).toBe(16);
    // skill の id 2 を 5 に変える → character の id 2 は skill 2 を見つけられない
    setValue(s.records[1], 'id', 5);
    calc.invalidateCell(s, s.records[1].uid, 'id');
    expect(errorOf(calc.getCell(c, c2.uid, 'cost').value).code).toBe('#N/A');
    // 行を追加する（id 2、cost 7）
    s.records.push({ uid: project.uids.next(), cells: new Map([['id', 2], ['cost', 7]]), extra: [] });
    calc.invalidateTable(s);
    expect(calc.getCell(c, c2.uid, 'cost').raw).toBe(14);
  });

  it('セル単位式の追加と、列レベル式の変更', async () => {
    const project = await testProject(files);
    const calc = new Calculator(project);
    const c = tableOf(project, 'character');
    const c1 = c.records[0];
    expect(calc.getCell(c, c1.uid, 'bonus').raw).toBe(101);
    // セル単位式（式のテキストが変わればキャッシュは使わない）
    c1.cells.set('bonus', new RichCell({ override: 'hp * 3' }));
    calc.invalidateCell(c, c1.uid, 'bonus');
    expect(calc.getCell(c, c1.uid, 'bonus')).toEqual({ value: 300, raw: 300, source: 'override' });
    // セル単位式が参照する列の変更も伝わる
    setValue(c1, 'hp', 10);
    calc.invalidateCell(c, c1.uid, 'hp');
    expect(calc.getCell(c, c1.uid, 'bonus').raw).toBe(30);
    // 列レベル式の変更は invalidateTable
    const bonusField = c.fields.find((f) => f.name === 'bonus');
    if (bonusField === undefined) throw new Error('bonus が無い');
    bonusField.formula = 'hp - 1';
    calc.invalidateTable(c);
    expect(calc.getCell(c, c.records[1].uid, 'bonus').raw).toBe(199);
    calc.invalidateAll();
    expect(calc.getCell(c, c1.uid, 'bonus').raw).toBe(30);
  });

  it('参照先のテーブルを後から追加しても invalidateTable で反映される', async () => {
    const project = await testProject({
      tables: {
        user: `fields:
  - { name: v, type: int, formula: 'REF("later", 1, "x")' }
records:
  - id: 1
`,
      },
    });
    const calc = new Calculator(project);
    const user = tableOf(project, 'user');
    expect(errorOf(calc.getCell(user, user.records[0].uid, 'v').value).code).toBe('#REF!');
    const other = await testProject({ tables: { later: 'fields:\n  - { name: x, type: int }\nrecords:\n  - { id: 1, x: 42 }\n' } });
    const later = tableOf(other, 'later');
    project.tables.push(later);
    calc.invalidateTable(later);
    expect(calc.getCell(user, user.records[0].uid, 'v').raw).toBe(42);
    expect([...calc.formulaRefTables(user)]).toEqual(['later']);
  });
});

describe('性能（NFR-12）', () => {
  it('1 万行のテーブルの式の列を全部計算する', async () => {
    const rows = 10_000;
    const records = Array.from({ length: rows }, (_, i) => `  - { id: ${i + 1}, hp: ${1000 + (i % 500)}, defense: ${i % 100}, skill_id: ${(i % 3) + 1} }`).join('\n');
    const project = await testProject({
      tables: {
        skill: 'fields:\n  - { name: cost, type: int }\nrecords:\n  - { id: 1, cost: 10 }\n  - { id: 2, cost: 8 }\n  - { id: 3, cost: 12 }\n',
        character: `fields:
  - { name: hp, type: int }
  - { name: defense, type: int }
  - { name: skill_id, type: int }
  - { name: effective_hp, type: float, formula: hp * (1 + defense / 100) }
  - { name: rank, type: string, formula: 'IF(effective_hp > 1500, "A", "B")' }
  - { name: cost, type: int, formula: 'REF("skill", skill_id, "cost")' }
records:
${records}
`,
      },
    });
    const c = tableOf(project, 'character');
    const measure = (calc: Calculator, fields: string[]): number => {
      const start = now();
      for (const field of fields) for (const r of c.records) calc.getCell(c, r.uid, field);
      return now() - start;
    };
    // 1 回目は JIT の暖機を含むので、新しい Calculator で 2 回目を測る
    measure(new Calculator(project), ['effective_hp']);
    const calc = new Calculator(project);
    const one = measure(calc, ['effective_hp']);
    const calc2 = new Calculator(project);
    const three = measure(calc2, ['effective_hp', 'rank', 'cost']);
    const cached = measure(calc2, ['effective_hp', 'rank', 'cost']);
    // 1 セルの編集後の再計算（同じレコードの依存だけを捨てる）
    const r = c.records[5000];
    r.cells.set('hp', 2000);
    const editStart = now();
    calc2.invalidateCell(c, r.uid, 'hp');
    for (const field of ['effective_hp', 'rank', 'cost']) for (const rec of c.records) calc2.getCell(c, rec.uid, field);
    const edit = now() - editStart;
    host.console.log(
      `[性能] 1 万行: 式 1 列 ${one.toFixed(1)}ms、式 3 列（REF を含む） ${three.toFixed(1)}ms、` +
        `キャッシュ済み 3 列 ${cached.toFixed(1)}ms、1 セル編集後の再計算 ${edit.toFixed(1)}ms`,
    );
    expect(calc2.getCell(c, r.uid, 'effective_hp').raw).toBe(2000 * (1 + (5000 % 100) / 100));
    expect(one).toBeLessThan(500);
    expect(three).toBeLessThan(1500);
  });
});
