// ファイルの操作: フォルダを開く（FR-FIO-01）、サンプルを開く（P-45）、保存（FR-FIO-02）、閉じる
import { directSource, ensurePermission, pickDirectory, recallDirectory, rememberDirectory, supportsDirectAccess } from '../fs/direct';
import { downloadSource, filesToProject, pickFolderWithInput } from '../fs/download';
import { sampleSource } from '../fs/sample';
import type { SampleName } from '../fs/sample';
import type { AppStore } from '../store/AppStore';
import type { CommandDef } from './registry';

/** フォルダを選んで開く。直接保存方式が使えなければダウンロード保存方式（NFR-04） */
export async function openFolder(store: AppStore): Promise<void> {
  if (supportsDirectAccess()) {
    const handle = await pickDirectory();
    if (handle === null) return;
    if (!(await ensurePermission(handle))) {
      store.showStatus(store.t('ui.open.permissionDenied'), 'error');
      return;
    }
    if (await store.open(directSource(handle))) {
      await rememberDirectory(handle);
      store.setState({ lastFolder: handle.name });
    }
    return;
  }
  const files = await pickFolderWithInput();
  if (files === null) return;
  const picked = filesToProject(files);
  if (picked === null) {
    store.showStatus(store.t('ui.open.empty'), 'error');
    return;
  }
  await store.open(downloadSource(picked.name, picked.fs));
}

/** 前回のフォルダを開き直す（許可の確認を含む。FR-FIO-01） */
export async function openLastFolder(store: AppStore): Promise<void> {
  const handle = await recallDirectory();
  if (handle === null) {
    store.setState({ lastFolder: null });
    store.showStatus(store.t('ui.open.noLastFolder'), 'error');
    return;
  }
  if (!(await ensurePermission(handle))) {
    store.showStatus(store.t('ui.open.permissionDenied'), 'error');
    return;
  }
  await store.open(directSource(handle));
}

export async function openSample(store: AppStore, name: SampleName = 'basic'): Promise<void> {
  await store.open(sampleSource(name));
}

/** 起動時に、前回のフォルダの名前を読み込む（直接保存方式だけ） */
export async function loadLastFolderName(store: AppStore): Promise<void> {
  if (!supportsDirectAccess()) return;
  const handle = await recallDirectory();
  store.setState({ lastFolder: handle?.name ?? null });
}

export const fileCommands: CommandDef[] = [
  {
    id: 'file.open',
    labelKey: 'ui.command.openFolder',
    menu: { menu: 'file', group: 0, order: 0 },
    run: (store) => new Promise<void>((resolve) => store.confirmDiscard(() => openFolder(store).finally(resolve))),
  },
  {
    id: 'file.openLast',
    labelKey: 'ui.command.openLastFolder',
    label: (store) => {
      const name = store.getState().lastFolder;
      return name === null ? store.t('ui.command.openLastFolder') : store.t('ui.command.openLastFolderNamed', { name });
    },
    menu: { menu: 'file', group: 0, order: 1 },
    enabled: (store) => store.getState().lastFolder !== null,
    run: (store) => new Promise<void>((resolve) => store.confirmDiscard(() => openLastFolder(store).finally(resolve))),
  },
  {
    id: 'file.openSample',
    labelKey: 'ui.command.openSample',
    menu: { menu: 'file', group: 0, order: 2 },
    run: (store) => new Promise<void>((resolve) => store.confirmDiscard(() => openSample(store).finally(resolve))),
  },
  {
    id: 'file.save',
    labelKey: 'ui.command.save',
    shortcut: 'save',
    menu: { menu: 'file', group: 10, order: 0 },
    toolbar: { group: -10, order: 0, icon: 'save' },
    enabled: (store) => store.session !== null && !store.isSaving,
    run: (store) => store.save(),
  },
  {
    id: 'file.close',
    labelKey: 'ui.command.closeProject',
    menu: { menu: 'file', group: 90, order: 0 },
    enabled: (store) => store.project !== null,
    run: (store) => store.confirmDiscard(() => store.closeProject()),
  },
];
