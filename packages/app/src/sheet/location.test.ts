import { describe, expect, it } from 'vitest';
import { openSampleStore, recordUid, tableUid } from '../testing/sampleStore';
import { resolveLocation } from './location';

async function setup() {
  const store = await openSampleStore();
  const project = store.project;
  const calc = store.calc;
  if (project === null || calc === null) throw new Error('not open');
  const character = tableUid(store, 'character');
  const resolve = (text: string, activeColumn?: string) => resolveLocation({ project, calc, activeTable: character, activeColumn }, text);
  return { store, character, resolve };
}

describe('セル位置の表示での移動（FR-UI-03）', () => {
  it('テーブル / 列名 / 主キー でそのセル', async () => {
    const { store, resolve } = await setup();
    expect(resolve('skill / cost / 2')).toEqual({
      ok: true,
      target: { kind: 'cell', table: tableUid(store, 'skill'), record: recordUid(store, 'skill', 2), column: 'cost' },
    });
    // 空白・大文字と小文字・表示名も受け付ける
    expect(resolve('  Skill/COST/2 ')).toMatchObject({ ok: true, target: { kind: 'cell', column: 'cost' } });
    expect(resolve('スキル / コスト / 2')).toMatchObject({ ok: true, target: { kind: 'cell', column: 'cost' } });
  });

  it('テーブルを省略した 列名 / 主キー は表示中のテーブル', async () => {
    const { store, character, resolve } = await setup();
    expect(resolve('hp / 3')).toEqual({ ok: true, target: { kind: 'cell', table: character, record: recordUid(store, 'character', 3), column: 'hp' } });
  });

  it('テーブル / 列名 は列全体、テーブルだけならテーブルの切り替え、列名だけなら表示中のテーブルの列', async () => {
    const { store, character, resolve } = await setup();
    expect(resolve('stage / boss_id')).toEqual({ ok: true, target: { kind: 'column', table: tableUid(store, 'stage'), column: 'boss_id' } });
    expect(resolve('stage')).toEqual({ ok: true, target: { kind: 'table', table: tableUid(store, 'stage') } });
    expect(resolve('defense')).toEqual({ ok: true, target: { kind: 'column', table: character, column: 'defense' } });
  });

  it('主キーだけなら、今の列のそのレコード', async () => {
    const { store, character, resolve } = await setup();
    expect(resolve('2', 'hp')).toEqual({ ok: true, target: { kind: 'cell', table: character, record: recordUid(store, 'character', 2), column: 'hp' } });
  });

  it('見つからなければ理由を返す', async () => {
    const { resolve } = await setup();
    expect(resolve('nothing / hp / 1')).toMatchObject({ ok: false, code: 'ui.nameBox.tableNotFound' });
    expect(resolve('skill / nothing / 1')).toMatchObject({ ok: false, code: 'ui.nameBox.columnNotFound' });
    expect(resolve('skill / cost / 99')).toMatchObject({ ok: false, code: 'ui.nameBox.keyNotFound' });
    expect(resolve('a / b / c / d')).toMatchObject({ ok: false, code: 'ui.nameBox.invalid' });
    expect(resolve('skill //')).toMatchObject({ ok: false, code: 'ui.nameBox.invalid' });
    expect(resolve('zzz', 'hp')).toMatchObject({ ok: false, code: 'ui.nameBox.notFound' });
  });
});
