// 直接保存方式の画面テストの共通の処理: ブラウザ内の領域（OPFS）にプロジェクトを置き、showDirectoryPicker() がそのフォルダを返すように
// 差し替える（e2e/fileaccess.spec.ts と同じやり方。計画書 §7.3）。テストの中から、ほかのエディタの代わりにファイルを書き換える
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

const SAMPLE_DIR = join(import.meta.dirname, '../../../samples/basic-yaml');

export const OPFS_DIR = 'proj';

export async function sampleFiles(dir = SAMPLE_DIR, prefix = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(out, await sampleFiles(join(dir, entry.name), path));
    else out[path] = await readFile(join(dir, entry.name), 'utf8');
  }
  return out;
}

/** showDirectoryPicker() が OPFS の proj フォルダを返すようにする（ページを開く前に呼ぶ） */
export async function mockDirectoryPicker(page: Page): Promise<void> {
  await page.addInitScript((dir) => {
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle(dir, { create: true });
  }, OPFS_DIR);
}

/** OPFS の proj フォルダを files だけにする */
export async function putProject(page: Page, files: Record<string, string>): Promise<void> {
  await page.evaluate(
    async ({ dir, entries }) => {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(dir, { recursive: true }).catch(() => undefined);
      const proj = await root.getDirectoryHandle(dir, { create: true });
      for (const [path, text] of Object.entries(entries)) {
        const parts = path.split('/');
        let d = proj;
        for (const part of parts.slice(0, -1)) d = await d.getDirectoryHandle(part, { create: true });
        const w = await (await d.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
        await w.write(text);
        await w.close();
      }
    },
    { dir: OPFS_DIR, entries: files },
  );
}

/** ほかのエディタの代わりに、OPFS のファイルを書き換える（null なら消す） */
export async function writeExternally(page: Page, path: string, text: string | null): Promise<void> {
  await page.evaluate(
    async ({ dir, path, text }) => {
      let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(dir);
      const parts = path.split('/');
      for (const part of parts.slice(0, -1)) d = await d.getDirectoryHandle(part, { create: true });
      const name = parts[parts.length - 1];
      if (text === null) {
        await d.removeEntry(name);
        return;
      }
      const w = await (await d.getFileHandle(name, { create: true })).createWritable();
      await w.write(text);
      await w.close();
    },
    { dir: OPFS_DIR, path, text },
  );
}

/** OPFS のファイルを読む（無ければ null） */
export async function readOpfs(page: Page, path: string): Promise<string | null> {
  return page.evaluate(
    async ({ dir, path }) => {
      try {
        let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(dir);
        const parts = path.split('/');
        for (const part of parts.slice(0, -1)) d = await d.getDirectoryHandle(part);
        return await (await (await d.getFileHandle(parts[parts.length - 1])).getFile()).text();
      } catch {
        return null;
      }
    },
    { dir: OPFS_DIR, path },
  );
}

/** OPFS のフォルダの中のファイルの名前（無ければ null） */
export async function listOpfs(page: Page, path: string): Promise<string[] | null> {
  return page.evaluate(
    async ({ dir, path }) => {
      try {
        let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(dir);
        for (const part of path.split('/').filter((p) => p !== '')) d = await d.getDirectoryHandle(part);
        const names: string[] = [];
        for await (const [name] of (d as unknown as { entries(): AsyncIterable<[string, unknown]> }).entries()) names.push(name);
        return names.sort();
      } catch {
        return null;
      }
    },
    { dir: OPFS_DIR, path },
  );
}

/** サンプルを OPFS に置いて、直接保存方式で開く */
export async function openOpfsProject(page: Page, files?: Record<string, string>): Promise<Record<string, string>> {
  const entries = files ?? (await sampleFiles());
  await mockDirectoryPicker(page);
  await page.goto('/');
  await putProject(page, entries);
  await page.getByTestId('open-folder').click();
  await expect(page.getByTestId('grid')).toBeVisible();
  await expect(page.getByTestId('project-name')).toHaveText(OPFS_DIR);
  return entries;
}

/** ウィンドウに戻ったことにする */
export async function returnToWindow(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}
