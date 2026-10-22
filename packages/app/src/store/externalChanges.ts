// 外部での変更の検知（FR-FIO-07。直接保存方式だけ。ダウンロード保存方式で使えないことは NFR-05 で示している）。
// ウィンドウに戻ったとき（focus / visibilitychange）と保存の直前に、読み込んだファイルの更新日時を確かめる。
// 更新日時が変わっていれば中身を読み、エディタが知っているファイルの中身（読み込んだ・最後に保存したテキスト）と違えば、
// ほかのエディタや Git で書き換えられたとみなし、ファイルごとに「読み込み直す」か「上書きする」かを選ばせる。
// 読み込み直したテーブルを指す元に戻す履歴は当てられなくなるので、そういう履歴があれば履歴をすべて消して、その旨を示す
import type { CommonPartName, CommonReload, FieldDef, Project, TableReload } from '@masterdata-maker/core';
import { COMMON_PART_NAMES, defaultBaseFields, formatDiagnostic, formatFromPath, parseCommonFile, parseTableFile } from '@masterdata-maker/core';
import type { ProjectSource } from '../fs/types';
import type { AppStore } from './AppStore';
import { openDecisionDialog } from './dialogDecision';

export type TrackedKind = 'table' | 'broken' | 'common' | 'config';

/** 読み込んだファイル（エディタが中身を知っているファイル） */
export interface TrackedFile {
  path: string;
  kind: TrackedKind;
  /** テーブル（読み込みエラーのテーブルを含む）の uid */
  uid?: number;
  part?: CommonPartName;
  /** エディタが知っているファイルの中身（読み込んだ・最後に保存したテキスト） */
  known: string | null;
  /** 画面に出す名前 */
  label: string;
}

export interface ExternalChange extends TrackedFile {
  /** ファイルの今の中身。消されていれば null */
  text: string | null;
  /** ファイルの今の更新日時。消されていれば null */
  mtime: number | null;
  /** そのファイルに当たるエディタの内容に、保存していない変更があるか（設定ファイルならプロジェクト全体） */
  unsaved: boolean;
}

/** reload: 読み込み直す / keep: エディタの内容で上書きする（設定ファイル・読み込みエラーのテーブルは「このままにする」） */
export type ChangeChoice = 'reload' | 'keep';

export type CheckMode = 'focus' | 'save';

export interface ExternalChangesDialogArgs {
  changes: ExternalChange[];
  mode: CheckMode;
  /** 選んだ内容（パス → 選択）。取り消したら null。ダイアログを閉じる前に呼ぶ */
  onDecide(choices: ReadonlyMap<string, ChangeChoice> | null): void;
}

export const EXTERNAL_CHANGES_DIALOG = 'externalChanges';

/** 既定の選択: 保存していない変更があれば上書き（変更を失わない側）、無ければ読み込み直す */
export function defaultChoice(change: ExternalChange): ChangeChoice {
  if (change.kind === 'broken') return 'reload';
  return change.unsaved ? 'keep' : 'reload';
}

/** 今のモデルが読み込んだファイル */
export function trackedFiles(project: Project): TrackedFile[] {
  const files: TrackedFile[] = [];
  const config = project.config.source;
  if (config !== null) files.push({ path: config.path, kind: 'config', known: config.text, label: config.path });
  for (const part of COMMON_PART_NAMES) {
    const source = project.common[part].source;
    if (source !== null) files.push({ path: source.path, kind: 'common', part, known: source.text, label: source.path });
  }
  for (const table of project.tables) {
    if (table.source !== null) {
      files.push({ path: table.source.path, kind: 'table', uid: table.uid, known: table.source.text, label: table.display_name ?? table.name });
    }
  }
  for (const table of project.brokenTables) {
    files.push({ path: table.source.path, kind: 'broken', uid: table.uid, known: table.source.text, label: table.name });
  }
  return files;
}

interface FileRecord {
  mtime: number | null;
  /** 記録したときの、エディタが知っている中身（同じオブジェクトかどうかで、保存や読み込み直しを見分ける） */
  known: string | null;
}

export class ExternalChangeWatcher {
  private readonly records = new Map<string, FileRecord>();
  /** ウィンドウに戻ったときの確認で「あとで」にした変更（パス → 更新日時）。同じ変更は保存するまで聞き直さない */
  private readonly dismissed = new Map<string, number | null>();
  private checking: Promise<ExternalChange[]> | null = null;
  private deciding = false;

  constructor(
    private readonly store: AppStore,
    readonly project: Project,
    private readonly source: ProjectSource & { lastModified(path: string): Promise<number | null> },
  ) {}

  private async mtimeOf(path: string): Promise<number | null> {
    try {
      return await this.source.lastModified(path);
    } catch {
      return null;
    }
  }

  /** 開いた直後: 読み込んだファイルの更新日時を覚える */
  async remember(): Promise<void> {
    await Promise.all(
      trackedFiles(this.project).map(async (f) => {
        this.records.set(f.path, { mtime: await this.mtimeOf(f.path), known: f.known });
      }),
    );
  }

  /**
   * 保存・読み込み直しの後: エディタが知っている中身が変わったファイル（自分で書いた・読み直した）の更新日時を覚え直す
   */
  async rememberWritten(): Promise<void> {
    const targets = trackedFiles(this.project).filter((f) => {
      const record = this.records.get(f.path);
      return record !== undefined && record.known !== f.known;
    });
    await Promise.all(
      targets.map(async (f) => {
        this.records.set(f.path, { mtime: await this.mtimeOf(f.path), known: f.known });
      }),
    );
  }

  /** 外部で書き換えられたファイル（同時に呼ばれたら、同じ結果を返す） */
  detect(): Promise<ExternalChange[]> {
    this.checking ??= this.detectNow().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async detectNow(): Promise<ExternalChange[]> {
    const changes: ExternalChange[] = [];
    for (const file of trackedFiles(this.project)) {
      const record = this.records.get(file.path);
      const mtime = await this.mtimeOf(file.path);
      if (record !== undefined && record.mtime === mtime) continue;
      let text: string | null;
      try {
        text = mtime === null ? null : await this.source.fs.read(file.path);
      } catch {
        continue;
      }
      // 中身が同じなら（自分で保存した・更新日時だけ変わった）、更新日時を覚え直すだけ
      if (text === file.known) {
        this.records.set(file.path, { mtime, known: file.known });
        continue;
      }
      changes.push({ ...file, text, mtime, unsaved: this.isUnsaved(file) });
    }
    return changes;
  }

  private isUnsaved(file: TrackedFile): boolean {
    const session = this.store.session;
    if (session === null) return false;
    switch (file.kind) {
      case 'table':
        return file.uid !== undefined && this.store.isTableModified(file.uid);
      case 'common':
        return file.part !== undefined && session.isCommonDirty(file.part);
      case 'config':
        return this.store.isProjectModified();
      case 'broken':
        return false;
    }
  }

  private ask(changes: ExternalChange[], mode: CheckMode): Promise<ReadonlyMap<string, ChangeChoice> | null> {
    return openDecisionDialog<ReadonlyMap<string, ChangeChoice> | null>(
      this.store,
      EXTERNAL_CHANGES_DIALOG,
      (onDecide): ExternalChangesDialogArgs => ({ changes, mode, onDecide }),
      null,
    );
  }

  /** ウィンドウに戻ったとき。ほかのダイアログを開いているときや保存の途中は、次の機会にする */
  async onFocus(): Promise<void> {
    if (this.deciding || this.store.isSaving || this.store.getState().dialogs.length > 0) return;
    const changes = (await this.detect()).filter((c) => !this.dismissed.has(c.path) || this.dismissed.get(c.path) !== c.mtime);
    if (changes.length === 0 || this.deciding || this.store.project !== this.project || this.store.getState().dialogs.length > 0) return;
    this.deciding = true;
    try {
      const choices = await this.ask(changes, 'focus');
      if (choices === null) {
        for (const c of changes) this.dismissed.set(c.path, c.mtime);
        return;
      }
      await this.apply(changes, choices);
    } finally {
      this.deciding = false;
    }
  }

  /** 保存の直前。true なら保存を続ける */
  async beforeSave(): Promise<boolean> {
    if (this.deciding) return false;
    const changes = await this.detect();
    if (changes.length === 0) return true;
    this.deciding = true;
    try {
      const choices = await this.ask(changes, 'save');
      if (choices === null) return false;
      return await this.apply(changes, choices);
    } finally {
      this.deciding = false;
    }
  }

  /**
   * 選んだ内容を当てる。設定ファイルを読み込み直すときは、プロジェクトを開き直す（false を返す。保存は続けない）。
   * 保存していない変更が失われることの確認は、ダイアログで済ませている
   */
  async apply(changes: readonly ExternalChange[], choices: ReadonlyMap<string, ChangeChoice>): Promise<boolean> {
    const store = this.store;
    const session = store.session;
    if (session === null || store.project !== this.project) return false;
    const choiceOf = (c: ExternalChange) => choices.get(c.path) ?? defaultChoice(c);
    if (changes.some((c) => c.kind === 'config' && choiceOf(c) === 'reload')) {
      // 設定ファイルはすべてのファイルの読み方に関わるので、プロジェクトごと開き直す
      await store.open(this.source);
      return false;
    }
    const project = this.project;
    const storage = project.config.storage.format;
    const commonReloads: CommonReload[] = [];
    const tableReloads: TableReload[] = [];
    const keepTables: { uid: number; text: string | null }[] = [];
    const keepCommon: { part: CommonPartName; text: string | null }[] = [];
    const problems: string[] = [];
    const handled: ExternalChange[] = [];
    for (const c of changes) {
      const choice = choiceOf(c);
      if (c.kind === 'common' && c.part !== undefined) {
        if (choice === 'keep') {
          keepCommon.push({ part: c.part, text: c.text });
          handled.push(c);
          continue;
        }
        if (c.text === null) {
          commonReloads.push({ part: c.part, next: null } as CommonReload);
          handled.push(c);
          continue;
        }
        const parsed = parseCommonFile(c.part, c.path, c.text);
        if (!parsed.ok) {
          // 読めない共通設定には切り替えない（今の内容のまま。同じ変更は聞き直さない）
          problems.push(...parsed.diagnostics.map((d) => `${c.path}: ${formatDiagnostic(d, store.getState().locale)}`));
          this.dismissed.set(c.path, c.mtime);
          continue;
        }
        const source = { path: c.path, format: formatFromPath(c.path) ?? storage, text: c.text };
        commonReloads.push({ part: c.part, next: { items: parsed.value, source } } as CommonReload);
        handled.push(c);
      } else if ((c.kind === 'table' || c.kind === 'broken') && c.uid !== undefined) {
        handled.push(c);
        if (choice === 'keep') {
          if (c.kind === 'table') keepTables.push({ uid: c.uid, text: c.text });
          continue;
        }
        tableReloads.push({ uid: c.uid, next: null });
      } else {
        handled.push(c);
      }
    }
    // 共通列を読み直すなら、テーブルは新しい共通列で読む（ファイルが消されたなら既定の共通列）
    let baseFields: readonly FieldDef[] = project.common.base_fields.items;
    for (const r of commonReloads) if (r.part === 'base_fields') baseFields = r.next?.items ?? defaultBaseFields();
    for (const reload of tableReloads) {
      const change = changes.find((c) => c.uid === reload.uid);
      if (change === undefined || change.text === null) continue;
      reload.next = parseTableFile(change.path, change.text, { baseFields, uids: project.uids, storageFormat: storage });
    }
    // 読み込み直すテーブルを編集中なら、編集をやめる
    const editing = store.getState().editing;
    if (editing !== null && tableReloads.some((r) => r.uid === editing.table)) store.cancelEdit();

    let historyCleared = false;
    if (keepTables.length > 0 || keepCommon.length > 0) session.keepEditorContent({ tables: keepTables, common: keepCommon });
    if (tableReloads.length > 0 || commonReloads.length > 0) {
      historyCleared = session.reloadFiles({ tables: tableReloads, common: commonReloads }).historyCleared;
      // 読み込みエラーのテーブルの増減はパッチでは伝わらないので、全体を検査し直す
      store.scheduleValidation('all', 0);
    }
    for (const c of handled) {
      const known = trackedFiles(project).find((f) => f.path === c.path)?.known ?? null;
      this.records.set(c.path, { mtime: c.mtime, known });
      this.dismissed.delete(c.path);
    }
    const reloaded = tableReloads.length + commonReloads.length;
    const kept = keepTables.length + keepCommon.length;
    if (problems.length > 0) {
      store.openDialog('message', { titleKey: 'ui.external.reloadFailedTitle', items: problems, tone: 'error' });
    } else if (reloaded > 0) {
      store.showStatus(store.t(historyCleared ? 'ui.external.reloadedHistoryCleared' : 'ui.external.reloaded', { count: reloaded }));
    } else if (kept > 0) {
      store.showStatus(store.t('ui.external.kept', { count: kept }));
    }
    return true;
  }
}

/** 直接保存方式で、更新日時を取れる読み込み口か */
function watchableSource(source: ProjectSource | null): (ProjectSource & { lastModified(path: string): Promise<number | null> }) | null {
  if (source === null || !source.capabilities.detectExternalChanges || source.lastModified === undefined) return null;
  return source as ProjectSource & { lastModified(path: string): Promise<number | null> };
}

export interface ExternalChangesHandle {
  /** 今のプロジェクトの見張り役（テスト用） */
  current(): ExternalChangeWatcher | null;
  dispose(): void;
}

/**
 * 外部での変更の検知を store につなぐ。プロジェクトを開くたびに見張り役を作り、ウィンドウに戻ったときと保存の直前に確かめる
 */
export function installExternalChanges(store: AppStore, target: Pick<Window, 'addEventListener' | 'removeEventListener'> | null = typeof window === 'undefined' ? null : window): ExternalChangesHandle {
  let watcher: ExternalChangeWatcher | null = null;
  let project: Project | null = null;
  let revision = -1;

  const sync = () => {
    const state = store.getState();
    if (state.project !== project) {
      project = state.project;
      revision = state.revision;
      const source = watchableSource(state.source);
      watcher = project === null || source === null ? null : new ExternalChangeWatcher(store, project, source);
      void watcher?.remember();
      return;
    }
    if (state.revision !== revision) {
      revision = state.revision;
      void watcher?.rememberWritten();
    }
  };
  sync();
  const unsubscribe = store.subscribe(sync);
  const removeGuard = store.addSaveGuard(async () => (watcher === null || watcher.project !== store.project ? true : watcher.beforeSave()));
  const onFocus = () => void watcher?.onFocus();
  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') onFocus();
  };
  target?.addEventListener('focus', onFocus);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  return {
    current: () => watcher,
    dispose: () => {
      unsubscribe();
      removeGuard();
      target?.removeEventListener('focus', onFocus);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
