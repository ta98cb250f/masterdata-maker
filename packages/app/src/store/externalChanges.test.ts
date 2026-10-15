import { describe, expect, it } from 'vitest';
import type { Project } from '@sheetcraft/core';
import { MemoryProjectFs, enterInput } from '@sheetcraft/core';
import { basicSampleFiles } from '../fs/sample';
import type { AppStore } from './AppStore';
import type { ChangeChoice, ExternalChangesDialogArgs } from './externalChanges';
import { EXTERNAL_CHANGES_DIALOG, installExternalChanges } from './externalChanges';
import { openTestStore } from './testProject';

const tick = () => new Promise((r) => setTimeout(r, 5));

/** 直接保存方式のふりをしたメモリ上のプロジェクト。外から書き換えると更新日時が進む */
async function openDirect(files: Record<string, string> = basicSampleFiles()) {
  const mtimes = new Map<string, number>();
  let clock = 1000;
  for (const path of Object.keys(files)) mtimes.set(path, clock);
  const holder: { fs: MemoryProjectFs | null } = { fs: null };
  const opened = await openTestStore({}, files, {
    kind: 'direct',
    name: 'proj',
    lastModified: async (path) => ((await holder.fs?.read(path)) == null ? null : (mtimes.get(path) ?? null)),
  });
  holder.fs = opened.fs;
  // 保存（自分で書き込む）も更新日時を進める
  const save = opened.source.save;
  opened.source.save = async (plan) => {
    const outcome = await save(plan);
    for (const f of plan.files) mtimes.set(f.path, ++clock);
    return outcome;
  };
  const handle = installExternalChanges(opened.store, null);
  await handle.current()?.remember();
  const external = (path: string, edit: ((text: string) => string) | null) => {
    const text = opened.fs.entries().find(([p]) => p === path)?.[1] ?? '';
    if (edit === null) opened.fs.remove(path);
    else opened.fs.write(path, edit(text));
    mtimes.set(path, ++clock);
  };
  return { ...opened, handle, external, watcher: () => handle.current() };
}

function table(store: AppStore, name: string) {
  const t = store.project?.tables.find((x) => x.name === name);
  if (t === undefined) throw new Error(`no table ${name}`);
  return t;
}

function hp(store: AppStore, index = 0): unknown {
  const t = table(store, 'character');
  return store.calc?.getCell(t, t.records[index].uid, 'hp').raw;
}

function setHp(store: AppStore, text: string): void {
  const t = table(store, 'character');
  expect(store.apply(enterInput(store.project as Project, { table: t.uid, cells: [{ record: t.records[0].uid, column: 'hp' }], text })).ok).toBe(true);
}

function dialogArgs(store: AppStore): ExternalChangesDialogArgs {
  const d = store.getState().dialogs.find((x) => x.id === EXTERNAL_CHANGES_DIALOG);
  if (d === undefined) throw new Error('no dialog');
  return d.args as ExternalChangesDialogArgs;
}

/** ダイアログで選んで閉じる（null は取り消し） */
function answer(store: AppStore, choices: Record<string, ChangeChoice> | null): void {
  const d = store.getState().dialogs.find((x) => x.id === EXTERNAL_CHANGES_DIALOG);
  if (d === undefined) throw new Error('no dialog');
  (d.args as ExternalChangesDialogArgs).onDecide(choices === null ? null : new Map(Object.entries(choices)));
  store.closeDialog(d.key);
}

describe('外部での変更の検知（FR-FIO-07）', () => {
  it('更新日時が変わっていても中身が同じなら変更とみなさない。自分の保存も変更とみなさない', async () => {
    const o = await openDirect();
    expect(await o.watcher()?.detect()).toEqual([]);
    o.external('tables/skill.yaml', (t) => t);
    expect(await o.watcher()?.detect()).toEqual([]);
    setHp(o.store, '4321');
    await o.store.save();
    await tick();
    expect(await o.watcher()?.detect()).toEqual([]);
  });

  it('ウィンドウに戻ったときに、書き換えられたファイルを示す。読み込み直すと内容が変わり、未保存にならない', async () => {
    const o = await openDirect();
    o.external('tables/character.yaml', (t) => t.replace('hp: 1200', 'hp: 1300'));
    void o.watcher()?.onFocus();
    await tick();
    const args = dialogArgs(o.store);
    expect(args.mode).toBe('focus');
    expect(args.changes.map((c) => [c.path, c.kind, c.unsaved, c.text === null])).toEqual([['tables/character.yaml', 'table', false, false]]);
    answer(o.store, { 'tables/character.yaml': 'reload' });
    await tick();
    expect(hp(o.store)).toBe(1300);
    expect(o.store.isProjectModified()).toBe(false);
    expect(o.store.getState().status?.text).toBe('1 ファイルを読み込み直しました');
    // 同じ変更は聞き直さない
    expect(await o.watcher()?.detect()).toEqual([]);
  });

  it('保存していない変更のあるテーブルを読み込み直すと、変更と、そのテーブルを指す履歴が消える', async () => {
    const o = await openDirect();
    setHp(o.store, '4321');
    o.external('tables/character.yaml', (t) => t.replace('hp: 1200', 'hp: 1300'));
    void o.watcher()?.onFocus();
    await tick();
    const args = dialogArgs(o.store);
    expect(args.changes[0].unsaved).toBe(true);
    answer(o.store, { 'tables/character.yaml': 'reload' });
    await tick();
    expect(hp(o.store)).toBe(1300);
    expect(o.store.session?.canUndo()).toBe(false);
    expect(o.store.getState().status?.text).toBe('1 ファイルを読み込み直しました。元に戻す履歴は消しました');
  });

  it('「あとで」にした変更は、ウィンドウに戻っても聞き直さない。保存の直前には聞き直す', async () => {
    const o = await openDirect();
    o.external('tables/skill.yaml', (t) => t.replace(/cost: \d+/, 'cost: 1'));
    void o.watcher()?.onFocus();
    await tick();
    answer(o.store, null);
    await tick();
    void o.watcher()?.onFocus();
    await tick();
    expect(o.store.getState().dialogs).toEqual([]);
    setHp(o.store, '4321');
    const saving = o.store.save();
    await tick();
    expect(dialogArgs(o.store).mode).toBe('save');
    answer(o.store, null);
    await saving;
    expect(o.store.isProjectModified()).toBe(true);
  });

  it('保存の直前に書き換えを見つけ、「上書きする」を選ぶと、エディタの内容で保存を続ける', async () => {
    const o = await openDirect();
    setHp(o.store, '4321');
    o.external('tables/character.yaml', (t) => t.replace('name: 勇者アルス', 'name: 勇者'));
    const saving = o.store.save();
    await tick();
    const args = dialogArgs(o.store);
    expect(args.mode).toBe('save');
    // 保存していない変更があるので、既定は上書き
    answer(o.store, {});
    await saving;
    const text = (await o.fs.read('tables/character.yaml')) ?? '';
    expect(text).toContain('hp: 4321');
    expect(text).toContain('name: 勇者アルス');
    expect(o.store.isProjectModified()).toBe(false);
    expect(await o.watcher()?.detect()).toEqual([]);
  });

  it('変更の無いテーブルで「上書きする」を選ぶと未保存になり、保存で書き戻す。取り消すと保存しない', async () => {
    const o = await openDirect();
    o.external('tables/skill.yaml', (t) => t.replace(/cost: \d+/, 'cost: 1'));
    let saving = o.store.save();
    await tick();
    answer(o.store, null);
    await saving;
    expect((await o.fs.read('tables/skill.yaml'))?.includes('cost: 1')).toBe(true);
    saving = o.store.save();
    await tick();
    answer(o.store, { 'tables/skill.yaml': 'keep' });
    await saving;
    expect(await o.fs.read('tables/skill.yaml')).toBe(basicSampleFiles()['tables/skill.yaml']);
  });

  it('消されたファイル・共通設定・読み込みエラーのテーブル・設定ファイルの変更も扱う', async () => {
    const files = { ...basicSampleFiles(), 'tables/broken.yaml': 'table: broken\nrecords: [\n' };
    const o = await openDirect(files);
    o.external('tables/stage.yaml', null);
    o.external('config/enums.yaml', (t) => `${t}  - name: added\n    values: [a, b]\n`);
    o.external('tables/broken.yaml', () => 'table: broken\nfields:\n  - name: n\n    type: int\nrecords:\n  - id: 1\n    n: 5\n');
    void o.watcher()?.onFocus();
    await tick();
    const args = dialogArgs(o.store);
    expect(args.changes.map((c) => [c.path, c.kind, c.text === null]).sort()).toEqual([
      ['config/enums.yaml', 'common', false],
      ['tables/broken.yaml', 'broken', false],
      ['tables/stage.yaml', 'table', true],
    ]);
    answer(o.store, {});
    await tick();
    expect(o.store.project?.tables.map((t) => t.name)).toEqual(['broken', 'character', 'skill']);
    expect(o.store.project?.brokenTables).toEqual([]);
    expect(o.store.project?.common.enums.items.some((e) => e.name === 'added')).toBe(true);
    expect(o.store.isProjectModified()).toBe(false);
    await o.store.flushValidation();
    expect(o.store.getState().validation.tables.has('broken')).toBe(true);

    // 設定ファイルを読み込み直すと、プロジェクトを開き直す
    const before = o.store.project;
    o.external('sheetcraft.yaml', (t) => t.replace('out_dir: build/', 'out_dir: out/'));
    void o.watcher()?.onFocus();
    await tick();
    expect(dialogArgs(o.store).changes.map((c) => c.kind)).toEqual(['config']);
    answer(o.store, {});
    await tick();
    await tick();
    expect(o.store.project).not.toBe(before);
    expect(o.store.project?.config.output?.out_dir).toBe('out/');
  });
});
