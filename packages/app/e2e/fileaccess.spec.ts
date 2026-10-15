// ファイルの読み書きの方式（NFR-02〜05、FR-FIO-01〜05、08）。
// 直接保存方式は、ブラウザ内の領域（Origin Private File System）にサンプルを置き、showDirectoryPicker() がそのフォルダを返すように
// 差し替えて試す（計画書 §7.3）。保存の処理は本物の createWritable() と close() を通る
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { cellText, clickCell, colIndex, openBasicSample } from './helpers';

const SAMPLE_DIR = join(import.meta.dirname, '../../../samples/basic-yaml');

async function sampleFiles(dir = SAMPLE_DIR, prefix = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(out, await sampleFiles(join(dir, entry.name), path));
    else out[path] = await readFile(join(dir, entry.name), 'utf8');
  }
  return out;
}

test.describe('直接保存方式（OPFS で試す）', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () =>
        (await navigator.storage.getDirectory()).getDirectoryHandle('proj', { create: true });
    });
  });

  test('フォルダを開いて 1 セル変えて保存すると、そのファイルだけが書き換わる。前回のフォルダを開き直せる', async ({ page }) => {
    const files = await sampleFiles();
    await page.goto('/');
    await page.evaluate(async (entries) => {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('proj', { recursive: true }).catch(() => undefined);
      const proj = await root.getDirectoryHandle('proj', { create: true });
      for (const [path, text] of Object.entries(entries)) {
        const parts = path.split('/');
        let dir = proj;
        for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
        const file = await dir.getFileHandle(parts[parts.length - 1], { create: true });
        const w = await file.createWritable();
        await w.write(text);
        await w.close();
      }
    }, files);
    await page.getByTestId('open-folder').click();
    await expect(page.getByTestId('grid')).toBeVisible();
    await expect(page.getByTestId('project-name')).toHaveText('proj');
    // 直接保存方式では、使えない機能の印を出さない
    await expect(page.getByTestId('mode-badge')).toHaveCount(0);

    const hp = await colIndex(page, 'hp');
    await clickCell(page, 1, hp);
    await page.keyboard.type('1000');
    await page.keyboard.press('Enter');
    // 検査エラー（hp の min: 1 に反する）があっても保存は止めない（FR-FIO-08）
    await page.keyboard.type('0');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-errors')).toHaveText('1');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('status')).toHaveText('保存しました（1 ファイル）');
    await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toHaveCount(0);

    const after = await page.evaluate(async (paths) => {
      const proj = await (await navigator.storage.getDirectory()).getDirectoryHandle('proj');
      const out: Record<string, string> = {};
      for (const path of paths) {
        const parts = path.split('/');
        let dir = proj;
        for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
        out[path] = await (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).text();
      }
      return out;
    }, Object.keys(files));
    for (const [path, text] of Object.entries(files)) {
      if (path === 'tables/character.yaml') continue;
      expect(after[path], path).toBe(text);
    }
    expect(after['tables/character.yaml']).toContain('hp: { value: 1000, color: red, comment: 次回調整予定 }');
    expect(after['tables/character.yaml']).toContain('    hp: 0\n');

    // 前回のフォルダを覚えていて、次の起動で開き直せる（FR-FIO-01）
    await page.reload();
    await expect(page.getByTestId('open-last')).toHaveText('前回のフォルダを開く（proj）');
    await page.getByTestId('open-last').click();
    await expect(page.getByTestId('grid')).toBeVisible();
    expect(await cellText(page, 1, 'hp')).toBe('1000');
  });
});

test('API が無ければダウンロード保存方式になり、使えない機能を示す（NFR-04、NFR-05）', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });
  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toContainText('前回のフォルダの記憶');
  await expect(page.getByTestId('start-screen')).toContainText('ほかのエディタや Git による変更の検知');
  await expect(page.getByTestId('open-last')).toHaveCount(0);
  await page.getByTestId('open-sample').click();
  await page.getByTestId('mode-badge').click();
  await expect(page.getByTestId('message-dialog')).toContainText('フォルダへの直接の保存');
});

test('未保存のままページを閉じるときは確かめる（FR-FIO-05）', async ({ page }) => {
  await openBasicSample(page);
  const hp = await colIndex(page, 'hp');
  await clickCell(page, 0, hp);
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  const dialog = new Promise<string>((resolve) => {
    page.once('dialog', async (d) => {
      resolve(d.type());
      await d.dismiss();
    });
  });
  await page.close({ runBeforeUnload: true });
  expect(await dialog).toBe('beforeunload');
});
