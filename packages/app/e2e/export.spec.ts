// 画面からの出力（FR-OUT-06、FR-OUT-05）: 直接保存方式では out_dir にファイルができ、ダウンロード保存方式ではダウンロードされる。
// 検査エラーがあると出力しない（強制して出力することはできる）
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { clickCell, colIndex, openBasicSample } from './helpers';
import { listOpfs, openOpfsProject, readOpfs } from './opfs';

async function openExport(page: Page): Promise<void> {
  await page.getByTestId('menubar-file').dispatchEvent('mousedown');
  await page.getByTestId('menu-file.export').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
}

test('直接保存方式: プロジェクト設定の出力先のフォルダ（out_dir）に、無ければ作って書き込む', async ({ page }) => {
  await openOpfsProject(page);
  expect(await listOpfs(page, 'build')).toBeNull();
  await openExport(page);
  await expect(page.getByTestId('export-dialog')).toContainText('build/');
  for (const name of ['character', 'skill', 'stage']) await expect(page.getByTestId(`export-table-${name}`)).toBeChecked();
  await page.getByTestId('export-run').click();
  await expect(page.getByTestId('export-dialog')).toHaveCount(0);
  await expect(page.getByTestId('status')).toHaveText('3 ファイルを build/ に出力しました');
  expect(await listOpfs(page, 'build')).toEqual(['character.json', 'skill.json', 'stage.json']);
  const character = JSON.parse((await readOpfs(page, 'build/character.json')) ?? 'null');
  expect(character[0]).toMatchObject({ id: 1, name: '勇者アルス', hp: 1200 });
  // 列定義・セル色・メモは含めない（FR-OUT-02）
  expect(JSON.stringify(character)).not.toContain('次回調整予定');
});

test('ダウンロード保存方式: 選んだテーブルが 1 つならそのファイル、複数なら ZIP をダウンロードする', async ({ page }) => {
  await openBasicSample(page);
  await openExport(page);
  await expect(page.getByTestId('export-dialog')).toContainText('ダウンロードします');
  await page.getByTestId('export-all').uncheck();
  await page.getByTestId('export-table-skill').check();
  const single = page.waitForEvent('download');
  await page.getByTestId('export-run').click();
  const file = await single;
  expect(file.suggestedFilename()).toBe('skill.json');
  const skill = JSON.parse(await readFile(await file.path(), 'utf8'));
  expect(skill.map((s: { id: number }) => s.id)).toEqual([1, 2, 3]);
  await expect(page.getByTestId('status')).toHaveText('skill.json をダウンロードしました（1 ファイル）');

  await openExport(page);
  const zipped = page.waitForEvent('download');
  await page.getByTestId('export-run').click();
  const zip = await zipped;
  expect(zip.suggestedFilename()).toBe('basic-yaml-build.zip');
  const entries = unzipSync(new Uint8Array(await readFile(await zip.path())));
  expect(Object.keys(entries).sort()).toEqual(['build/character.json', 'build/skill.json', 'build/stage.json']);
  expect(JSON.parse(strFromU8(entries['build/stage.json'])).length).toBeGreaterThan(0);
});

test('検査エラーがあればエラーを示して出力しない。「エラーがあっても出力する」で出力できる', async ({ page }) => {
  await openBasicSample(page);
  await clickCell(page, 0, await colIndex(page, 'hp'));
  await page.keyboard.type('0');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-errors')).toHaveText('1');
  let downloads = 0;
  page.on('download', () => downloads++);
  await openExport(page);
  await expect(page.getByTestId('export-dialog')).toContainText('保存していない変更も出力に含みます');
  await page.getByTestId('export-run').click();
  const errors = page.getByTestId('export-errors');
  await expect(errors).toContainText('検査エラーが 1 件あるため、出力しませんでした');
  await expect(errors).toContainText('character / 1 / hp:');
  await page.waitForTimeout(300);
  expect(downloads).toBe(0);
  const forced = page.waitForEvent('download');
  await page.getByTestId('export-force').click();
  const zip = await forced;
  const entries = unzipSync(new Uint8Array(await readFile(await zip.path())));
  expect(JSON.parse(strFromU8(entries['build/character.json']))[0].hp).toBe(0);
});
