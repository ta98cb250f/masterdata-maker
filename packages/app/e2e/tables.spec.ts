// テーブル（シート）の管理（FR-TBL-01〜02）の画面テスト: 新規作成・名前の変更・複製・削除、シートタブの右クリックメニュー
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { openBasicSample } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
  await openBasicSample(page);
});

async function tabMenu(page: Page, table: string, command: string): Promise<void> {
  await page.getByTestId(`sheet-tab-${table}`).click({ button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await page.getByTestId(`menu-${command}`).click();
}

function fieldRef(page: Page, table: string, column: string): Promise<string | undefined> {
  return page.evaluate(
    ([t, c]) => {
      const store = (globalThis as unknown as { sheetcraft: { project: { tables: { name: string; fields: { name: string; ref?: string }[] }[] } } }).sheetcraft;
      return store.project.tables.find((x) => x.name === t)?.fields.find((f) => f.name === c)?.ref;
    },
    [table, column],
  );
}

test('シートタブの + で新しいテーブルを作る（共通列だけの雛形。FR-TBL-01）', async ({ page }) => {
  await page.getByTestId('sheet-add').click();
  const dialog = page.getByTestId('table-form-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('table-name').fill('character');
  await expect(dialog).toContainText('既にあります');
  await page.getByTestId('table-name').fill('Item');
  await expect(dialog).toContainText('テーブル名に使えません');
  await page.getByTestId('table-name').fill('item');
  await page.getByTestId('table-display-name').fill('アイテム');
  await page.getByTestId('table-form-ok').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('sheet-tab-item')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('sheet-tab-item')).toContainText('アイテム');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'item');
  await expect(page.locator('.sc-colhead-name')).toHaveText(['id', 'version']);
  await expect(page.getByTestId('sheet-tab-item').getByTestId('tab-modified')).toBeVisible();
  // 元に戻すとテーブルも消える
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('sheet-tab-item')).toHaveCount(0);
});

test('名前を変更すると、他のテーブルの参照もまとめて書き換える（FR-TBL-02）', async ({ page }) => {
  await tabMenu(page, 'skill', 'table.rename');
  await expect(page.getByTestId('table-name')).toHaveValue('skill');
  await page.getByTestId('table-name').fill('ability');
  await page.getByTestId('table-display-name').fill('アビリティ');
  await page.getByTestId('table-form-ok').click();
  await expect(page.getByTestId('sheet-tab-ability')).toContainText('アビリティ');
  await expect(page.getByTestId('sheet-tab-skill')).toHaveCount(0);
  expect(await fieldRef(page, 'character', 'skill_ids')).toBe('ability.id');
  // ダブルクリックでも名前を変えられる
  await page.getByTestId('sheet-tab-stage').dblclick();
  await expect(page.getByTestId('table-form-dialog')).toBeVisible();
  await expect(page.getByTestId('table-name')).toHaveValue('stage');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('table-form-dialog')).toHaveCount(0);
});

test('削除は、参照されていれば参照元を示して警告する（FR-TBL-02）', async ({ page }) => {
  await tabMenu(page, 'skill', 'table.delete');
  const dialog = page.getByTestId('table-delete-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('table-references')).toContainText('character.skill_ids');
  await page.getByTestId('table-delete-ok').click();
  await expect(page.getByTestId('sheet-tab-skill')).toHaveCount(0);
  // 参照されていないテーブルは警告なしで確認だけ
  await page.getByTestId('sheet-add').click();
  await page.getByTestId('table-name').fill('temp');
  await page.getByTestId('table-form-ok').click();
  await tabMenu(page, 'temp', 'table.delete');
  await expect(page.getByTestId('table-delete-dialog')).toBeVisible();
  await expect(page.getByTestId('table-references')).toHaveCount(0);
  await page.getByTestId('table-delete-ok').click();
  await expect(page.getByTestId('sheet-tab-temp')).toHaveCount(0);
});

test('複製すると、名前の候補（_copy）を付けた複製を表示する', async ({ page }) => {
  await tabMenu(page, 'stage', 'table.duplicate');
  await expect(page.getByTestId('sheet-tab-stage_copy')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('sheet-tab-stage_copy')).toContainText('ステージ のコピー');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'stage_copy');
  await expect(page.locator('.sc-row')).not.toHaveCount(0);
});
