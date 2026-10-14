// 列の設定（FR-COL-02〜04）と列の挿入・削除（FR-COL-01）の画面テスト
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { cellText, clickCell, colIndex, nameBox, openBasicSample } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
  await openBasicSample(page);
});

async function openMenuItem(page: Page, menu: string, command: string): Promise<void> {
  await page.getByTestId(`menubar-${menu}`).click();
  await page.getByTestId(`menu-${command}`).click();
}

/** 列のセルを選んで、データ メニューから列の設定を開く */
async function openColumnSettings(page: Page, column: string): Promise<void> {
  await clickCell(page, 0, await colIndex(page, column));
  await openMenuItem(page, 'data', 'column.settings');
  await expect(page.getByTestId('column-settings-dialog')).toBeVisible();
}

async function headerNames(page: Page): Promise<string[]> {
  return page.locator('.sc-colhead .sc-colhead-name').allTextContents();
}

test('列名を変えると、列レベル式とセル単位式の中の列名も書き換わり、Ctrl+Z で 1 回で戻る（FR-COL-03）', async ({ page }) => {
  await openColumnSettings(page, 'hp');
  await expect(page.getByTestId('col-name')).toHaveValue('hp');
  await page.getByTestId('col-name').fill('max_hp');
  await page.getByTestId('col-display_name').fill('最大HP');
  await page.getByTestId('column-settings-ok').click();
  await expect(page.getByTestId('column-settings-dialog')).toHaveCount(0);
  expect(await headerNames(page)).toContain('max_hp');
  await expect(page.locator('.sc-colhead-title', { hasText: '最大HP' })).toBeVisible();
  const eff = await colIndex(page, 'effective_hp');
  await clickCell(page, 0, eff);
  await expect(page.getByTestId('formula-input')).toHaveAttribute('placeholder', '=max_hp * (1 + defense / 100)');
  await clickCell(page, 1, eff);
  await expect(page.getByTestId('formula-input')).toHaveValue('=max_hp * 2');
  expect(await cellText(page, 1, 'effective_hp')).toBe('1600');
  await page.keyboard.press('Control+z');
  await expect.poll(() => headerNames(page)).toContain('hp');
  await clickCell(page, 1, await colIndex(page, 'effective_hp'));
  await expect(page.getByTestId('formula-input')).toHaveValue('=hp * 2');
});

test('型を変えると、変換できない値を先に一覧で示し、承認すると変換する（FR-COL-04）', async ({ page }) => {
  await openColumnSettings(page, 'memo');
  await page.getByTestId('col-type').selectOption('int');
  await page.getByTestId('column-settings-ok').click();
  const issues = page.getByTestId('type-change-issues');
  await expect(issues).toBeVisible();
  await expect(issues).toContainText('2 件');
  await expect(issues.locator('li')).toHaveCount(2);
  await expect(issues).toContainText('主人公');
  // 戻ると型の変更をやめられる
  await page.getByTestId('type-change-back').click();
  await expect(issues).toHaveCount(0);
  await page.getByTestId('column-settings-ok').click();
  await page.getByTestId('type-change-confirm').click();
  await expect(page.getByTestId('column-settings-dialog')).toHaveCount(0);
  const memo = await colIndex(page, 'memo');
  await expect(page.locator(`.sc-colhead[data-col="${memo}"] .sc-colhead-type`).first()).toHaveText('int');
  // 変換できない値はそのまま残る（検査でエラーになる）
  expect(await cellText(page, 0, 'memo')).toBe('主人公');
});

test('値が型に合わない・列定義の検査に違反するときは、理由を示して確定させない（FR-EDT-05、FR-VAL-07）', async ({ page }) => {
  await openColumnSettings(page, 'defense');
  await page.getByTestId('col-default').fill('abc');
  await expect(page.getByTestId('column-settings-dialog')).toContainText('abc は整数ではありません');
  await page.getByTestId('column-settings-ok').click();
  await expect(page.getByTestId('column-settings-dialog')).toBeVisible();
  await page.getByTestId('col-default').fill('5');
  // 存在しない列を参照する式は、列定義の検査で止まる
  await page.getByTestId('col-formula').fill('nothing * 2');
  await page.getByTestId('column-settings-ok').click();
  await expect(page.getByTestId('column-settings-failures')).toContainText('nothing');
  await page.getByTestId('col-formula').fill('');
  await page.getByTestId('col-max').fill('500');
  await page.getByTestId('column-settings-ok').click();
  await expect(page.getByTestId('column-settings-dialog')).toHaveCount(0);
  const field = await page.evaluate(() => {
    const store = (globalThis as unknown as { sheetcraft: { project: { tables: { name: string; fields: { name: string; default?: unknown; validation?: unknown }[] }[] } } }).sheetcraft;
    const f = store.project.tables.find((t) => t.name === 'character')?.fields.find((x) => x.name === 'defense');
    return { default: f?.default, validation: f?.validation };
  });
  expect(field).toEqual({ default: 5, validation: { min: 0, max: 500 } });
});

test('列レベル式の欄で、列名と関数名を補完できる（FR-EDT-07）', async ({ page }) => {
  await openColumnSettings(page, 'effective_hp');
  const formula = page.getByTestId('col-formula');
  await formula.fill('');
  await formula.pressSequentially('ROU');
  await expect(page.getByTestId('formula-assist')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(formula).toHaveValue('ROUND(');
  await formula.pressSequentially('def');
  await page.keyboard.press('Enter');
  await expect(formula).toHaveValue('ROUND(defense');
  await formula.pressSequentially(' * 2)');
  await expect(page.getByTestId('column-settings-dialog')).toContainText('式の構文は正しい');
  await page.getByTestId('column-settings-ok').click();
  await expect(page.getByTestId('column-settings-dialog')).toHaveCount(0);
  expect(await cellText(page, 0, 'effective_hp')).toBe('60');
});

test('共通列の設定は共通設定へ案内する', async ({ page }) => {
  await openColumnSettings(page, 'id');
  await expect(page.getByTestId('base-column-notice')).toContainText('共通列');
  await page.getByTestId('open-common-settings').click();
  await expect(page.getByTestId('common-settings-dialog')).toBeVisible();
  await expect(page.getByTestId('settings-base-fields')).toBeVisible();
  await expect(page.getByTestId('base-name')).toHaveValue('id');
});

test('列の挿入（右・左）と削除（データも消えることを確認する。FR-COL-01）', async ({ page }) => {
  await clickCell(page, 0, await colIndex(page, 'name'));
  await openMenuItem(page, 'insert', 'column.insertRight');
  await expect(page.getByTestId('column-insert-dialog')).toBeVisible();
  await page.getByTestId('col-insert-name').fill('Bad');
  await expect(page.getByTestId('column-insert-dialog')).toContainText('列名に使えません');
  await page.getByTestId('col-insert-name').fill('rank');
  await page.getByTestId('col-insert-type').selectOption('int');
  await page.getByTestId('col-insert-display').fill('ランク');
  await page.getByTestId('column-insert-ok').click();
  await expect(page.getByTestId('column-insert-dialog')).toHaveCount(0);
  const names = await headerNames(page);
  expect(names.indexOf('rank')).toBe(names.indexOf('name') + 1);
  // 挿入した列が選ばれている
  await expect(nameBox(page)).toHaveText('character / rank / 1');
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  expect(await cellText(page, 0, 'rank')).toBe('5');

  // 左に挿入（列挙型の列）
  await clickCell(page, 0, await colIndex(page, 'name'));
  await openMenuItem(page, 'insert', 'column.insertLeft');
  await page.getByTestId('col-insert-name').fill('grade');
  await page.getByTestId('col-insert-type').selectOption('enum');
  await page.getByTestId('col-insert-enum').selectOption('rarity');
  await page.getByTestId('column-insert-ok').click();
  const after = await headerNames(page);
  expect(after.indexOf('grade')).toBe(after.indexOf('name') - 1);

  // 削除: 確認してから消す
  await clickCell(page, 0, await colIndex(page, 'rank'));
  await openMenuItem(page, 'edit', 'column.delete');
  await expect(page.getByTestId('confirm-dialog')).toContainText('rank');
  await expect(page.getByTestId('confirm-dialog')).toContainText('データもすべて削除');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: '削除' }).click();
  await expect.poll(() => headerNames(page)).not.toContain('rank');
  await page.keyboard.press('Control+z');
  await expect.poll(() => headerNames(page)).toContain('rank');
  expect(await cellText(page, 0, 'rank')).toBe('5');
});

test('複数の列を選んで削除する。共通列は消さない', async ({ page }) => {
  const head = (name: string) => page.locator('.sc-colhead-name', { hasText: new RegExp(`^${name}$`) }).first();
  await head('defense').click();
  await head('effective_hp').click({ modifiers: ['Shift'] });
  await page.getByTestId('menubar-edit').click();
  await expect(page.getByTestId('menu-column.delete')).toContainText('2 列を削除');
  await page.getByTestId('menu-column.delete').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('defense, effective_hp');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: '削除' }).click();
  await expect.poll(() => headerNames(page)).not.toContain('defense');
  expect(await headerNames(page)).not.toContain('effective_hp');
  // 共通列（version）を含めて選んでも、共通列は消さない
  await head('version').click();
  await head('name').click({ modifiers: ['Shift'] });
  await page.getByTestId('menubar-edit').click();
  await page.getByTestId('menu-column.delete').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('共通列 version は削除しません');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: '削除' }).click();
  await expect.poll(() => headerNames(page)).not.toContain('name');
  expect(await headerNames(page)).toContain('version');
});
