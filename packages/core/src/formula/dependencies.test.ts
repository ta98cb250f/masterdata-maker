import { describe, expect, test } from 'vitest';
import { extractDependencies } from './dependencies';
import { parseFormula } from './parser';
import { renameColumnInFormula, renameRefColumnInFormula, renameRefTableInFormula } from './rename';
import type { FormulaDependencies } from './dependencies';

function deps(text: string): FormulaDependencies {
  const r = parseFormula(text);
  if (!r.ok) throw new Error(r.error.messageCode);
  return extractDependencies(r.ast);
}

describe('extractDependencies', () => {
  test('同じレコードの列（小文字。重複なし）', () => {
    expect([...deps('=IF(rarity = "SSR", hp * 2, hp)').columns]).toEqual(['rarity', 'hp']);
    expect([...deps('HP + Hp + hP').columns]).toEqual(['hp']);
    expect(deps('1 + 2').columns.size).toBe(0);
  });

  test('文字列リテラルの中の語・関数名・TRUE / FALSE は依存とみなさない（FR-FML-11）', () => {
    expect([...deps('"hp" & name & "rarity = SSR"').columns]).toEqual(['name']);
    expect([...deps('SUM(sum) + TRUE').columns]).toEqual(['sum']);
  });

  test('IF の選ばれない側も依存に含める', () => {
    expect([...deps('IF(flag, a, b)').columns]).toEqual(['flag', 'a', 'b']);
  });

  test('REF の参照先（列名は小文字、重複なし）と、キーの式の中の列', () => {
    const d = deps('SUM(REF("skill", skill_ids, "cost")) + REF("skill", main_skill, "COST") + REF("item", 1, "price")');
    expect(d.refs).toEqual([
      { table: 'skill', column: 'cost' },
      { table: 'item', column: 'price' },
    ]);
    expect([...d.columns]).toEqual(['skill_ids', 'main_skill']);
    expect(d.errors).toEqual([]);
  });

  test('REF の第 1・第 3 引数が文字列リテラルでなければ静的なエラー（P-31）', () => {
    const d = deps('REF(t, 1, "name") + REF("skill", 1, col)');
    expect(d.refs).toEqual([]);
    expect(d.errors.map((e) => [e.code, e.messageCode, e.messageArgs, e.start, e.end])).toEqual([
      ['#ERROR!', 'formula.ref.literalRequired', { index: 1 }, 4, 5],
      ['#ERROR!', 'formula.ref.literalRequired', { index: 3 }, 36, 39],
    ]);
    expect([...d.columns]).toEqual(['t', 'col']);
  });

  test('引数の数が違う REF は依存に含めない（評価で #N/A になる）', () => {
    const d = deps('REF("skill", 1)');
    expect(d.refs).toEqual([]);
    expect(d.errors).toEqual([]);
  });
});

describe('renameColumnInFormula（同じテーブルの列名の変更）', () => {
  test('空白などのテキストを保ったまま書き換える', () => {
    expect(renameColumnInFormula('=IF(rarity = "SSR", hp * 2, hp)', 'hp', 'max_hp')).toBe(
      '=IF(rarity = "SSR", max_hp * 2, max_hp)',
    );
    expect(renameColumnInFormula('hp  *\n2', 'hp', 'max_hp')).toBe('max_hp  *\n2');
  });

  test('文字列の中の語、関数名、他の列は変えない。列名は大文字と小文字を区別しない', () => {
    expect(renameColumnInFormula('=hp & "hp" & hpx', 'hp', 'max_hp')).toBe('=max_hp & "hp" & hpx');
    expect(renameColumnInFormula('HP + 1', 'hp', 'max_hp')).toBe('max_hp + 1');
    expect(renameColumnInFormula('SUM(sum)', 'sum', 'total')).toBe('SUM(total)');
    expect(renameColumnInFormula('SUM (sum)', 'sum', 'total')).toBe('SUM (total)');
  });

  test('REF の文字列は変えない（別の関数で書き換える）', () => {
    expect(renameColumnInFormula('REF("skill", cost, "cost")', 'cost', 'mp')).toBe('REF("skill", mp, "cost")');
  });

  test('変更が無い、または字句解析できない式はそのまま', () => {
    expect(renameColumnInFormula('=a+b', 'hp', 'x')).toBe('=a+b');
    expect(renameColumnInFormula('=hp + "abc', 'hp', 'x')).toBe('=hp + "abc');
  });

  test('構文エラーの式でも、字句解析できれば書き換える', () => {
    expect(renameColumnInFormula('=hp +', 'hp', 'x')).toBe('=x +');
  });
});

describe('renameRefColumnInFormula（REF の列名の変更）', () => {
  test('第 1 引数が指定のテーブルのものだけ書き換える', () => {
    expect(
      renameRefColumnInFormula('=SUM(REF("skill", skill_ids, "cost")) + REF("item", 1, "cost")', 'skill', 'cost', 'mp_cost'),
    ).toBe('=SUM(REF("skill", skill_ids, "mp_cost")) + REF("item", 1, "cost")');
  });

  test('列名は大文字と小文字を区別しない。空白は保つ', () => {
    expect(renameRefColumnInFormula('ref( "skill" ,1,  "COST" )', 'skill', 'cost', 'mp')).toBe(
      'ref( "skill" ,1,  "mp" )',
    );
  });

  test('入れ子の REF と、同じテーブルの列の参照は変えない', () => {
    expect(
      renameRefColumnInFormula('REF("skill", REF("unit", id, "skill"), "cost") + cost', 'skill', 'cost', 'mp'),
    ).toBe('REF("skill", REF("unit", id, "skill"), "mp") + cost');
  });

  test('引用符は "" にする', () => {
    expect(renameRefColumnInFormula('REF("t", 1, "a")', 't', 'a', 'x"y')).toBe('REF("t", 1, "x""y")');
  });

  test('構文エラーの式・該当しない式はそのまま', () => {
    expect(renameRefColumnInFormula('REF("skill", 1, "cost"', 'skill', 'cost', 'mp')).toBe('REF("skill", 1, "cost"');
    expect(renameRefColumnInFormula('REF("skill", 1, "name")', 'skill', 'cost', 'mp')).toBe('REF("skill", 1, "name")');
  });
});

describe('renameRefTableInFormula（REF のテーブル名の変更）', () => {
  test('第 1 引数だけ書き換える', () => {
    expect(
      renameRefTableInFormula('=REF("skill", id, "name") & "skill" & REF("item", 1, "skill")', 'skill', 'ability'),
    ).toBe('=REF("ability", id, "name") & "skill" & REF("item", 1, "skill")');
  });

  test('テーブル名は大文字と小文字を区別する', () => {
    expect(renameRefTableInFormula('REF("Skill", 1, "name")', 'skill', 'ability')).toBe('REF("Skill", 1, "name")');
  });
});
