// Node.js のファイルの読み書き（§4.4）。書き込みは一時ファイルに書いてから名前を変える
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ProjectFs } from '@sheetcraft/core';

function isMissing(e: unknown): boolean {
  const code = (e as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR';
}

/** プロジェクトのフォルダを読む ProjectFs。パスはルートからの相対パス（区切りは `/`） */
export class NodeProjectFs implements ProjectFs {
  constructor(readonly root: string) {}

  /** プロジェクトの中のパスを、実際のファイルのパスにする */
  resolve(path: string): string {
    return path === '' ? this.root : join(this.root, ...path.split('/'));
  }

  async list(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(this.resolve(dir), { withFileTypes: true });
      return entries
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .sort();
    } catch (e) {
      if (isMissing(e)) return [];
      throw e;
    }
  }

  async read(path: string): Promise<string | null> {
    try {
      return await readFile(this.resolve(path), 'utf8');
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  }

  async write(path: string, text: string): Promise<void> {
    await writeFileAtomic(this.resolve(path), text);
  }

  async remove(path: string): Promise<void> {
    await rm(this.resolve(path), { force: true });
  }
}

/**
 * ファイルを書く。同じフォルダの一時ファイルに書いてから名前を変えるので、途中で失敗しても元のファイルは壊れない（NFR-15）
 */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await (typeof data === 'string' ? writeFile(tmp, data, 'utf8') : writeFile(tmp, data));
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}
