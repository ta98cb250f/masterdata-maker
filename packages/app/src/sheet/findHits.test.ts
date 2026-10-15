import { describe, expect, it } from 'vitest';
import { createMatcher, defaultFindOptions, replaceCells } from '@sheetcraft/core';
import type { FindOptions, TextMatcher } from '@sheetcraft/core';
import { openSampleStore, tableUid } from '../testing/sampleStore';
import { computedHitFailures, findInSheet, nextHitIndex } from './findHits';

function matcher(options: Partial<FindOptions> & { query: string }): TextMatcher {
  const r = createMatcher({ ...defaultFindOptions(), ...options });
  if (!r.ok) throw new Error(r.error.code);
  return r.matcher;
}

describe('検索（FR-FND-01〜03）', () => {
  it('表示中の行と列を、行ごとに左から右へ探す。値は表示のテキスト、式の結果も表示どおりに探せる', async () => {
    const store = await openSampleStore();
    const sheet = store.sheet(tableUid(store, 'character'));
    const calc = store.calc;
    if (sheet === null || calc === null) throw new Error('not open');
    const hits = findInSheet(calc, sheet, matcher({ query: '1' }), false);
    // 1 行目: id=1、hp=1200、effective_hp=1560（列レベル式の結果）、skill_ids=1, 3 …
    const first = hits.filter((h) => h.row === 0).map((h) => [h.column, h.kind]);
    expect(first).toContainEqual(['id', 'value']);
    expect(first).toContainEqual(['hp', 'value']);
    expect(first).toContainEqual(['effective_hp', 'computed']);
    expect(first).toContainEqual(['skill_ids', 'value']);
    // 並びは行ごと・列の順
    for (let i = 1; i < hits.length; i++) {
      const a = hits[i - 1];
      const b = hits[i];
      expect(a.row < b.row || (a.row === b.row && a.col < b.col)).toBe(true);
    }
  });

  it('式の中も検索するなら、セル単位式は = 付きの式で照合する', async () => {
    const store = await openSampleStore();
    const sheet = store.sheet(tableUid(store, 'character'));
    const calc = store.calc;
    if (sheet === null || calc === null) throw new Error('not open');
    expect(findInSheet(calc, sheet, matcher({ query: 'hp * 2' }), false)).toEqual([]);
    const hits = findInSheet(calc, sheet, matcher({ query: 'hp * 2' }), true);
    expect(hits.map((h) => [h.column, h.kind, h.text])).toEqual([['effective_hp', 'formula', '=hp * 2']]);
    // 式の中を検索しなければ、セル単位式の結果（1600）は表示どおりに見つかるが、置換はできない
    const computed = findInSheet(calc, sheet, matcher({ query: '1600' }), false);
    expect(computed.map((h) => [h.column, h.kind, h.fromCellFormula])).toEqual([['effective_hp', 'computed', true]]);
    expect(computedHitFailures(computed)).toMatchObject([{ code: 'ui.find.formulaNotSearched', column: 'effective_hp' }]);
  });

  it('範囲を指定できる（選択範囲）', async () => {
    const store = await openSampleStore();
    const sheet = store.sheet(tableUid(store, 'character'));
    const calc = store.calc;
    if (sheet === null || calc === null) throw new Error('not open');
    const name = sheet.colOf('name');
    const hits = findInSheet(calc, sheet, matcher({ query: 'リナ' }), false, { top: 0, bottom: 2, left: name, right: name });
    expect(hits.map((h) => h.text)).toEqual(['魔法使いリナ']);
    expect(findInSheet(calc, sheet, matcher({ query: 'リナ' }), false, { top: 0, bottom: 0, left: name, right: name })).toEqual([]);
  });

  it('次・前の一致（末尾の次は先頭へ戻る）', () => {
    const hits = [
      { table: 1, record: 1, column: 'a', row: 0, col: 1, kind: 'value' as const, text: 'x' },
      { table: 1, record: 2, column: 'a', row: 2, col: 1, kind: 'value' as const, text: 'x' },
      { table: 2, record: 3, column: 'a', row: 0, col: 0, kind: 'value' as const, text: 'x' },
    ];
    const order = (uid: number) => uid;
    expect(nextHitIndex(hits, order, { table: 1, row: 0, col: 0 }, 1)).toBe(0);
    expect(nextHitIndex(hits, order, { table: 1, row: 0, col: 1 }, 1)).toBe(1);
    expect(nextHitIndex(hits, order, { table: 1, row: 0, col: 1 }, 1, true)).toBe(0);
    expect(nextHitIndex(hits, order, { table: 2, row: 0, col: 0 }, 1)).toBe(0);
    expect(nextHitIndex(hits, order, { table: 1, row: 0, col: 1 }, -1)).toBe(2);
    expect(nextHitIndex(hits, order, { table: 2, row: 0, col: 0 }, -1)).toBe(1);
    expect(nextHitIndex([], order, null, 1)).toBe(-1);
  });

  it('置換（FR-FND-04）: 一致したセルを replaceCells に渡すと、型に合わないセルは置換されず一覧になる', async () => {
    const store = await openSampleStore();
    const project = store.project;
    const calc = store.calc;
    const sheet = store.sheet(tableUid(store, 'skill'));
    if (project === null || calc === null || sheet === null) throw new Error('not open');
    const m = matcher({ query: '1' });
    const hits = findInSheet(calc, sheet, m, false);
    const r = replaceCells(project, {
      cells: hits.filter((h) => h.kind !== 'computed').map((h) => ({ table: h.table, record: h.record, column: h.column })),
      matcher: m,
      replacement: 'x',
      searchFormulas: false,
    });
    // id（編集できない）と cost（整数）は置換できない
    expect(r.failures.map((f) => f.column).sort()).toEqual(['cost', 'cost', 'id']);
  });
});
