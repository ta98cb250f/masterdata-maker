// 画面からの出力（FR-OUT-06）。検査エラーがあれば出力しない（強制して出力することもできる。FR-OUT-05）。
// 直接保存方式ではプロジェクト設定の出力先のフォルダ（output.out_dir。無ければ作る）へ書き込み、
// ダウンロード保存方式ではダウンロードする（複数なら ZIP）。出力するのはエディタの今の内容（保存していない変更も含む）
import type { Diagnostic, ExportFile, OutputFormat } from '@sheetcraft/core';
import { formatDiagnostic, isError, resolveProjectPaths } from '@sheetcraft/core';
import type { DownloadFn } from '../fs/download';
import { browserDownload, zipFiles } from '../fs/download';
import { baseName, errorMessage } from '../fs/text';
import type { SaveFailure } from '../fs/types';
import type { AppStore } from './AppStore';
import { backgroundJobs } from './workerValidator';

export interface ExportRequest {
  /** 出力するテーブルの名前 */
  tables: readonly string[];
  /** 検査エラーがあっても出力する */
  force: boolean;
  /** 出力の形式（省略時はプロジェクト設定の output.format） */
  format?: OutputFormat;
}

export type ExportOutcome =
  /** 検査エラーがあって出力しなかった（errors はエラーだけ） */
  | { status: 'errors'; errors: Diagnostic[] }
  /** 出力先のフォルダへ書き込んだ（直接保存方式） */
  | { status: 'written'; outDir: string; files: string[]; failed: SaveFailure[] }
  | { status: 'downloaded'; name: string; files: string[] }
  /** 出力するテーブルが無い（読み込みエラーのテーブルだけを選んだなど） */
  | { status: 'empty' };

/** フォルダへ書き込める読み込み口（直接保存方式の DirectoryProjectFs） */
interface WritableFs {
  write(path: string, data: string | Uint8Array): Promise<void>;
}

function writableFs(fs: unknown): WritableFs | null {
  const candidate = fs as Partial<WritableFs> | null;
  return candidate !== null && typeof candidate.write === 'function' ? (candidate as WritableFs) : null;
}

export interface ExportDeps {
  download?: DownloadFn;
}

export async function runExport(store: AppStore, request: ExportRequest, deps: ExportDeps = {}): Promise<ExportOutcome> {
  const { project, calc, source } = store.getState();
  if (project === null || calc === null || source === null) return { status: 'empty' };
  const plan = await backgroundJobs(project, calc).exportPlan({ tables: [...request.tables], force: request.force, format: request.format });
  if (!plan.ok) return { status: 'errors', errors: plan.diagnostics.filter(isError) };
  if (plan.files.length === 0) return { status: 'empty' };
  const outDir = resolveProjectPaths(project.config).outDir;
  const writer = source.capabilities.directSave ? writableFs(source.fs) : null;
  if (writer !== null) {
    const files: string[] = [];
    const failed: SaveFailure[] = [];
    for (const file of plan.files) {
      try {
        await writer.write(file.path, file.content);
        files.push(file.path);
      } catch (e) {
        failed.push({ path: file.path, message: errorMessage(e) });
      }
    }
    return { status: 'written', outDir, files, failed };
  }
  return downloadExport(plan.files, `${source.name}-${outDir === '' ? 'export' : baseName(outDir)}`, deps.download ?? browserDownload);
}

/** ダウンロードするファイルの種類（拡張子から） */
function mediaType(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1);
  switch (ext) {
    case 'json':
      return 'application/json';
    case 'yaml':
      return 'application/yaml';
    case 'csv':
      return 'text/csv';
    case 'pb':
      return 'application/x-protobuf';
    default:
      return 'text/plain';
  }
}

/** Blob に渡す中身（Uint8Array は ArrayBuffer を持つものに写す） */
function blobPart(content: string | Uint8Array): string | ArrayBuffer {
  if (typeof content === 'string') return content;
  const bytes = new Uint8Array(content.byteLength);
  bytes.set(content);
  return bytes.buffer;
}

function downloadExport(files: readonly ExportFile[], zipStem: string, download: DownloadFn): ExportOutcome {
  if (files.length === 1) {
    const file = files[0];
    const name = baseName(file.path);
    download(new Blob([blobPart(file.content)], { type: mediaType(name) }), name);
    return { status: 'downloaded', name, files: [file.path] };
  }
  // ZIP の中はプロジェクトのルートからのパス（出力先のフォルダを含む）。プロジェクトのフォルダに展開すれば出力先に置かれる
  const zip = zipFiles(files.map((f) => ({ path: f.path, text: f.content })));
  const bytes = new Uint8Array(zip.byteLength);
  bytes.set(zip);
  const name = `${zipStem}.zip`;
  download(new Blob([bytes.buffer], { type: 'application/zip' }), name);
  return { status: 'downloaded', name, files: files.map((f) => f.path) };
}

/** 出力を止めたエラーの 1 行（テーブル / 主キー / 列: 文言） */
export function formatExportError(store: AppStore, d: Diagnostic): string {
  const where = [d.table ?? d.file, d.recordKey, d.field].filter((x): x is string => x !== undefined && x !== '');
  const message = formatDiagnostic(d, store.getState().locale);
  return where.length === 0 ? message : `${where.join(' / ')}: ${message}`;
}
