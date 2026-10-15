// ダウンロード保存方式（NFR-03）: `<input type="file" webkitdirectory>` で読み込み、保存は変更したファイルのダウンロード
// （1 ファイルならそのファイル、複数ならフォルダ構成を保った ZIP）
import type { ProjectFs, SavePlan } from '@sheetcraft/core';
import { normalizeDir } from '@sheetcraft/core';
import { strToU8, zipSync } from 'fflate';
import { baseName, blobText, dirName } from './text';
import type { ProjectSource, SaveOutcome, SourceKind } from './types';
import { DOWNLOAD_CAPABILITIES } from './types';

/** フォルダの中のファイル（webkitRelativePath を持つ File と同じ形） */
export interface RelativeFile extends Blob {
  readonly name: string;
  readonly webkitRelativePath: string;
}

/** 選ばれたフォルダのファイル一式を ProjectFs にする。パスは選んだフォルダからの相対パス */
export class FileListProjectFs implements ProjectFs {
  private readonly files = new Map<string, Blob>();

  constructor(files: Iterable<[string, Blob]>) {
    for (const [path, blob] of files) this.files.set(path, blob);
  }

  async list(dir: string): Promise<string[]> {
    const prefix = normalizeDir(dir);
    const names: string[] = [];
    for (const path of this.files.keys()) {
      if (dirName(path) === prefix) names.push(baseName(path));
    }
    return names.sort();
  }

  async read(path: string): Promise<string | null> {
    const blob = this.files.get(path);
    return blob === undefined ? null : blobText(blob);
  }

  paths(): string[] {
    return [...this.files.keys()].sort();
  }
}

/**
 * フォルダの選択の結果（webkitRelativePath は「選んだフォルダ名/…」）から、フォルダ名と ProjectFs を作る。
 * ファイルが無ければ null
 */
export function filesToProject(files: readonly RelativeFile[]): { name: string; fs: FileListProjectFs } | null {
  if (files.length === 0) return null;
  const entries: [string, Blob][] = [];
  let root: string | null = null;
  for (const file of files) {
    const rel = file.webkitRelativePath === '' ? file.name : file.webkitRelativePath;
    const slash = rel.indexOf('/');
    // フォルダではなくファイルが選ばれた場合（NFR-03 の Safari の不具合など）は、そのファイルをルートに置く
    const top = slash < 0 ? '' : rel.slice(0, slash);
    const path = slash < 0 ? rel : rel.slice(slash + 1);
    root ??= top;
    entries.push([path, file]);
  }
  return { name: root === '' || root === null ? 'project' : root, fs: new FileListProjectFs(entries) };
}

/** ブラウザにファイルを保存させる（a 要素の download 属性） */
export type DownloadFn = (blob: Blob, fileName: string) => void;

export function browserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // ダウンロードが始まる前に URL を消さないよう、少し待つ
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** 保存する内容を ZIP にする（パスはプロジェクトのルートからの相対パス） */
export function zipFiles(files: readonly { path: string; text: string }[]): Uint8Array {
  const data: Record<string, Uint8Array> = {};
  for (const file of files) data[file.path] = strToU8(file.text);
  return zipSync(data, { level: 6, mtime: new Date() });
}

/**
 * ダウンロードで保存する。消すべきファイル（削除・名前の変更をしたテーブルの元のファイル）はダウンロードでは消せないので、
 * 手で消すファイルとして返す（P-43）
 */
export function downloadPlan(plan: SavePlan, projectName: string, download: DownloadFn = browserDownload): SaveOutcome {
  const outcome: SaveOutcome = { written: [], removed: [], failed: [], manualRemove: [...plan.remove] };
  if (plan.files.length === 1) {
    const file = plan.files[0];
    const name = baseName(file.path);
    download(new Blob([file.text], { type: file.format === 'json' ? 'application/json' : 'application/yaml' }), name);
    outcome.downloaded = name;
  } else if (plan.files.length > 1) {
    const zip = zipFiles(plan.files);
    const name = `${projectName}.zip`;
    const bytes = new Uint8Array(zip.byteLength);
    bytes.set(zip);
    download(new Blob([bytes.buffer], { type: 'application/zip' }), name);
    outcome.downloaded = name;
  }
  outcome.written.push(...plan.files);
  // 手で消すように知らせたので、保存の対象からは外す（同じファイルを毎回知らせない）
  outcome.removed.push(...plan.remove);
  return outcome;
}

export function downloadSource(name: string, fs: ProjectFs, kind: SourceKind = 'download', download?: DownloadFn): ProjectSource {
  return {
    kind,
    name,
    fs,
    capabilities: DOWNLOAD_CAPABILITIES,
    save: async (plan) => downloadPlan(plan, name, download),
  };
}

/** フォルダを選ばせる（webkitdirectory）。取り消したら null */
export function pickFolderWithInput(): Promise<RelativeFile[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.style.display = 'none';
    let done = false;
    const finish = (files: RelativeFile[] | null): void => {
      if (done) return;
      done = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(input.files === null ? null : [...input.files]));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}
