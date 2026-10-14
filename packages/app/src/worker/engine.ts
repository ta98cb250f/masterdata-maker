// 検査用の Web Worker の中身（Worker の外でも動くように、受け取ったメッセージを処理する関数として切り出す）。
// 検査は core の validate（CLI と同じ処理。FR-VAL-11）を、メインスレッドと同じパッチで同期した複製に対して行う
import type { Project } from '@sheetcraft/core';
import {
  Calculator,
  SerializeError,
  applyPatches,
  invalidateForPatches,
  planExport,
  restoreProject,
  serializeTable,
} from '@sheetcraft/core';
import { runValidation } from '../store/validation';
import type { FromWorker, Job, JobResult, SerializedTable, SyncInfo, ToWorker } from './protocol';

/** 仕事を 1 つ行う（Worker の中と、Worker が使えないときのメインスレッドで共用する） */
export function runJob(project: Project, calc: Calculator, job: Job): JobResult {
  switch (job.kind) {
    case 'validate':
      return runValidation(project, calc, job.request);
    case 'export':
      return planExport(project, calc, job.options);
    case 'serialize': {
      const baseFields = project.common.base_fields.items;
      return job.tables.map(({ uid, format }): SerializedTable => {
        const table = project.tables.find((t) => t.uid === uid);
        if (table === undefined) return { uid, text: null };
        try {
          return { uid, text: serializeTable(table, baseFields, format) };
        } catch (e) {
          if (e instanceof SerializeError) return { uid, text: null };
          throw e;
        }
      });
    }
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/** パッチでは伝わらない変化を複製に写す */
export function applySync(project: Project, sync: SyncInfo): void {
  for (const [uid, path, format] of sync.tableSources) {
    const table = project.tables.find((t) => t.uid === uid);
    if (table === undefined) continue;
    if (table.source === null) table.source = { path, format, text: '' };
    else if (table.source.path !== path || table.source.format !== format) table.source = { ...table.source, path, format };
  }
  for (const [part, path, format] of sync.commonSources) {
    const common = project.common[part];
    if (path === null || format === null) common.source = null;
    else if (common.source === null) common.source = { path, format, text: '' };
    else if (common.source.path !== path || common.source.format !== format) common.source = { ...common.source, path, format };
  }
  if (sync.brokenTables !== undefined) project.brokenTables = sync.brokenTables;
}

export class ValidationEngine {
  private project: Project | null = null;
  private calc: Calculator | null = null;
  /** パッチを当てられなかった理由（複製を送り直されるまで仕事を断る） */
  private desync: string | null = null;

  constructor(private readonly post: (message: FromWorker) => void) {}

  /** 複製（テストで中身を確かめる） */
  get replica(): Project | null {
    return this.project;
  }

  handle(message: ToWorker): void {
    switch (message.type) {
      case 'init':
        this.project = restoreProject(message.snapshot);
        this.calc = new Calculator(this.project);
        this.desync = null;
        return;
      case 'patches':
        this.applyPatches(message.patches);
        return;
      case 'job':
        this.runJob(message.id, message.job, message.sync);
        return;
    }
  }

  private applyPatches(patches: Parameters<typeof applyPatches>[1]): void {
    const { project, calc } = this;
    if (project === null || calc === null || this.desync !== null) return;
    try {
      applyPatches(project, patches);
      invalidateForPatches(calc, patches);
    } catch (e) {
      this.desync = messageOf(e);
    }
  }

  private runJob(id: number, job: Job, sync: SyncInfo): void {
    this.post({ type: 'started', id });
    const { project, calc } = this;
    if (project === null || calc === null || this.desync !== null) {
      this.post({ type: 'failed', id, message: this.desync ?? 'not initialized', desync: true });
      return;
    }
    try {
      applySync(project, sync);
      this.post({ type: 'done', id, result: runJob(project, calc, job) });
    } catch (e) {
      this.post({ type: 'failed', id, message: messageOf(e), desync: false });
    }
  }
}
