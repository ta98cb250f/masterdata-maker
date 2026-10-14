// 未保存の変更の退避と復元（FR-FIO-06）: 変更してから、保存せずにページを開き直すと復元を提案される
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { cellText, clickCell, colIndex } from './helpers';
import { openOpfsProject } from './opfs';

/** 退避の書き込み（kind: set / del）が終わるまで待つ */
async function waitBackup(page: Page, kind: 'set' | 'del'): Promise<void> {
  await page.waitForFunction(async (k) => {
    const manager = (globalThis as unknown as { sheetcraftBackup?: { idle(): Promise<void>; lastWrite: { kind: string } | null } }).sheetcraftBackup;
    if (manager === undefined) return false;
    await manager.idle();
    return manager.lastWrite?.kind === k;
  }, kind);
}

async function editHp(page: Page, row: number, text: string): Promise<void> {
  await clickCell(page, row, await colIndex(page, 'hp'));
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test('サンプル: 保存せずにページを開き直すと復元を提案し、復元すると保存していない変更として読み込む', async ({ page }) => {
  await page.goto('/?sample=basic');
  await expect(page.getByTestId('grid')).toBeVisible();
  await editHp(page, 0, '4321');
  await waitBackup(page, 'set');

  // 保存せずに開き直す（異常終了の代わり）
  await page.goto('/?sample=basic');
  const dialog = page.getByTestId('backup-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('backup-items')).toContainText('tables/character.yaml');
  await dialog.getByTestId('backup-restore').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('status')).toHaveText('保存していない変更を復元しました（1 件）');
  expect(await cellText(page, 0, 'hp')).toBe('4321');
  await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toBeVisible();
  // 復元は 1 回の操作として元に戻せる
  await page.keyboard.press('Control+z');
  expect(await cellText(page, 0, 'hp')).toBe('1200');
  await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toHaveCount(0);
});

test('「復元しない」を選ぶと退避を消し、次に開いても提案しない。プロジェクトを閉じたときも消す', async ({ page }) => {
  await page.goto('/?sample=basic');
  await expect(page.getByTestId('grid')).toBeVisible();
  await editHp(page, 0, '4321');
  await waitBackup(page, 'set');
  await page.goto('/?sample=basic');
  await page.getByTestId('backup-discard').click();
  await waitBackup(page, 'del');
  expect(await cellText(page, 0, 'hp')).toBe('1200');
  await page.goto('/?sample=basic');
  await expect(page.getByTestId('grid')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('backup-dialog')).toHaveCount(0);

  // 変更してからプロジェクトを閉じる（変更を捨てることを確かめる）と、退避も消える
  await editHp(page, 0, '777');
  await waitBackup(page, 'set');
  await page.getByTestId('menubar-file').dispatchEvent('mousedown');
  await page.getByTestId('menu-file.close').click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: '変更を破棄して続ける' }).click();
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await waitBackup(page, 'del');
  await page.getByTestId('open-sample').click();
  await expect(page.getByTestId('grid')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('backup-dialog')).toHaveCount(0);
});

test('直接保存方式: 前回のフォルダを開き直すと復元を提案する。保存すると退避を消す', async ({ page }) => {
  await openOpfsProject(page);
  await editHp(page, 0, '4321');
  await waitBackup(page, 'set');
  await page.reload();
  await page.getByTestId('open-last').click();
  const dialog = page.getByTestId('backup-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('backup-restore').click();
  expect(await cellText(page, 0, 'hp')).toBe('4321');
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('status')).toHaveText('保存しました（1 ファイル）');
  await waitBackup(page, 'del');
  await page.reload();
  await page.getByTestId('open-last').click();
  await expect(page.getByTestId('grid')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('backup-dialog')).toHaveCount(0);
  expect(await cellText(page, 0, 'hp')).toBe('4321');
});
