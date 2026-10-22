// 検査の Web Worker 化（FR-VAL-09〜11、NFR-10、NFR-12、計画書 §4.2）。
// Worker にプロジェクトの複製を持たせ、メインスレッドで当てたパッチを同じ順で送って同期する。
// 検査・出力・正規形のテキストの作成を Worker で行い、メインスレッドを止めない。
// 時間制限（FR-VAL-10）を過ぎたら Worker を止めて作り直す（複製は送り直す）。Worker が使えなければメインスレッドで行う
import type { BrokenTable, Calculator, ExportOptions, ExportResult, Project } from '@masterdata-maker/core';
import { COMMON_PART_NAMES, snapshotProject } from '@masterdata-maker/core';
import type { BackupStorage } from '../fs/backupStore';
import { indexedDbBackupStorage } from '../fs/backupStore';
import type { BackupRecord, BackupTarget } from './backupRecord';
import { runJob } from '../worker/engine';
import type { FromWorker, Job, JobResult, JobResults, SerializeTarget, SerializedTable, SyncInfo, ToWorker } from '../worker/protocol';
import type { ValidationOutput, ValidationRequest, Validator, ValidatorFactory } from './validation';
import { ValidationFailure } from './validation';

/** 使う部分だけの Worker の型（テストでは偽物を渡す） */
export interface WorkerLike {
  postMessage(message: ToWorker): void;
  terminate(): void;
  onmessage: ((event: { data: FromWorker }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type CreateWorker = () => WorkerLike;

/** ブラウザの Worker を作る（Vite がこの形の new Worker を見つけて、Worker 用にまとめる） */
export function createBrowserWorker(): WorkerLike {
  return new Worker(new URL('../worker/validation.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

export const DEFAULT_TIME_LIMIT = 5000;
export const DEFAULT_EXPORT_TIME_LIMIT = 60_000;
export const DEFAULT_START_LIMIT = 60_000;

export interface WorkerValidatorOptions {
  /** Worker を作る。null ならメインスレッドだけで行う。省略時はブラウザの Worker */
  createWorker?: CreateWorker | null;
  /** 検査の時間制限（ミリ秒。Worker が受け取ってから数える。FR-VAL-10） */
  timeLimit?: number;
  /** 出力の時間制限（全テーブルの検査を含むので長めにする） */
  exportTimeLimit?: number;
  /** 頼んでから Worker が受け取るまでの時間制限（作り直した直後の複製の受け取りを含む） */
  startLimit?: number;
}

export interface WorkerStats {
  /** worker: Web Worker で行っている / main: メインスレッドで行っている（Worker が使えない） */
  mode: 'worker' | 'main';
  /** Worker で終えた仕事の数 */
  jobs: number;
  timeouts: number;
  restarts: number;
  /** 最後に複製を送ったときの、メインスレッドでかかった時間（ミリ秒） */
  lastInitMs: number;
}

/** 検査のほかに Worker に頼める仕事（出力・未保存の変更の退避） */
export interface BackgroundJobs {
  exportPlan(options: ExportOptions): Promise<ExportResult>;
  serializeTables(targets: SerializeTarget[]): Promise<SerializedTable[]>;
  /**
   * 未保存の変更を退避する（record.tables は targets から作る）。退避先が IndexedDB なら Worker が書き込む。
   * 書き込んだら true、退避するものが無くて消したら false
   */
  saveBackup(storage: BackupStorage, key: string, record: BackupRecord, targets: BackupTarget[]): Promise<boolean>;
}

interface Pending {
  id: number;
  job: Job;
  limit: number;
  resolve(result: JobResult): void;
  reject(e: unknown): void;
  timer: ReturnType<typeof setTimeout> | null;
  /** 複製のずれでやり直したか（やり直しは 1 回だけ） */
  retried: boolean;
}

const active = new WeakMap<Project, WorkerValidator>();

export class WorkerValidator implements Validator, BackgroundJobs {
  readonly stats: WorkerStats = { mode: 'worker', jobs: 0, timeouts: 0, restarts: 0, lastInitMs: 0 };
  private worker: WorkerLike | null = null;
  /** 今の Worker から一度でも返事があったか（無いまま失敗したら、Worker が使えないとみなす） */
  private workerAnswered = false;
  private fallback: boolean;
  private disposed = false;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  /** Worker に送った読み込みエラーのテーブル */
  private sentBroken: readonly BrokenTable[] = [];
  private timeLimit: number;
  private readonly exportTimeLimit: number;
  private readonly startLimit: number;

  constructor(
    private readonly project: Project,
    private readonly calc: Calculator,
    private readonly options: WorkerValidatorOptions = {},
  ) {
    this.fallback = options.createWorker === null;
    if (this.fallback) this.stats.mode = 'main';
    this.timeLimit = options.timeLimit ?? DEFAULT_TIME_LIMIT;
    this.exportTimeLimit = options.exportTimeLimit ?? DEFAULT_EXPORT_TIME_LIMIT;
    this.startLimit = options.startLimit ?? DEFAULT_START_LIMIT;
    active.set(project, this);
  }

  setTimeLimit(ms: number): void {
    this.timeLimit = ms;
  }

  // ---- Validator ----

  run(request: ValidationRequest): Promise<ValidationOutput> {
    return this.send({ kind: 'validate', request }) as Promise<ValidationOutput>;
  }

  notifyPatches(patches: Parameters<NonNullable<Validator['notifyPatches']>>[0]): void {
    // Worker がまだ無ければ送らない（作るときに今のモデルの複製を送るので、このパッチも含まれる）
    const worker = this.worker;
    if (worker === null || this.disposed || patches.length === 0) return;
    try {
      worker.postMessage({ type: 'patches', patches });
    } catch {
      // 送れなければ複製がずれるので、作り直して送り直す
      this.restart();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (active.get(this.project) === this) active.delete(this.project);
    this.terminate();
    for (const p of this.pending.values()) {
      if (p.timer !== null) clearTimeout(p.timer);
      // 検査の待ちは空の結果で終える（store は閉じたプロジェクトの結果を捨てる）
      if (p.job.kind === 'validate') p.resolve({ tables: new Map() });
      else p.reject(new Error('disposed'));
    }
    this.pending.clear();
  }

  // ---- BackgroundJobs ----

  exportPlan(options: ExportOptions): Promise<ExportResult> {
    return this.send({ kind: 'export', options }) as Promise<ExportResult>;
  }

  serializeTables(targets: SerializeTarget[]): Promise<SerializedTable[]> {
    return this.send({ kind: 'serialize', tables: targets }) as Promise<SerializedTable[]>;
  }

  saveBackup(storage: BackupStorage, key: string, record: BackupRecord, targets: BackupTarget[]): Promise<boolean> {
    // Worker が書き込めるのは IndexedDB だけ（テストなどで別の退避先を渡したら、メインスレッドで行う）
    if (storage !== indexedDbBackupStorage) return Promise.resolve(runJob(this.project, this.calc, { kind: 'backup', key, record, targets }, storage)) as Promise<boolean>;
    return this.send({ kind: 'backup', key, record, targets }) as Promise<boolean>;
  }

  // ---- 内部 ----

  private limitOf(job: Job): number {
    return job.kind === 'validate' ? this.timeLimit : this.exportTimeLimit;
  }

  private send(job: Job): Promise<JobResult> {
    if (this.disposed) return Promise.reject(new Error('disposed'));
    if (this.fallback) return this.runLocally(job);
    return new Promise<JobResult>((resolve, reject) => {
      const p: Pending = { id: this.nextId++, job, limit: this.limitOf(job), resolve, reject, timer: null, retried: false };
      this.pending.set(p.id, p);
      this.dispatch(p);
    });
  }

  private runLocally(job: Job): Promise<JobResult> {
    return Promise.resolve().then(() => runJob(this.project, this.calc, job, indexedDbBackupStorage));
  }

  private dispatch(p: Pending): void {
    const worker = this.ensureWorker();
    if (worker === null) {
      this.pending.delete(p.id);
      this.runLocally(p.job).then(p.resolve, p.reject);
      return;
    }
    p.timer = setTimeout(() => this.onTimeout(p.id), this.startLimit);
    try {
      worker.postMessage({ type: 'job', id: p.id, job: p.job, sync: this.syncInfo() });
    } catch (e) {
      if (p.timer !== null) clearTimeout(p.timer);
      this.pending.delete(p.id);
      p.reject(e);
    }
  }

  private ensureWorker(): WorkerLike | null {
    if (this.fallback) return null;
    if (this.worker !== null) return this.worker;
    let worker: WorkerLike;
    try {
      worker = (this.options.createWorker ?? createBrowserWorker)();
    } catch {
      this.switchToMainThread();
      return null;
    }
    worker.onmessage = (event) => this.onMessage(worker, event.data);
    worker.onerror = () => this.onWorkerError(worker);
    const started = performance.now();
    try {
      worker.postMessage({ type: 'init', snapshot: snapshotProject(this.project) });
    } catch {
      worker.terminate();
      this.switchToMainThread();
      return null;
    }
    this.stats.lastInitMs = performance.now() - started;
    this.worker = worker;
    this.workerAnswered = false;
    this.sentBroken = [...this.project.brokenTables];
    return worker;
  }

  /** パッチでは伝わらない変化（読み込み元のパス、読み込みエラーのテーブルの増減） */
  private syncInfo(): SyncInfo {
    const project = this.project;
    const sync: SyncInfo = {
      tableSources: project.tables.flatMap((t): SyncInfo['tableSources'] => (t.source === null ? [] : [[t.uid, t.source.path, t.source.format]])),
      commonSources: COMMON_PART_NAMES.map((part): SyncInfo['commonSources'][number] => {
        const source = project.common[part].source;
        return [part, source?.path ?? null, source?.format ?? null];
      }),
    };
    const broken = project.brokenTables;
    if (broken.length !== this.sentBroken.length || broken.some((b, i) => b !== this.sentBroken[i])) {
      sync.brokenTables = broken;
      this.sentBroken = [...broken];
    }
    return sync;
  }

  private onMessage(worker: WorkerLike, message: FromWorker): void {
    if (worker !== this.worker) return;
    this.workerAnswered = true;
    const p = this.pending.get(message.id);
    if (p === undefined) return;
    if (p.timer !== null) clearTimeout(p.timer);
    p.timer = null;
    switch (message.type) {
      case 'started':
        p.timer = setTimeout(() => this.onTimeout(p.id), p.limit);
        return;
      case 'done':
        this.pending.delete(p.id);
        this.stats.jobs++;
        p.resolve(message.result);
        return;
      case 'failed':
        if (message.desync && !p.retried) {
          // 複製がずれた: 送り直してやり直す
          p.retried = true;
          this.restart();
          return;
        }
        this.pending.delete(p.id);
        p.reject(new Error(message.message));
        return;
    }
  }

  private onTimeout(id: number): void {
    const p = this.pending.get(id);
    if (p === undefined) return;
    this.pending.delete(id);
    this.stats.timeouts++;
    // 止まらない Worker は捨てて作り直す（ほかの待ちは新しい Worker に頼み直す）
    this.restart();
    const seconds = Math.round(p.limit / 100) / 10;
    p.reject(new ValidationFailure(p.job.kind === 'validate' ? 'ui.worker.timeout' : 'ui.worker.jobTimeout', { seconds }));
  }

  private onWorkerError(worker: WorkerLike): void {
    if (worker !== this.worker) return;
    // 一度も返事が無いまま失敗した（モジュールを読めないなど）なら、Worker は使えない
    if (!this.workerAnswered) this.switchToMainThread();
    else this.restart();
  }

  private terminate(): void {
    const worker = this.worker;
    this.worker = null;
    if (worker === null) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  }

  /** Worker を作り直し、待っている仕事を頼み直す */
  private restart(): void {
    this.terminate();
    if (this.disposed) return;
    this.stats.restarts++;
    for (const p of [...this.pending.values()]) {
      if (p.timer !== null) clearTimeout(p.timer);
      p.timer = null;
      this.dispatch(p);
    }
  }

  /** メインスレッドで行うことにする（待っている仕事もメインスレッドで行う） */
  private switchToMainThread(): void {
    this.terminate();
    this.fallback = true;
    this.stats.mode = 'main';
    for (const p of [...this.pending.values()]) {
      if (p.timer !== null) clearTimeout(p.timer);
      this.pending.delete(p.id);
      this.runLocally(p.job).then(p.resolve, p.reject);
    }
  }
}

/** プロジェクトの Worker（検査の実行役が WorkerValidator でなければ、メインスレッドで行う） */
export function backgroundJobs(project: Project, calc: Calculator): BackgroundJobs {
  const validator = active.get(project);
  if (validator !== undefined) return validator;
  return {
    exportPlan: async (options) => runJob(project, calc, { kind: 'export', options }) as JobResults['export'],
    serializeTables: async (tables) => runJob(project, calc, { kind: 'serialize', tables }) as JobResults['serialize'],
    saveBackup: async (storage, key, record, targets) => (await runJob(project, calc, { kind: 'backup', key, record, targets }, storage)) as boolean,
  };
}

/**
 * 検査の実行役を作る関数（AppStore の validator に渡す）。開発・画面テスト用に、globalThis.masterdataMakerWorker から
 * 状態（stats）を見たり、時間制限を変えたりできる
 */
export function createValidatorFactory(options: WorkerValidatorOptions = {}): ValidatorFactory {
  const debug = { current: null as WorkerValidator | null, timeLimit: options.timeLimit };
  (globalThis as { masterdataMakerWorker?: unknown }).masterdataMakerWorker = {
    stats: (): WorkerStats | null => (debug.current === null ? null : { ...debug.current.stats }),
    setTimeLimit: (ms: number): void => {
      debug.timeLimit = ms;
      debug.current?.setTimeLimit(ms);
    },
  };
  return (project, calc) => {
    const validator = new WorkerValidator(project, calc, { ...options, timeLimit: debug.timeLimit });
    debug.current = validator;
    return validator;
  };
}
