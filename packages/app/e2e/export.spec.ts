// 画面からの出力（FR-OUT-06、FR-OUT-05）: 直接保存方式では out_dir にファイルができ、ダウンロード保存方式ではダウンロードされる。
// 検査エラーがあると出力しない（強制して出力することはできる）
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { clickCell, colIndex, openBasicSample } from './helpers';
import { listOpfs, openOpfsProject, readOpfs, sampleFiles } from './opfs';

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

test('形式を選べる（既定はプロジェクト設定の output.format）。CSV は 1 ファイル、Protocol Buffers は .proto と .pb の ZIP', async ({ page }) => {
  await openBasicSample(page);
  await openExport(page);
  await expect(page.getByTestId('export-format')).toHaveValue('json');
  await page.getByTestId('export-all').uncheck();
  await page.getByTestId('export-table-stage').check();
  await page.getByTestId('export-format').selectOption('csv');
  const csv = page.waitForEvent('download');
  await page.getByTestId('export-run').click();
  const csvFile = await csv;
  expect(csvFile.suggestedFilename()).toBe('stage.csv');
  expect(await readFile(await csvFile.path(), 'utf8')).toBe('id,version,name,boss_id\n1,0.1.2,stage_01,3\n2,0.1.11,stage_02,2\n');

  // 選んだ形式はその出力だけに使う（次に開いたときはプロジェクト設定の形式）
  await openExport(page);
  await expect(page.getByTestId('export-format')).toHaveValue('json');
  await page.getByTestId('export-all').uncheck();
  await page.getByTestId('export-table-stage').check();
  await page.getByTestId('export-format').selectOption('protobuf');
  await expect(page.getByTestId('export-dialog')).toContainText('スキーマ（.proto）とデータ（.pb）');
  const pb = page.waitForEvent('download');
  await page.getByTestId('export-run').click();
  const entries = unzipSync(new Uint8Array(await readFile(await (await pb).path())));
  expect(Object.keys(entries).sort()).toEqual(['build/stage.pb', 'build/stage.proto']);
  expect(strFromU8(entries['build/stage.proto'])).toContain('message StageTable {\n  repeated Stage records = 1;\n}\n');
  expect([...entries['build/stage.pb'].subarray(0, 4)]).toEqual([0x0a, 21, 0x08, 1]);
});

test('直接保存方式: Protocol Buffers の .pb はバイナリのまま書き込む', async ({ page }) => {
  await openOpfsProject(page);
  await openExport(page);
  await page.getByTestId('export-format').selectOption('protobuf');
  await page.getByTestId('export-run').click();
  await expect(page.getByTestId('status')).toHaveText('6 ファイルを build/ に出力しました');
  expect(await listOpfs(page, 'build')).toEqual(['character.pb', 'character.proto', 'skill.pb', 'skill.proto', 'stage.pb', 'stage.proto']);
  const stage = (await readOpfs(page, 'build/stage.pb')) ?? '';
  expect([...stage.slice(0, 4)].map((c) => c.charCodeAt(0))).toEqual([0x0a, 21, 0x08, 1]);
});

test('Protocol Buffers で出力できない名前は、強制しても出力できないので「エラーがあっても出力する」を出さない', async ({ page }) => {
  // stage の全体のメッセージ StageTable と、stage_table のレコードのメッセージ StageTable が重なる
  await openOpfsProject(page, { ...(await sampleFiles()), 'tables/stage_table.yaml': 'table: stage_table\nfields: []\nrecords: []\n' });
  await openExport(page);
  await page.getByTestId('export-format').selectOption('protobuf');
  await page.getByTestId('export-run').click();
  await expect(page.getByTestId('export-errors')).toContainText('メッセージ名 StageTable');
  await expect(page.getByTestId('export-cannot-force')).toBeVisible();
  await expect(page.getByTestId('export-force')).toHaveCount(0);
  expect(await listOpfs(page, 'build')).toBeNull();
  // 戻って別の形式を選べば出力できる
  await page.getByTestId('export-back').click();
  await page.getByTestId('export-format').selectOption('csv');
  await page.getByTestId('export-run').click();
  await expect(page.getByTestId('status')).toHaveText('4 ファイルを build/ に出力しました');
});
