// 問題パネル（FR-UI-06）とセル情報パネル（FR-UI-07）の画面テスト
import { expect, test } from '@playwright/test';
import { clickCell, colIndex, nameBox, openBasicSample } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
  await openBasicSample(page);
});

test('問題パネル: 全テーブルのエラー・警告を一覧し、押すとそのテーブルに切り替えてセルを選ぶ。重大度で絞り込める', async ({ page }) => {
  // hp に検査ルール（min: 1）に違反する値と、警告（warn_above: 5000）になる値を入れる
  const hp = await colIndex(page, 'hp');
  await clickCell(page, 1, hp);
  await page.keyboard.type('6000');
  await page.keyboard.press('Enter');
  await page.keyboard.type('0');
  await page.keyboard.press('Enter');
  await page.getByTestId('menubar-view').click();
  await page.getByTestId('menu-panel.problems').click();
  const panel = page.getByTestId('problems-panel');
  await expect(panel).toBeVisible();
  const rows = panel.getByTestId('problem-row');
  await expect(rows.filter({ hasText: '6000' })).toHaveCount(1);
  const error = rows.filter({ has: page.locator('.key', { hasText: /^3$/ }) }).filter({ hasText: 'hp' });
  await expect(error.first()).toHaveClass(/error/);

  // 別のテーブルを表示していても、押すとそのテーブルのセルへ移る
  await page.getByTestId('sheet-tab-skill').click();
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'skill');
  await error.first().click();
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'character');
  await expect(nameBox(page)).toHaveText('character / hp / 3');

  // 重大度で絞り込む
  await page.getByTestId('problems-filter-error').click();
  await expect(rows.filter({ hasText: '6000' })).toHaveCount(1);
  await expect(panel.locator('.sc-problems-row.error')).toHaveCount(0);
  await page.getByTestId('problems-filter-error').click();
  await page.getByTestId('problems-filter-warning').click();
  await expect(rows.filter({ hasText: '6000' })).toHaveCount(0);
  await expect(error.first()).toBeVisible();
});

test('セル情報パネル: セル色・メモ・値の出どころと式・検査のメッセージ', async ({ page }) => {
  await page.getByTestId('menubar-view').click();
  await page.getByTestId('menu-panel.cellInfo').click();
  const panel = page.getByTestId('cell-info-panel');
  await expect(panel).toBeVisible();
  // 2 行目の hp: 値・セル色（赤）・メモ
  await clickCell(page, 1, await colIndex(page, 'hp'));
  await expect(panel.getByTestId('cell-info-location')).toContainText('character / hp / 2');
  await expect(panel.getByTestId('cell-info-source')).toContainText('値');
  await expect(panel.getByTestId('cell-info-color')).toContainText('赤 (red)');
  await expect(panel.getByTestId('cell-info-note')).toContainText('次回調整予定');
  // セル単位式
  const eff = await colIndex(page, 'effective_hp');
  await clickCell(page, 1, eff);
  await expect(panel.getByTestId('cell-info-source')).toContainText('セル単位式');
  await expect(panel.getByTestId('cell-info-formula')).toHaveText('=hp * 2');
  await expect(panel.getByTestId('cell-info-value')).toContainText('1600');
  // 列レベル式
  await clickCell(page, 0, eff);
  await expect(panel.getByTestId('cell-info-source')).toContainText('列レベル式');
  await expect(panel.getByTestId('cell-info-formula')).toHaveText('=hp * (1 + defense / 100)');
  // 既定値
  await clickCell(page, 2, await colIndex(page, 'defense'));
  await expect(panel.getByTestId('cell-info-source')).toContainText('既定値');
  // 検査のメッセージ
  const hp = await colIndex(page, 'hp');
  await clickCell(page, 2, hp);
  await page.keyboard.type('0');
  await page.keyboard.press('Enter');
  await clickCell(page, 2, hp);
  await expect(panel.getByTestId('cell-info-issues')).not.toContainText('問題はありません');
  await expect(panel.getByTestId('cell-info-issues').locator('li')).toHaveCount(1);
});
