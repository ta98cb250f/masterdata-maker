import { describe, expect, it } from 'vitest';
import { MemoryProjectFs, extendTo, resolveShortcut, selectCell, selectColRange, selectRowRange } from '@masterdata-maker/core';
import { downloadSource } from '../fs/download';
import { basicSampleFiles } from '../fs/sample';
import { AppStore } from '../store/AppStore';
import { allCommands } from './index';

async function open() {
  const store = new AppStore({ commands: allCommands(), platform: 'other', validationDelay: 0 });
  expect(await store.open(downloadSource('basic-yaml', new MemoryProjectFs(basicSampleFiles()), 'sample', () => undefined))).toBe(true);
  const sheet = () => {
    const s = store.sheet();
    if (s === null) throw new Error('no sheet');
    return s;
  };
  const ids = () => sheet().rowUids.map((u) => store.calc?.getCell(sheet().table, u, 'id').raw);
  return { store, sheet, ids };
}

const key = (k: string, code: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {}) => ({
  key: k,
  code,
  ctrlKey: mods.ctrl === true,
  metaKey: mods.meta === true,
  altKey: mods.alt === true,
  shiftKey: mods.shift === true,
});

describe('行・列の挿入と削除のキー操作（Ctrl+Alt+= / Ctrl+Alt+-）', () => {
  it('core の SHORTCUTS の insertRowsCols / deleteRowsCols に操作が割り当たっている（Mac は ⌘+Option）', async () => {
    const { store } = await open();
    expect(resolveShortcut(key('=', 'Equal', { ctrl: true, alt: true }), 'other')).toBe('insertRowsCols');
    expect(resolveShortcut(key('-', 'Minus', { ctrl: true, alt: true }), 'other')).toBe('deleteRowsCols');
    expect(resolveShortcut(key('≠', 'Equal', { meta: true, alt: true }), 'mac')).toBe('insertRowsCols');
    expect(resolveShortcut(key('–', 'Minus', { meta: true, alt: true }), 'mac')).toBe('deleteRowsCols');
    expect(store.commands.byShortcut('insertRowsCols')?.id).toBe('rowsCols.insert');
    expect(store.commands.byShortcut('deleteRowsCols')?.id).toBe('rowsCols.delete');
  });

  it('行を選んでいれば、選んだ行数だけ上に行を挿入する。削除は選んだ行を消す。どちらも 1 回で元に戻る', async () => {
    const { store, sheet, ids } = await open();
    store.setSelection(selectRowRange(1, 2, sheet().size));
    store.run('rowsCols.insert');
    expect(ids()).toEqual([1, 4, 5, 2, 3]);
    store.undo();
    expect(ids()).toEqual([1, 2, 3]);

    store.setSelection(selectRowRange(0, 1, sheet().size));
    store.run('rowsCols.delete');
    expect(ids()).toEqual([3]);
    store.undo();
    expect(ids()).toEqual([1, 2, 3]);
    expect(store.getState().contextMenu).toBeNull();
  });

  it('列を選んでいれば、挿入は左に列を挿入するダイアログを、削除は列の削除の確認を開く', async () => {
    const { store, sheet } = await open();
    const hp = sheet().colOf('hp');
    store.setSelection(selectColRange(hp, hp + 1, sheet().size));
    store.run('rowsCols.insert');
    expect(store.getState().dialogs.map((d) => [d.id, d.args])).toEqual([['column.insert', { table: sheet().table.uid, column: 'hp', side: 'left' }]]);
    store.closeDialog();

    store.run('rowsCols.delete');
    const dialogs = store.getState().dialogs;
    expect(dialogs.map((d) => d.id)).toEqual(['confirm']);
    expect((dialogs[0].args as { message: string }).message).toContain('hp, defense');
    // 確かめるまでは消さない
    expect(sheet().colOf('hp')).toBe(hp);
  });

  it('セル範囲を選んでいるときは、行か列かを選ぶ一覧を出す（行数・列数は選択範囲から）', async () => {
    const { store, sheet } = await open();
    const hp = sheet().colOf('hp');
    const size = sheet().size;
    store.setSelection(extendTo(selectCell({ row: 0, col: hp }, size), { row: 1, col: hp + 1 }, size));
    store.run('rowsCols.insert');
    const insertMenu = store.getState().contextMenu;
    expect(insertMenu?.items).toEqual([
      { kind: 'command', command: 'row.insertAbove' },
      { kind: 'command', command: 'column.insertLeft' },
    ]);
    expect(store.commandLabel('row.insertAbove')).toBe('上に 2 行挿入');
    // 一覧から選ぶと、既存の操作が動く
    store.run('row.insertAbove');
    expect(sheet().size.rows).toBe(5);
    expect(store.getState().contextMenu).toBeNull();

    store.setSelection(extendTo(selectCell({ row: 0, col: hp }, sheet().size), { row: 1, col: hp + 1 }, sheet().size));
    store.run('rowsCols.delete');
    expect(store.getState().contextMenu?.items).toEqual([
      { kind: 'command', command: 'row.delete' },
      { kind: 'command', command: 'column.delete' },
    ]);
    expect(store.commandLabel('column.delete')).toBe('2 列を削除');
  });

  it('編集中は使えない', async () => {
    const { store, sheet } = await open();
    store.setSelection(selectCell({ row: 0, col: sheet().colOf('hp') }, sheet().size));
    expect(store.beginEdit({ mode: 'overwrite', text: '1' })).toBe(true);
    expect(store.isEnabled('rowsCols.insert')).toBe(false);
    expect(store.isEnabled('rowsCols.delete')).toBe(false);
  });
});
