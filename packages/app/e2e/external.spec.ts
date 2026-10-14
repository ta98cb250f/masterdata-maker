// 外部での変更の検知（FR-FIO-07、NFR-17）。直接保存方式（OPFS で試す）で、テストの中からファイルを書き換えてから、
// ウィンドウに戻る・保存する
import { expect, test } from '@playwright/test';
import { cellText, clickCell, colIndex } from './helpers';
import { openOpfsProject, readOpfs, returnToWindow, writeExternally } from './opfs';

test('ウィンドウに戻ったときに書き換えを見つけ、読み込み直すと画面に反映される', async ({ page }) => {
  const files = await openOpfsProject(page);
  await writeExternally(page, 'tables/skill.yaml', files['tables/skill.yaml'].replace('cost: 10', 'cost: 99'));
  // 書き換えていないファイルだけなら何も出さない
  await writeExternally(page, 'tables/stage.yaml', files['tables/stage.yaml']);
  await returnToWindow(page);
  const dialog = page.getByTestId('external-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('external-file-tables/skill.yaml')).toContainText('変更されています');
  await expect(dialog.getByTestId('external-file-tables/stage.yaml')).toHaveCount(0);
  await expect(dialog.getByTestId('external-reload-tables/skill.yaml')).toBeChecked();
  await dialog.getByTestId('external-apply').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('status')).toHaveText('1 ファイルを読み込み直しました');
  await page.getByTestId('sheet-tab-skill').click();
  expect(await cellText(page, 0, 'cost')).toBe('99');
  await expect(page.getByTestId('sheet-tab-skill').getByTestId('tab-modified')).toHaveCount(0);
  // 読み込み直した後は、同じ変更を聞き直さない
  await returnToWindow(page);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('external-dialog')).toHaveCount(0);
});

test('保存の直前に書き換えを見つけ、「上書きする」を選ぶとエディタの内容で保存を続ける', async ({ page }) => {
  const files = await openOpfsProject(page);
  await clickCell(page, 0, await colIndex(page, 'hp'));
  await page.keyboard.type('4321');
  await page.keyboard.press('Enter');
  await writeExternally(page, 'tables/character.yaml', files['tables/character.yaml'].replace('name: 勇者アルス', 'name: 勇者'));
  await page.keyboard.press('Control+s');
  const dialog = page.getByTestId('external-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('保存する前に確かめたところ');
  await expect(dialog.getByTestId('external-file-tables/character.yaml')).toContainText('保存していない変更があります');
  // 保存していない変更があるので、既定は上書き
  await expect(dialog.getByTestId('external-keep-tables/character.yaml')).toBeChecked();
  await dialog.getByTestId('external-apply').click();
  await expect(page.getByTestId('status')).toHaveText('保存しました（1 ファイル）');
  const text = await readOpfs(page, 'tables/character.yaml');
  expect(text).toContain('    hp: 4321\n');
  expect(text).toContain('name: 勇者アルス');
  await expect(page.getByTestId('project-modified')).toHaveCount(0);
  // 自分の保存は、外部での変更とみなさない
  await returnToWindow(page);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('external-dialog')).toHaveCount(0);
});

test('保存していない変更のあるテーブルを読み込み直すときは、変更が消えることを示して確かめる。保存をやめることもできる', async ({ page }) => {
  const files = await openOpfsProject(page);
  const hp = await colIndex(page, 'hp');
  await clickCell(page, 0, hp);
  await page.keyboard.type('4321');
  await page.keyboard.press('Enter');
  await writeExternally(page, 'tables/character.yaml', files['tables/character.yaml'].replace('hp: 1200', 'hp: 1300'));

  // 保存の直前の確認で「保存をやめる」と、保存しない
  await page.keyboard.press('Control+s');
  await page.getByTestId('external-cancel').click();
  await expect(page.getByTestId('external-dialog')).toHaveCount(0);
  expect(await readOpfs(page, 'tables/character.yaml')).toContain('hp: 1300');
  await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toBeVisible();

  await returnToWindow(page);
  const dialog = page.getByTestId('external-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('external-reload-tables/character.yaml').check();
  await dialog.getByTestId('external-apply').click();
  await expect(dialog.getByTestId('external-confirm')).toContainText('保存していない変更は失われます');
  await expect(dialog.getByTestId('external-confirm')).toContainText('tables/character.yaml');
  await dialog.getByTestId('external-apply').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('status')).toHaveText('1 ファイルを読み込み直しました。元に戻す履歴は消しました');
  expect(await cellText(page, 0, 'hp')).toBe('1300');
  await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toHaveCount(0);
});

test('消されたファイルを「上書きする」と、保存で作り直す', async ({ page }) => {
  const files = await openOpfsProject(page);
  await writeExternally(page, 'tables/stage.yaml', null);
  await returnToWindow(page);
  const dialog = page.getByTestId('external-dialog');
  await expect(dialog.getByTestId('external-file-tables/stage.yaml')).toContainText('削除されています');
  await dialog.getByTestId('external-keep-tables/stage.yaml').check();
  await dialog.getByTestId('external-apply').click();
  await expect(page.getByTestId('sheet-tab-stage').getByTestId('tab-modified')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('status')).toHaveText('保存しました（1 ファイル）');
  expect(await readOpfs(page, 'tables/stage.yaml')).toBe(files['tables/stage.yaml']);
});
