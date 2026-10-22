import { describe, expect, it } from 'vitest';
import type { Project } from '@masterdata-maker/core';
import { createTable, deleteTable, enterInput, setEnums, snapshotProject } from '@masterdata-maker/core';
import { ValidationEngine } from '../worker/engine';
import type { FromWorker, ToWorker } from '../worker/protocol';
import { MemoryBackupStorage } from '../fs/backupStore';
import { basicSampleFiles } from '../fs/sample';
import type { ProjectSource } from '../fs/types';
import type { AppStore } from './AppStore';
import type { BackupRecord, RestoreDialogArgs } from './backup';
import { BACKUP_DIALOG, backupKey, buildBackup, hashText, installBackup, isSameProject, planBackup, planRestore, projectIdentity } from './backup';
import { hashTextSliced, persistBackup } from './backupRecord';
import { openTestStore } from './testProject';

function table(store: AppStore, name: string) {
  const t = store.project?.tables.find((x) => x.name === name);
  if (t === undefined) throw new Error(`no table ${name}`);
  return t;
}

function setCell(store: AppStore, name: string, column: string, text: string, index = 0): void {
  const project = store.project as Project;
  const t = table(store, name);
  expect(store.apply(enterInput(project, { table: t.uid, cells: [{ record: t.records[index].uid, column }], text })).ok).toBe(true);
}

/** 保存したら書き込まれるテキスト（パス → テキスト）と、消すファイル */
function savePlanOf(store: AppStore): { files: Record<string, string>; remove: string[] } {
  const plan = store.session?.planSave();
  if (plan === undefined) throw new Error('no session');
  return { files: Object.fromEntries(plan.files.map((f) => [f.path, f.text])), remove: plan.remove };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('未保存の変更の退避の内容（FR-FIO-06）', () => {
  it('変更が無ければ退避しない。変更したテーブルの正規形のテキストと、読み込み元のハッシュを退避する', async () => {
    const { store } = await openTestStore();
    expect(await buildBackup(store)).toBeNull();
    setCell(store, 'character', 'hp', '4321');
    const record = (await buildBackup(store, 1234)) as BackupRecord;
    expect(record.savedAt).toBe(1234);
    expect(record.project).toEqual({ name: 'basic-yaml', configPath: 'masterdata-maker.yaml', configText: basicSampleFiles()['masterdata-maker.yaml'] });
    expect(record.tables).toHaveLength(1);
    expect(record.tables[0].basePath).toBe('tables/character.yaml');
    expect(record.tables[0].baseHash).toBe(hashText(basicSampleFiles()['tables/character.yaml']));
    expect(record.tables[0].text).toBe(savePlanOf(store).files['tables/character.yaml']);
    expect(record.common).toEqual([]);
    expect(record.removed).toEqual([]);
    // 手で元の値に戻すと、ファイルと同じなので退避しない
    setCell(store, 'character', 'hp', '1200');
    expect(await buildBackup(store)).toBeNull();
  });

  it('退避した内容を、開き直したプロジェクトに当てると、保存していない変更として同じ状態になる。元に戻すで取り消せる', async () => {
    const a = (await openTestStore()).store;
    const project = a.project as Project;
    setCell(a, 'character', 'hp', '4321');
    setCell(a, 'skill', 'cost', '77');
    expect(a.apply(setEnums(project, [...project.common.enums.items, { name: 'extra', values: ['x'] }])).ok).toBe(true);
    expect(a.apply(deleteTable(project, { table: table(a, 'stage').uid })).ok).toBe(true);
    expect(a.apply(createTable(project, { name: 'item' })).ok).toBe(true);
    const expected = savePlanOf(a);
    const record = structuredClone((await buildBackup(a)) as BackupRecord);
    expect(record.tables.map((t) => t.basePath)).toEqual(['tables/character.yaml', null, 'tables/skill.yaml']);
    expect(record.removed).toEqual(['tables/stage.yaml']);
    expect(record.common.map((c) => c.part)).toEqual(['enums']);

    const b = (await openTestStore()).store;
    const characterUid = table(b, 'character').uid;
    const plan = planRestore(b.project as Project, record);
    expect(plan.skipped).toEqual([]);
    expect(plan.items.map((i) => i.kind).sort()).toEqual(['common', 'newTable', 'removed', 'table', 'table']);
    expect(plan.items.every((i) => !i.changedSince)).toBe(true);
    expect(b.apply({ ok: true, tx: plan.tx }).ok).toBe(true);
    expect(savePlanOf(b)).toEqual(expected);
    expect(b.isProjectModified()).toBe(true);
    // 内部番号は今のテーブルのまま（表示の状態を引き継ぐ）
    expect(table(b, 'character').uid).toBe(characterUid);
    expect(b.session?.undoLabel()).toBe('ui.backup.restoreOp');
    expect(b.undo()).toBe(true);
    expect(b.isProjectModified()).toBe(false);
  });

  it('退避した後にファイルが書き換えられていれば、そのことを示す', async () => {
    const a = (await openTestStore()).store;
    setCell(a, 'character', 'hp', '4321');
    const record = (await buildBackup(a)) as BackupRecord;
    const files = basicSampleFiles();
    files['tables/character.yaml'] = files['tables/character.yaml'].replace('hp: 1200', 'hp: 1250');
    const b = (await openTestStore({}, files)).store;
    const plan = planRestore(b.project as Project, record);
    expect(plan.items[0].changedSince).toBe(true);
  });
});

describe('プロジェクトの同一性', () => {
  it('フォルダの名前と設定ファイル（パスと中身）が同じなら同じキー。直接保存方式ではフォルダのハンドルでも確かめる', async () => {
    const { store, source } = await openTestStore();
    const project = store.project as Project;
    const identity = projectIdentity(project, source);
    if (identity === null) throw new Error('no identity');
    expect(backupKey(identity)).toBe(backupKey({ ...identity }));
    expect(backupKey({ ...identity, name: 'other' })).not.toBe(backupKey(identity));
    expect(backupKey({ ...identity, configText: `${identity.configText}# x\n` })).not.toBe(backupKey(identity));
    const record: BackupRecord = { version: 1, savedAt: 0, project: identity, tables: [], common: [], removed: [] };
    expect(await isSameProject(record, identity, source)).toBe(true);
    expect(await isSameProject({ ...record, project: { ...identity, configText: 'x' } }, identity, source)).toBe(false);
    expect(await isSameProject({ ...record, version: 99 }, identity, source)).toBe(false);

    const { DirectoryProjectFs } = await import('../fs/direct');
    const handle = (same: boolean) => ({ kind: 'directory', name: 'basic-yaml', isSameEntry: async () => same });
    const direct = (same: boolean): ProjectSource => ({ ...source, fs: new DirectoryProjectFs(handle(same) as never) });
    expect(await isSameProject({ ...record, handle: {} }, identity, direct(true))).toBe(true);
    expect(await isSameProject({ ...record, handle: {} }, identity, direct(false))).toBe(false);
  });
});

describe('退避と復元の流れ', () => {
  it('変更の後に退避し、保存したら消す。退避が残ったまま開くと復元を提案し、復元すると未保存の変更になる', async () => {
    const storage = new MemoryBackupStorage();
    const a = await openTestStore();
    const handle = installBackup(a.store, { storage, delay: 0 });
    setCell(a.store, 'character', 'hp', '4321');
    await tick();
    await handle.manager.idle();
    const key = [...storage.data.keys()][0];
    expect(key).toMatch(/^masterdata-maker\.backup:/);
    await a.store.save();
    await tick();
    await handle.manager.idle();
    expect(storage.data.size).toBe(0);

    // もう一度変更して、保存せずに終わる（異常終了）
    setCell(a.store, 'character', 'hp', '5555');
    await tick();
    await handle.manager.idle();
    expect(storage.data.size).toBe(1);
    handle.dispose();

    const b = await openTestStore({}, Object.fromEntries(a.fs.entries()));
    const restored = installBackup(b.store, { storage, delay: 0 });
    await tick();
    const dialog = b.store.getState().dialogs.find((d) => d.id === BACKUP_DIALOG);
    expect(dialog).toBeDefined();
    const args = dialog?.args as RestoreDialogArgs;
    expect(args.items.map((i) => i.path)).toEqual(['tables/character.yaml']);
    args.onDecide('restore');
    b.store.closeDialog(dialog?.key);
    await tick();
    expect(b.store.getState().status?.text).toBe('保存していない変更を復元しました（1 件）');
    expect(b.store.calc?.getCell(table(b.store, 'character'), table(b.store, 'character').records[0].uid, 'hp').raw).toBe(5555);
    expect(b.store.isTableModified(table(b.store, 'character').uid)).toBe(true);
    await tick();
    await restored.manager.idle();
    expect(storage.data.size).toBe(1);
    // プロジェクトを閉じたら消す
    b.store.closeProject();
    await tick();
    await restored.manager.idle();
    expect(storage.data.size).toBe(0);
  });

  it('「復元しない」を選ぶと消す。答えずに閉じたら残す', async () => {
    const storage = new MemoryBackupStorage();
    const a = await openTestStore();
    installBackup(a.store, { storage, delay: 0 });
    setCell(a.store, 'character', 'hp', '4321');
    await tick();
    await (globalThis as unknown as { masterdataMakerBackup: { idle(): Promise<void> } }).masterdataMakerBackup.idle();
    expect(storage.data.size).toBe(1);

    const later = await openTestStore();
    const h1 = installBackup(later.store, { storage, delay: 0 });
    await tick();
    later.store.closeDialog();
    await tick();
    await h1.manager.idle();
    expect(storage.data.size).toBe(1);
    expect(later.store.isProjectModified()).toBe(false);

    const discard = await openTestStore();
    const h2 = installBackup(discard.store, { storage, delay: 0 });
    await tick();
    const dialog = discard.store.getState().dialogs.find((d) => d.id === BACKUP_DIALOG);
    (dialog?.args as RestoreDialogArgs).onDecide('discard');
    await tick();
    await h2.manager.idle();
    expect(storage.data.size).toBe(0);
  });
});

describe('退避の書き込み（Worker で行う部分）', () => {
  it('区切って求めたハッシュは、まとめて求めたものと同じ', async () => {
    const text = basicSampleFiles()['tables/character.yaml'].repeat(20);
    expect(await hashTextSliced(text, 1000)).toBe(hashText(text));
    expect(await hashTextSliced('')).toBe(hashText(''));
  });

  it('Worker の中で正規形のテキストを作って書き込む。読み込み元と同じ中身のテーブルは除き、何も無ければ消す', async () => {
    const { store } = await openTestStore();
    setCell(store, 'character', 'hp', '4321');
    const plan = await planBackup(store, 99);
    if (plan === null) throw new Error('no plan');
    expect(plan.targets.map((t) => t.basePath)).toEqual(['tables/character.yaml']);
    expect(plan.record.tables).toEqual([]);
    const storage = new MemoryBackupStorage();
    const posted: FromWorker[] = [];
    const engine = new ValidationEngine((m) => posted.push(m), storage);
    engine.handle(structuredClone({ type: 'init', snapshot: snapshotProject(store.project as Project) }) as ToWorker);
    const sync = { tableSources: [], commonSources: [] };
    engine.handle(structuredClone({ type: 'job', id: 1, job: { kind: 'backup', ...plan }, sync }) as ToWorker);
    await tick();
    expect(posted.at(-1)).toEqual({ type: 'done', id: 1, result: true });
    const record = storage.data.get(plan.key) as BackupRecord;
    expect(record.savedAt).toBe(99);
    expect(record.tables.map((t) => t.text)).toEqual([savePlanOf(store).files['tables/character.yaml']]);

    // 中身が読み込み元と同じテーブルだけなら、退避を消す
    const unchanged = { ...plan, targets: plan.targets.map((t) => ({ ...t, uid: table(store, 'skill').uid, baseHash: hashText(basicSampleFiles()['tables/skill.yaml']) })) };
    expect(await persistBackup(store.project as Project, storage, plan.key, plan.record, unchanged.targets)).toBe(false);
    expect(storage.data.has(plan.key)).toBe(false);
  });
});
