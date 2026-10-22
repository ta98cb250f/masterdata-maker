// 未保存の変更の退避と復元（FR-FIO-06）。
// 変更の後、少し待ってから、未保存のテーブル（正規形のテキスト）・共通設定のテキスト・削除したテーブルのファイルを IndexedDB に退避する。
// 保存した・変更を捨てた・プロジェクトを閉じたときは消す。異常終了などで退避が残ったまま同じプロジェクトを開いたら、復元を提案する
// （復元すると、保存していない変更として読み込む。1 回の操作なので元に戻すで取り消せる）。
// プロジェクトの同一性: フォルダの名前・プロジェクト設定ファイルのパスと中身が同じなら同じプロジェクトとみなす
// （直接保存方式では、さらにフォルダのハンドルの isSameEntry が偽なら別のプロジェクトとする）
import type { CommonPartName, FieldDef, Patch, Project, StorageFormat, Table, Transaction } from '@sheetcraft/core';
import {
  COMMON_PART_NAMES,
  defaultBaseFields,
  defaultColors,
  defaultEnums,
  extensionOf,
  joinPath,
  parseCommonFile,
  parseTableFile,
  resolveProjectPaths,
  serializeCommonPart,
  toTableData,
} from '@sheetcraft/core';
import type { BackupStorage } from '../fs/backupStore';
import { indexedDbBackupStorage } from '../fs/backupStore';
import { DirectoryProjectFs } from '../fs/direct';
import type { ProjectSource } from '../fs/types';
import type { AppStore } from './AppStore';
import type { BackupCommon, BackupRecord, BackupTarget, ProjectIdentity } from './backupRecord';
import { BACKUP_VERSION, backupTables, hashText, hashTextSliced } from './backupRecord';
import { openDecisionDialog } from './dialogDecision';
import { backgroundJobs } from './workerValidator';

export type { BackupCommon, BackupRecord, BackupTable, ProjectIdentity } from './backupRecord';
export { BACKUP_VERSION, hashText } from './backupRecord';

export const BACKUP_PREFIX = 'sheetcraft.backup:';
export const BACKUP_DIALOG = 'backupRestore';
/** 変更の後、退避するまでの待ち時間（ミリ秒） */
export const DEFAULT_BACKUP_DELAY = 800;

export function projectIdentity(project: Project, source: ProjectSource): ProjectIdentity | null {
  const config = project.config.source;
  if (config === null) return null;
  return { name: source.name, configPath: config.path, configText: config.text };
}

/** 退避先のキー（同じプロジェクトなら同じキー） */
export function backupKey(identity: ProjectIdentity): string {
  return `${BACKUP_PREFIX}${hashText(`${identity.name}\n${identity.configPath}\n${identity.configText}`)}`;
}

interface HandleLike {
  isSameEntry?(other: unknown): Promise<boolean>;
}

function directHandle(source: ProjectSource): HandleLike | null {
  return source.fs instanceof DirectoryProjectFs ? (source.fs.root as unknown as HandleLike) : null;
}

/** 退避した内容が、開いたプロジェクトのものか */
export async function isSameProject(record: BackupRecord, identity: ProjectIdentity, source: ProjectSource): Promise<boolean> {
  const p = record.project;
  if (record.version !== BACKUP_VERSION || p.name !== identity.name || p.configPath !== identity.configPath || p.configText !== identity.configText) {
    return false;
  }
  const handle = directHandle(source);
  if (handle?.isSameEntry !== undefined && record.handle !== undefined && record.handle !== null) {
    try {
      if (!(await handle.isSameEntry(record.handle))) return false;
    } catch {
      // 比べられなければ、名前と設定ファイルで判定する
    }
  }
  return true;
}

function formatOf(project: Project, table: Table): StorageFormat {
  return table.source?.format ?? project.config.storage.format;
}

function commonFormat(project: Project, part: CommonPartName): StorageFormat {
  return project.common[part].source?.format ?? project.config.storage.format;
}

function commonPath(project: Project, part: CommonPartName): string {
  const source = project.common[part].source;
  if (source !== null) return source.path;
  return joinPath(resolveProjectPaths(project.config).configDir, `${part}.${extensionOf(commonFormat(project, part))}`);
}

/** ハッシュを、元のテキストが同じあいだ覚えておく（1 万行のテーブルでも、退避のたびに計算し直さない） */
const hashCache = new Map<string, { text: string; hash: string }>();

function cachedHash(path: string, text: string): string {
  const cached = hashCache.get(path);
  if (cached !== undefined && cached.text === text) return cached.hash;
  const hash = hashText(text);
  hashCache.set(path, { text, hash });
  return hash;
}

/** cachedHash と同じ。長いテキストは区切って求める（メインスレッドを止めない） */
async function cachedHashSliced(path: string, text: string): Promise<string> {
  const cached = hashCache.get(path);
  if (cached !== undefined && cached.text === text) return cached.hash;
  const hash = await hashTextSliced(text);
  hashCache.set(path, { text, hash });
  return hash;
}

/** 退避の計画: キー・テーブルのテキスト以外の内容・テキストを作るテーブル */
export interface BackupPlan {
  key: string;
  record: BackupRecord;
  targets: BackupTarget[];
}

/**
 * 退避する内容を決める。未保存の変更が無ければ null。テーブルの正規形のテキストは、書き込むときに（Worker で）作る
 */
export async function planBackup(store: AppStore, now: number = Date.now()): Promise<BackupPlan | null> {
  const { project, session, source } = store.getState();
  if (project === null || session === null || source === null) return null;
  const identity = projectIdentity(project, source);
  if (identity === null || !store.isProjectModified()) return null;
  const targets: BackupTarget[] = [];
  for (const table of project.tables) {
    if (!session.isTableModified(table.uid)) continue;
    const base = table.source;
    targets.push({
      uid: table.uid,
      format: formatOf(project, table),
      basePath: base?.path ?? null,
      baseHash: base === null ? null : await cachedHashSliced(base.path, base.text),
    });
  }
  // ハッシュを求める間にプロジェクトを閉じた・開き直したら捨てる
  if (store.project !== project) return null;
  const common: BackupCommon[] = [];
  for (const part of COMMON_PART_NAMES) {
    if (!session.isCommonDirty(part)) continue;
    const format = commonFormat(project, part);
    common.push({
      part,
      path: commonPath(project, part),
      format,
      text: project.common[part].isDefault ? null : serializeCommonPart(project.common, part, format),
    });
  }
  const record: BackupRecord = { version: BACKUP_VERSION, savedAt: now, project: identity, tables: [], common, removed: session.removedTableFiles() };
  const handle = directHandle(source);
  if (handle !== null) record.handle = handle;
  return { key: backupKey(identity), record, targets };
}

/** 退避する内容（テーブルのテキストを含む）を作る。未保存の変更が無ければ null（テスト・確認用。メインスレッドで作る） */
export async function buildBackup(store: AppStore, now: number = Date.now()): Promise<BackupRecord | null> {
  const plan = await planBackup(store, now);
  const project = store.project;
  if (plan === null || project === null) return null;
  const tables = backupTables(project, plan.targets);
  if (tables.length === 0 && plan.record.common.length === 0 && plan.record.removed.length === 0) return null;
  return { ...plan.record, tables };
}

/** 復元の内容の 1 項目（ダイアログに出す） */
export interface RestoreItem {
  kind: 'table' | 'newTable' | 'removed' | 'common';
  label: string;
  path: string | null;
  /** 退避した後に、ファイルが書き換えられている */
  changedSince: boolean;
}

export interface RestorePlan {
  tx: Transaction;
  items: RestoreItem[];
  /** 復元できなかったもの（ファイルの名前） */
  skipped: string[];
}

function defaultCommonItems(part: CommonPartName): unknown[] {
  if (part === 'enums') return defaultEnums();
  if (part === 'base_fields') return defaultBaseFields();
  return defaultColors();
}

/**
 * 退避した内容を今のモデルに当てるトランザクションを作る（モデルは変えない）。
 * テーブルは読み込み元のファイルで突き合わせ、中身を退避したテキストに置き換える（内部番号は今のテーブルのまま）
 */
export function planRestore(project: Project, record: BackupRecord): RestorePlan {
  const patches: Patch[] = [];
  const touched: number[] = [];
  const items: RestoreItem[] = [];
  const skipped: string[] = [];
  const storage = project.config.storage.format;
  const paths = resolveProjectPaths(project.config);
  let baseFields: readonly FieldDef[] = project.common.base_fields.items;

  for (const c of record.common) {
    let commonItems: unknown[];
    if (c.text === null) {
      commonItems = defaultCommonItems(c.part);
    } else {
      const parsed = parseCommonFile(c.part, c.path, c.text);
      if (!parsed.ok) {
        skipped.push(c.path);
        continue;
      }
      commonItems = parsed.value;
    }
    // 共通列のフィールド番号は作り直さない（退避したテーブルのテキストの番号をそのまま使う。P-63）
    const protos = c.part === 'base_fields' ? { protos: [] } : {};
    patches.push({ op: 'setCommon', part: c.part, items: commonItems, isDefault: c.text === null, ...protos } as Patch);
    if (c.part === 'base_fields') baseFields = commonItems as FieldDef[];
    items.push({ kind: 'common', label: c.path, path: c.path, changedSince: false });
  }

  // 削除したテーブル（名前を変えたテーブルが、その名前を使うことがあるので先に消す）
  const names = new Set(project.tables.map((t) => t.name));
  for (const path of record.removed) {
    const table = project.tables.find((t) => t.source?.path === path);
    if (table === undefined) continue;
    patches.push({ op: 'removeTable', table: table.uid });
    touched.push(table.uid);
    names.delete(table.name);
    items.push({ kind: 'removed', label: table.display_name ?? table.name, path, changedSince: false });
  }

  for (const t of record.tables) {
    const target = t.basePath === null ? undefined : project.tables.find((x) => x.source?.path === t.basePath);
    const path = t.basePath ?? joinPath(paths.tablesDir, `${t.name}.${extensionOf(t.format)}`);
    const parsed = parseTableFile(path, t.text, { baseFields, uids: project.uids, storageFormat: storage });
    if (parsed.kind !== 'table') {
      skipped.push(path);
      continue;
    }
    if (target !== undefined) {
      names.delete(target.name);
      if (names.has(parsed.name)) {
        skipped.push(path);
        names.add(target.name);
        continue;
      }
      const data = toTableData(parsed);
      data.uid = target.uid;
      data.source = target.source === null ? null : { ...target.source };
      patches.push({ op: 'removeTable', table: target.uid }, { op: 'addTable', table: data });
      touched.push(target.uid);
      names.add(parsed.name);
      const changedSince = t.baseHash !== null && target.source !== null && cachedHash(target.source.path, target.source.text) !== t.baseHash;
      items.push({ kind: 'table', label: parsed.display_name ?? parsed.name, path: t.basePath, changedSince });
      continue;
    }
    // 新しく作ったテーブル（または、読み込み元のファイルが無くなったテーブル）は、新しいテーブルとして足す
    if (names.has(parsed.name) || project.brokenTables.some((b) => b.name === parsed.name)) {
      skipped.push(path);
      continue;
    }
    const data = toTableData(parsed);
    data.source = null;
    patches.push({ op: 'addTable', table: data });
    touched.push(data.uid);
    names.add(parsed.name);
    items.push({ kind: 'newTable', label: parsed.display_name ?? parsed.name, path: t.basePath, changedSince: t.basePath !== null });
  }
  return { tx: { label: 'ui.backup.restoreOp', patches, inverse: [], tables: touched }, items, skipped };
}

export interface RestoreDialogArgs {
  record: BackupRecord;
  items: RestoreItem[];
  skipped: string[];
  /** restore: 復元する / discard: 復元せずに消す / later: 決めない（退避は残す） */
  onDecide(choice: 'restore' | 'discard' | 'later'): void;
}

export interface BackupOptions {
  storage?: BackupStorage;
  /** 変更の後、退避するまでの待ち時間 */
  delay?: number;
  now?: () => number;
}

/** 退避と復元の受け持ち。store の状態を見て、プロジェクトを開いた・閉じた・変更したときに動く */
export class BackupManager {
  readonly storage: BackupStorage;
  private readonly delay: number;
  private readonly now: () => number;
  private project: Project | null = null;
  private source: ProjectSource | null = null;
  private key: string | null = null;
  private revision = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** 復元を提案している間は退避しない（残っている退避を上書きしない） */
  private proposing = false;
  /** 提案の間に変更があった（退避するものが無いと分かったら、すぐに退避する） */
  private missed = false;
  private chain: Promise<void> = Promise.resolve();
  /** 提案のダイアログの答えを待っているとき、答えずに終わらせる */
  private pendingDecision: (() => void) | null = null;
  /** 最後に書き込んだ・消した日時（テスト用） */
  lastWrite: { at: number; kind: 'set' | 'del' } | null = null;

  constructor(
    private readonly store: AppStore,
    options: BackupOptions = {},
  ) {
    this.storage = options.storage ?? indexedDbBackupStorage;
    this.delay = options.delay ?? DEFAULT_BACKUP_DELAY;
    this.now = options.now ?? Date.now;
  }

  /** store の状態が変わったとき */
  sync = (): void => {
    const state = this.store.getState();
    if (state.project !== this.project) {
      this.onProjectChanged(state.project, state.source);
      return;
    }
    if (state.revision !== this.revision) {
      this.revision = state.revision;
      this.schedule();
    }
  };

  private onProjectChanged(project: Project | null, source: ProjectSource | null): void {
    this.cancelTimer();
    // 提案に答えないまま別のプロジェクトを開いた・閉じた（退避は残す）
    this.pendingDecision?.();
    const oldKey = this.key;
    // 画面から閉じた・別のプロジェクトを開いた（未保存の変更は確認して捨てた）ので、前のプロジェクトの退避は消す
    if (oldKey !== null && !this.proposing) this.enqueue(() => this.remove(oldKey));
    this.project = project;
    this.source = source;
    this.revision = this.store.getState().revision;
    this.proposing = false;
    this.missed = false;
    const identity = project === null || source === null ? null : projectIdentity(project, source);
    this.key = identity === null ? null : backupKey(identity);
    if (project !== null && source !== null && identity !== null && this.key !== null) {
      const key = this.key;
      this.proposing = true;
      this.enqueue(() => this.propose(project, source, identity, key));
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(task).catch(() => undefined);
    return this.chain;
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.key === null) return;
    if (this.proposing) {
      this.missed = true;
      return;
    }
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delay);
  }

  /** 予約した退避をすぐに行う（ページを隠すときなど） */
  flush(): Promise<void> {
    this.cancelTimer();
    const project = this.project;
    const key = this.key;
    if (project === null || key === null || this.proposing) return this.chain;
    return this.enqueue(async () => {
      const { calc } = this.store.getState();
      if (this.store.project !== project || calc === null) return;
      const plan = await planBackup(this.store, this.now());
      if (this.store.project !== project || this.proposing) return;
      if (plan === null) {
        await this.remove(key);
        return;
      }
      // テーブルのテキストを作って書き込むのは Worker（メインスレッドを止めない）
      const written = await backgroundJobs(project, calc).saveBackup(this.storage, plan.key, plan.record, plan.targets);
      this.lastWrite = { at: this.now(), kind: written ? 'set' : 'del' };
    });
  }

  /** すべての退避・提案の処理が終わるまで待つ（テスト用） */
  idle(): Promise<void> {
    return this.chain;
  }

  private async remove(key: string): Promise<void> {
    await this.storage.del(key);
    this.lastWrite = { at: this.now(), kind: 'del' };
  }

  private async propose(project: Project, source: ProjectSource, identity: ProjectIdentity, key: string): Promise<void> {
    const record = (await this.storage.get(key)) as BackupRecord | undefined;
    const valid = record !== undefined && record !== null && (await isSameProject(record, identity, source));
    if (!valid || this.store.project !== project) {
      if (this.project === project) {
        this.proposing = false;
        if (this.missed) this.schedule();
      }
      return;
    }
    const plan = planRestore(project, record);
    const choice = await openDecisionDialog<'restore' | 'discard' | 'later'>(
      this.store,
      BACKUP_DIALOG,
      (onDecide): RestoreDialogArgs => ({ record, items: plan.items, skipped: plan.skipped, onDecide }),
      'later',
      (cancel) => {
        this.pendingDecision = cancel;
      },
    );
    this.pendingDecision = null;
    this.decide(project, key, record, choice);
  }

  private decide(project: Project, key: string, record: BackupRecord, choice: 'restore' | 'discard' | 'later'): void {
    if (this.store.project !== project) return;
    this.proposing = false;
    this.missed = false;
    this.revision = this.store.getState().revision;
    if (choice === 'discard') {
      void this.enqueue(() => this.remove(key));
      return;
    }
    if (choice === 'later') return;
    // 提案した後に編集していることもあるので、今のモデルでトランザクションを作り直す
    const plan = planRestore(project, record);
    try {
      const result = this.store.apply({ ok: true, tx: plan.tx });
      if (!result.ok) throw new Error('restore failed');
    } catch {
      this.store.openDialog('message', { titleKey: 'ui.backup.failedTitle', messageKey: 'ui.backup.failedMessage', tone: 'error' });
      return;
    }
    if (plan.skipped.length > 0) {
      this.store.openDialog('message', { titleKey: 'ui.backup.skippedTitle', items: plan.skipped, tone: 'error' });
    } else {
      this.store.showStatus(this.store.t('ui.backup.restored', { count: plan.items.length }));
    }
  }
}

export interface BackupHandle {
  manager: BackupManager;
  dispose(): void;
}

/** 退避と復元を store につなぐ。ページを隠すとき（タブを閉じる・切り替える）は、待たずに退避する */
export function installBackup(store: AppStore, options: BackupOptions = {}): BackupHandle {
  const manager = new BackupManager(store, options);
  // 開発・画面テスト用に、外から退避の状態を見られるようにする
  (globalThis as { sheetcraftBackup?: BackupManager }).sheetcraftBackup = manager;
  manager.sync();
  const unsubscribe = store.subscribe(manager.sync);
  const onHide = () => {
    if (typeof document === 'undefined' || document.visibilityState === 'hidden') void manager.flush();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHide);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onHide);
  return {
    manager,
    dispose: () => {
      unsubscribe();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHide);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onHide);
    },
  };
}
