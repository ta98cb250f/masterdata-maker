// 検索と置換（FR-FND-01〜04）の画面テスト: Ctrl+F の検索欄、Ctrl+H の検索と置換のダイアログ
import { expect, test } from '@playwright/test';
import { cellText, clickCell, colIndex, nameBox, openBasicSample } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
  await openBasicSample(page);
});

test('Ctrl+F で右上の検索欄を出し、入力すると一致するセルへ移る。Enter で次、Shift+Enter で前、Esc で閉じる', async ({ page }) => {
  await clickCell(page, 0, await colIndex(page, 'name'));
  await page.keyboard.press('Control+f');
  const bar = page.getByTestId('find-bar');
  await expect(bar).toBeVisible();
  await expect(page.getByTestId('find-bar-input')).toBeFocused();
  await page.keyboard.type('リナ');
  await expect(page.getByTestId('find-bar-count')).toHaveText('1 / 1');
  await expect(nameBox(page)).toHaveText('character / name / 2');

  // 大文字と小文字は区別しない。複数の一致を順にたどる
  await page.getByTestId('find-bar-input').fill('ssr');
  await expect(page.getByTestId('find-bar-count')).toHaveText(/ 1$/);
  await page.getByTestId('find-bar-input').fill('0');
  await expect(page.getByTestId('find-bar-count')).toHaveText(/^1 \/ \d+$/);
  const first = await nameBox(page).textContent();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('find-bar-count')).toHaveText(/^2 \/ \d+$/);
  await expect(nameBox(page)).not.toHaveText(first ?? '');
  await page.keyboard.press('Shift+Enter');
  await expect(page.getByTestId('find-bar-count')).toHaveText(/^1 \/ \d+$/);
  await expect(nameBox(page)).toHaveText(first ?? '');

  await page.getByTestId('find-bar-input').fill('見つからない語');
  await expect(page.getByTestId('find-bar-count')).toHaveText('0 / 0');
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  await expect(page.getByTestId('cell-input')).toBeFocused();
});

test('Ctrl+H の置換は型の変換規則と編集可否に従い、置換できなかったセルを一覧で示す（FR-FND-04）', async ({ page }) => {
  await page.getByTestId('sheet-tab-skill').click();
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'skill');
  await page.keyboard.press('Control+h');
  const dialog = page.getByTestId('find-replace-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('find-query').fill('1');
  await page.getByTestId('find-replacement').fill('9');
  await page.getByTestId('find-scope').selectOption('table');
  await page.getByTestId('find-replace-all').click();
  // cost の 10 → 90、12 → 92 は置換でき、id（編集できない列）は置換できない
  await expect(page.getByTestId('find-message')).toContainText('2 件を置換しました');
  const failures = page.getByTestId('replace-failures');
  await expect(failures).toContainText('skill / id / 1');
  await expect(failures).toContainText('編集できません');
  await page.getByTestId('find-done').click();
  expect(await cellText(page, 0, 'cost')).toBe('90');
  expect(await cellText(page, 2, 'cost')).toBe('92');
  // 1 回の Ctrl+Z ですべて戻る
  await page.keyboard.press('Control+z');
  await expect.poll(() => cellText(page, 0, 'cost')).toBe('10');
  expect(await cellText(page, 2, 'cost')).toBe('12');
});

test('型に合わない置換は失敗の一覧に出る。正規表現・セル全体の一致・数式内も検索・全テーブル', async ({ page }) => {
  await page.keyboard.press('Control+h');
  await page.getByTestId('find-query').fill('^(\\d)0$');
  await page.getByTestId('find-regex').check();
  await page.getByTestId('find-replacement').fill('a$1');
  await page.getByTestId('find-replace-all').click();
  // character.defense の 30・10、skill.cost の 10 → 整数でないので置換できない
  await expect(page.getByTestId('find-message')).toContainText('0 件を置換しました');
  await expect(page.getByTestId('replace-failures')).toContainText('整数ではありません');
  await expect(page.getByTestId('replace-failures')).toContainText('skill / cost / 1');

  // 数式内も検索: セル単位式の中の hp を置換する
  await page.getByTestId('find-regex').uncheck();
  await page.getByTestId('find-query').fill('hp * 2');
  await page.getByTestId('find-replacement').fill('hp * 3');
  await page.getByTestId('find-replace-all').click();
  await expect(page.getByTestId('find-message')).toContainText('見つかりませんでした');
  await page.getByTestId('find-search-formulas').check();
  await page.getByTestId('find-replace-all').click();
  await expect(page.getByTestId('find-message')).toContainText('1 件を置換しました');
  await page.getByTestId('find-done').click();
  expect(await cellText(page, 1, 'effective_hp')).toBe('2400');

  // セル全体の一致: 「ファイア」だけに一致し、「ファ」には一致しない
  await page.keyboard.press('Control+h');
  await page.getByTestId('find-query').fill('ファ');
  await page.getByTestId('find-entire-cell').check();
  await page.getByTestId('find-next').click();
  await expect(page.getByTestId('find-message')).toContainText('見つかりませんでした');
  await page.getByTestId('find-query').fill('ファイア');
  await page.getByTestId('find-next').click();
  await expect(page.getByTestId('find-message')).toContainText('1 件中 1 件目');
  await page.getByTestId('find-done').click();
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'skill');
  await expect(nameBox(page)).toHaveText('skill / name / 1');
});

test('検索欄の「その他のオプション」で検索と置換のダイアログに切り替わる', async ({ page }) => {
  await page.keyboard.press('Control+f');
  await page.keyboard.type('勇者');
  await page.getByTestId('find-bar-more').click();
  await expect(page.getByTestId('find-replace-dialog')).toBeVisible();
  await expect(page.getByTestId('find-query')).toHaveValue('勇者');
  await expect(page.getByTestId('find-bar')).toHaveCount(0);
});
