// ショートカット一覧（FR-ETC-01）・共通設定（FR-TBL-03）・連番入力（FR-FIL-05）・名前ボックスでの移動（FR-UI-03）・
// 入力補完（FR-EDT-07）の画面テスト
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

test('Ctrl+/ でキーボード ショートカットの一覧を分類ごとに出す。Windows / Mac の表記を切り替えられる', async ({ page }) => {
  await clickCell(page, 0, 2);
  await page.keyboard.press('Control+/');
  const dialog = page.getByTestId('shortcuts-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('shortcuts-common')).toContainText('一般的な操作');
  await expect(dialog.getByTestId('shortcut-copy')).toContainText('Ctrl+C');
  await expect(dialog.getByTestId('shortcut-fillDown')).toContainText('Ctrl+D');
  await expect(dialog.getByTestId('shortcuts-navigate')).toBeVisible();
  await page.getByTestId('shortcuts-platform').selectOption('mac');
  await expect(dialog.getByTestId('shortcut-copy')).toContainText('⌘+C');
  await page.getByTestId('shortcuts-filter').fill('貼り付け');
  await expect(dialog.getByTestId('shortcut-paste')).toBeVisible();
  await expect(dialog.getByTestId('shortcut-copy')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('共通設定: 列挙型の名前の変更（列の参照も書き換え）と値の追加、セル色のキーの変更（セルも書き換え）を 1 回で保存・元に戻す', async ({ page }) => {
  await openMenuItem(page, 'file', 'settings.common');
  const dialog = page.getByTestId('common-settings-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('enum-item-rarity').click();
  await page.getByTestId('enum-name').fill('grade');
  // 最後の値で Enter を押すと下に行が足され、そこに入力が移る
  await page.getByTestId('enum-values').getByTestId('enum-value').last().press('Enter');
  await page.keyboard.type('UR');
  await page.getByTestId('settings-tab-colors').click();
  await page.getByTestId('color-row-0').getByTestId('color-key').fill('danger');
  await page.getByTestId('color-row-0').getByTestId('color-label').fill('危険');
  // 誤り（色コード）があると保存できない
  await page.getByTestId('color-row-1').getByTestId('color-code').fill('orange');
  await expect(page.getByTestId('settings-colors')).toContainText('色コード');
  await page.getByTestId('settings-ok').click();
  await expect(dialog).toBeVisible();
  await page.getByTestId('color-row-1').getByTestId('color-code').fill('#fce5cd');
  await page.getByTestId('settings-ok').click();
  await expect(dialog).toHaveCount(0);

  const state = () =>
    page.evaluate(() => {
      type Cell = { color?: string } | number | string;
      const store = (globalThis as unknown as {
        sheetcraft: { project: { common: { enums: { items: { name: string; values: string[] }[] }; colors: { items: { key: string }[] } }; tables: { name: string; fields: { name: string; enum_ref?: string }[]; records: { cells: Map<string, Cell> }[] }[] } };
      }).sheetcraft;
      const p = store.project;
      const character = p.tables.find((t) => t.name === 'character');
      const hp = character?.records[1].cells.get('hp');
      return {
        enums: p.common.enums.items.map((e) => `${e.name}:${e.values.length}`),
        rarityRef: character?.fields.find((f) => f.name === 'rarity')?.enum_ref,
        firstColor: p.common.colors.items[0].key,
        hpColor: typeof hp === 'object' ? hp.color : undefined,
      };
    });
  expect(await state()).toEqual({ enums: ['grade:5', 'element:5'], rarityRef: 'grade', firstColor: 'danger', hpColor: 'danger' });
  await page.keyboard.press('Control+z');
  await expect.poll(state).toEqual({ enums: ['rarity:4', 'element:5'], rarityRef: 'rarity', firstColor: 'red', hpColor: 'red' });
});

test('共通設定: 列挙型の値の名前を変えると、その値のセルも書き換える。消す値が使われていれば注意を出す', async ({ page }) => {
  const rarity = 'rarity';
  expect(await cellText(page, 1, rarity)).toBe('SR');
  await openMenuItem(page, 'file', 'settings.common');
  await page.getByTestId('enum-item-rarity').click();
  const values = page.getByTestId('enum-values');
  await values.getByTestId('enum-value-row-2').getByTestId('enum-value').fill('SuperRare');
  await expect(values.getByTestId('enum-value-row-2').getByTestId('enum-value-renamed')).toHaveText('もとは SR（1 セルを書き換えます）');
  await values.getByTestId('enum-value-row-1').getByTestId('enum-value-remove').click();
  await expect(page.getByTestId('settings-warnings')).toContainText('削除する値 R（列挙型 rarity）は 1 セルで使われています');
  await page.getByTestId('settings-ok').click();
  await expect(page.getByTestId('common-settings-dialog')).toHaveCount(0);
  await expect.poll(() => cellText(page, 1, rarity)).toBe('SuperRare');
  expect(await cellText(page, 2, rarity)).toBe('R');
  await page.keyboard.press('Control+z');
  await expect.poll(() => cellText(page, 1, rarity)).toBe('SR');
});

test('共通設定: 共通列を追加すると、全テーブルの先頭に列が付く', async ({ page }) => {
  await openMenuItem(page, 'file', 'settings.common');
  await page.getByTestId('settings-tab-base_fields').click();
  await page.getByTestId('base-add').click();
  await page.getByTestId('base-name').fill('note');
  await page.getByTestId('base-display_name').fill('備考');
  await page.getByTestId('settings-ok').click();
  await expect(page.getByTestId('common-settings-dialog')).toHaveCount(0);
  await expect(page.locator('.sc-colhead-title', { hasText: '備考' })).toBeVisible();
  await page.getByTestId('sheet-tab-skill').click();
  await expect(page.locator('.sc-colhead-title', { hasText: '備考' })).toBeVisible();
});

test('連番入力: 開始値と増分を入れて選択範囲を埋める（FR-FIL-05）', async ({ page }) => {
  const hp = await colIndex(page, 'hp');
  await clickCell(page, 0, hp);
  await page.keyboard.down('Shift');
  await clickCell(page, 2, hp);
  await page.keyboard.up('Shift');
  await openMenuItem(page, 'edit', 'fill.series');
  const dialog = page.getByTestId('series-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('series-start')).toHaveValue('1200');
  await page.getByTestId('series-start').fill('100');
  await page.getByTestId('series-step').fill('abc');
  await page.getByTestId('series-ok').click();
  await expect(page.getByTestId('series-failures')).toContainText('abc');
  await page.getByTestId('series-step').fill('50');
  await page.getByTestId('series-ok').click();
  await expect(dialog).toHaveCount(0);
  expect(await cellText(page, 0, 'hp')).toBe('100');
  expect(await cellText(page, 1, 'hp')).toBe('150');
  expect(await cellText(page, 2, 'hp')).toBe('200');
  await page.keyboard.press('Control+z');
  await expect.poll(() => cellText(page, 2, 'hp')).toBe('650');
});

test('名前ボックスに「テーブル / 列名 / 主キー」を入れて Enter で、そのセルへ移る（FR-UI-03）', async ({ page }) => {
  await nameBox(page).click();
  const input = page.getByTestId('name-box-input');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('character / id / 1');
  await input.fill('skill / cost / 2');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'skill');
  await expect(nameBox(page)).toHaveText('skill / cost / 2');
  await expect(page.getByTestId('cell-input')).toBeFocused();
  // テーブルを省略すると表示中のテーブル
  await nameBox(page).click();
  await page.getByTestId('name-box-input').fill('name / 3');
  await page.keyboard.press('Enter');
  await expect(nameBox(page)).toHaveText('skill / name / 3');
  // 見つからなければ理由を出して、入力を残す
  await nameBox(page).click();
  await page.getByTestId('name-box-input').fill('skill / cost / 99');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('name-box-error')).toContainText('99');
  await expect(page.getByTestId('name-box-input')).toHaveValue('skill / cost / 99');
  await page.keyboard.press('Escape');
  await expect(nameBox(page)).toHaveText('skill / name / 3');
});

test('セル内の編集と数式バーで、= から始まる式の列名と関数名を補完する（FR-EDT-07）', async ({ page }) => {
  const memo = await colIndex(page, 'memo');
  await clickCell(page, 0, memo);
  await page.keyboard.type('=LE');
  const assist = page.getByTestId('formula-assist');
  await expect(assist).toBeVisible();
  await expect(assist.getByTestId('formula-assist-item')).toHaveText([/LEFT/, /LEN/]);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('cell-input')).toHaveValue('=LEFT(');
  await page.keyboard.type('na');
  await expect(assist.getByTestId('formula-assist-item')).toHaveText([/name/]);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('cell-input')).toHaveValue('=LEFT(name');
  await page.keyboard.type(', 2)');
  await expect(assist).toHaveCount(0);
  await page.keyboard.press('Enter');
  expect(await cellText(page, 0, 'memo')).toBe('勇者');

  // 数式バー
  await clickCell(page, 1, memo);
  await page.getByTestId('formula-input').click();
  await page.getByTestId('formula-input').fill('');
  await page.keyboard.type('=UPP');
  await expect(assist).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('formula-input')).toHaveValue('=UPPER(');
  await page.keyboard.type('code)');
  await page.keyboard.press('Enter');
  expect(await cellText(page, 1, 'memo')).toBe('1.10');
});
