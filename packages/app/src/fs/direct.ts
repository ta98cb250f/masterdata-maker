// 直接保存方式（NFR-02、FR-FIO-01、NFR-15）: File System Access API でフォルダを直接読み書きする
import type { ProjectFs, SavePlan } from '@sheetcraft/core';
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';
import { blobText, errorMessage } from './text';
import type { ProjectSource, SaveOutcome } from './types';
import { DIRECT_CAPABILITIES } from './types';

// 使う API だけの型（lib.dom の版に左右されないように。テストの偽物もこの形で作る）
export interface WritableLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

export interface FileLike {
  readonly lastModified: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface FileHandleLike {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<FileLike>;
  createWritable(): Promise<WritableLike>;
}

export type PermissionMode = 'read' | 'readwrite';

export interface DirectoryHandleLike {
  readonly kind: 'directory';
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string): Promise<void>;
  values(): AsyncIterable<FileHandleLike | DirectoryHandleLike>;
  queryPermission?(descriptor: { mode: PermissionMode }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: PermissionMode }): Promise<PermissionState>;
}

function isNotFound(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  return name === 'NotFoundError' || name === 'TypeMismatchError';
}

function pathParts(path: string): string[] {
  return path.split('/').filter((p) => p !== '' && p !== '.');
}

function splitPath(path: string): { dirs: string[]; name: string } {
  const parts = pathParts(path);
  const name = parts.pop() ?? '';
  return { dirs: parts, name };
}

/** フォルダのハンドルを ProjectFs にする（書き込み・削除・更新日時も持つ） */
export class DirectoryProjectFs implements ProjectFs {
  constructor(readonly root: DirectoryHandleLike) {}

  private async dir(parts: readonly string[], create: boolean): Promise<DirectoryHandleLike | null> {
    let dir = this.root;
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part, { create });
      } catch (e) {
        if (!create && isNotFound(e)) return null;
        throw e;
      }
    }
    return dir;
  }

  private async fileHandle(path: string): Promise<FileHandleLike | null> {
    const { dirs, name } = splitPath(path);
    const dir = await this.dir(dirs, false);
    if (dir === null || name === '') return null;
    try {
      return await dir.getFileHandle(name);
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async list(dir: string): Promise<string[]> {
    const handle = await this.dir(pathParts(dir), false);
    if (handle === null) return [];
    const names: string[] = [];
    for await (const entry of handle.values()) {
      if (entry.kind === 'file') names.push(entry.name);
    }
    return names.sort();
  }

  async read(path: string): Promise<string | null> {
    const handle = await this.fileHandle(path);
    if (handle === null) return null;
    return blobText(await handle.getFile());
  }

  /**
   * 書き込む。createWritable は一時ファイルに書き、close の完了で元のファイルを置き換えるので、
   * 必ず close を待つ（NFR-15）。途中で失敗したら abort して元のファイルを残す
   */
  async write(path: string, text: string): Promise<void> {
    const { dirs, name } = splitPath(path);
    const dir = await this.dir(dirs, true);
    if (dir === null) throw new Error(`cannot open ${path}`);
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(text);
    } catch (e) {
      await writable.abort?.(e).catch(() => undefined);
      throw e;
    }
    await writable.close();
  }

  async remove(path: string): Promise<void> {
    const { dirs, name } = splitPath(path);
    const dir = await this.dir(dirs, false);
    if (dir === null) return;
    try {
      await dir.removeEntry(name);
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }

  async lastModified(path: string): Promise<number | null> {
    const handle = await this.fileHandle(path);
    if (handle === null) return null;
    return (await handle.getFile()).lastModified;
  }
}

/** 計画どおりに書き込み・削除する。ファイルごとに失敗を集め、書けたものだけを返す */
export async function writePlan(fs: DirectoryProjectFs, plan: SavePlan): Promise<SaveOutcome> {
  const outcome: SaveOutcome = { written: [], removed: [], failed: [], manualRemove: [] };
  for (const file of plan.files) {
    try {
      await fs.write(file.path, file.text);
      outcome.written.push(file);
    } catch (e) {
      outcome.failed.push({ path: file.path, message: errorMessage(e) });
    }
  }
  for (const path of plan.remove) {
    try {
      await fs.remove(path);
      outcome.removed.push(path);
    } catch (e) {
      outcome.failed.push({ path, message: errorMessage(e) });
    }
  }
  return outcome;
}

/** 直接保存方式が使えるか（NFR-04: ブラウザの名前ではなく API の有無で決める） */
export function supportsDirectAccess(target: object = globalThis): boolean {
  return typeof (target as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

type DirectoryPicker = (options?: { mode?: PermissionMode; id?: string }) => Promise<DirectoryHandleLike>;

/** フォルダを選ばせる。取り消したら null */
export async function pickDirectory(): Promise<DirectoryHandleLike | null> {
  const picker = (globalThis as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker;
  try {
    return await picker({ mode: 'readwrite', id: 'sheetcraft' });
  } catch (e) {
    if ((e as { name?: unknown } | null)?.name === 'AbortError') return null;
    throw e;
  }
}

/** 読み書きの許可を確かめ、無ければ求める（ボタンを押したときなど、利用者の操作の中で呼ぶ） */
export async function ensurePermission(handle: DirectoryHandleLike, mode: PermissionMode = 'readwrite'): Promise<boolean> {
  if (handle.queryPermission === undefined) return true;
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  if (handle.requestPermission === undefined) return false;
  return (await handle.requestPermission({ mode })) === 'granted';
}

export function directSource(handle: DirectoryHandleLike): ProjectSource {
  const fs = new DirectoryProjectFs(handle);
  return {
    kind: 'direct',
    name: handle.name,
    fs,
    capabilities: DIRECT_CAPABILITIES,
    save: (plan) => writePlan(fs, plan),
    lastModified: (path) => fs.lastModified(path),
  };
}

// ---- 前回のフォルダの記憶（FR-FIO-01） ----

const LAST_DIRECTORY_KEY = 'sheetcraft.lastDirectory';

export async function rememberDirectory(handle: DirectoryHandleLike): Promise<void> {
  try {
    await idbSet(LAST_DIRECTORY_KEY, handle);
  } catch {
    // IndexedDB が使えない環境（プライベートブラウズなど）では覚えない
  }
}

export async function recallDirectory(): Promise<DirectoryHandleLike | null> {
  try {
    const handle = (await idbGet(LAST_DIRECTORY_KEY)) as DirectoryHandleLike | undefined;
    return handle !== undefined && handle !== null && handle.kind === 'directory' ? handle : null;
  } catch {
    return null;
  }
}

export async function forgetDirectory(): Promise<void> {
  try {
    await idbDel(LAST_DIRECTORY_KEY);
  } catch {
    // 覚えていなければ何もしない
  }
}
