import { describe, expect, it } from 'vitest';
import { applyCompletion, completionContext, completionItems } from './complete';

const COLUMNS = [{ name: 'hp', detail: 'HP' }, { name: 'hp_max' }, { name: 'defense' }, { name: 'name' }];
const FUNCTIONS = ['ROUND', 'ROUNDDOWN', 'ROUNDUP', 'SUM', 'SUBSTITUTE'];

function items(text: string, caret = text.length, requireEquals = true) {
  const ctx = completionContext(text, caret, requireEquals);
  return ctx === null ? null : completionItems(text, ctx, COLUMNS, FUNCTIONS).map((i) => i.label);
}

describe('入力補完（FR-EDT-07）', () => {
  it('= で始まる式の、カーソルの前の語で列名と関数名を絞り込む（大文字と小文字は区別しない）', () => {
    expect(items('=h')).toEqual(['hp', 'hp_max']);
    expect(items('=SU')).toEqual(['SUM', 'SUBSTITUTE']);
    expect(items('=su')).toEqual(['SUM', 'SUBSTITUTE']);
    expect(items('=IF(rarity = "SSR", h')).toEqual(['hp', 'hp_max']);
    expect(items('=round(d')).toEqual(['defense']);
  });

  it('式でない・文字列の中・数値・語が無いときは出さない', () => {
    expect(items('h')).toBeNull();
    expect(items('="h')).toBeNull();
    expect(items('=IF(a = "x y", h')).toEqual(['hp', 'hp_max']);
    expect(items('=1')).toBeNull();
    expect(items('=1e')).toBeNull();
    expect(items('=SUM(')).toBeNull();
    expect(items('=hp + ')).toBeNull();
  });

  it('列の設定の式の欄は = が無くてもよい', () => {
    expect(items('de', 2, false)).toEqual(['defense']);
    expect(items('=de', 3, false)).toEqual(['defense']);
  });

  it('語とまったく同じ列名は出さない（補完しても変わらないため）', () => {
    expect(items('=hp')).toEqual(['hp_max']);
    expect(items('=defense')).toEqual([]);
  });

  it('関数は ( を付けて入れる。後ろに ( があれば付けない。カーソルの後ろに続く語も置き換える', () => {
    const text = '=ro';
    const ctx = completionContext(text, 3, true);
    expect(ctx).not.toBeNull();
    if (ctx === null) return;
    const list = completionItems(text, ctx, COLUMNS, FUNCTIONS);
    expect(list[0]).toMatchObject({ kind: 'function', label: 'ROUND', insert: 'ROUND(' });
    expect(applyCompletion(text, ctx, list[0])).toEqual({ text: '=ROUND(', caret: 7 });

    const mid = '=RO(hp)';
    const midCtx = completionContext(mid, 2, true);
    if (midCtx === null) throw new Error('no context');
    expect(midCtx).toEqual({ start: 1, end: 3, prefix: 'R' });
    const round = completionItems(mid, midCtx, COLUMNS, FUNCTIONS).find((i) => i.label === 'ROUNDUP');
    if (round === undefined) throw new Error('no ROUNDUP');
    expect(applyCompletion(mid, midCtx, round)).toEqual({ text: '=ROUNDUP(hp)', caret: 8 });
  });

  it('列名を補完する', () => {
    const text = '=hp * (1 + de / 100)';
    const ctx = completionContext(text, 13, true);
    if (ctx === null) throw new Error('no context');
    const item = completionItems(text, ctx, COLUMNS, FUNCTIONS)[0];
    expect(item).toMatchObject({ kind: 'column', insert: 'defense' });
    expect(applyCompletion(text, ctx, item)).toEqual({ text: '=hp * (1 + defense / 100)', caret: 18 });
  });
});
