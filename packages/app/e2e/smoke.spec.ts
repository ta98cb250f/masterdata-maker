// 画面の基盤のスモークテスト: 組み込みのサンプルを開き、選択・入力・元に戻す・テーブルの切り替え・入力の検査を確かめる
import { expect, test } from '@playwright/test';
import { cellText, clickCell, colIndex, nameBox, openBasicSample } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
  await openBasicSample(page);
});

test('サンプルを開くとグリッドが表示される（列ヘッダー・セル・シートタブ）', async ({ page }) => {
  await expect(page.getByTestId('project-name')).toHaveText('basic-yaml');
  await expect(page.locator('.sc-colhead-title', { hasText: '名前' })).toBeVisible();
  expect(await cellText(page, 0, 'name')).toBe('勇者アルス');
  // 列レベル式は計算結果を表示する（1200 * (1 + 30 / 100)）
  expect(await cellText(page, 0, 'effective_hp')).toBe('1560');
  await expect(page.getByTestId('sheet-tab-character')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('sheet-tab-skill')).toBeVisible();
  await expect(page.getByTestId('sheet-tab-stage')).toBeVisible();
  await expect(nameBox(page)).toHaveText('character / id / 1');
});

test('セルを選んで値を入力し、Enter で確定すると下へ移る。Ctrl+Z で戻る', async ({ page }) => {
  const hp = await colIndex(page, 'hp');
  await clickCell(page, 1, hp);
  await expect(nameBox(page)).toHaveText('character / hp / 2');
  await page.keyboard.type('1000');
  await expect(page.getByTestId('cell-input')).toHaveValue('1000');
  await expect(page.getByTestId('formula-input')).toHaveValue('1000');
  await page.keyboard.press('Enter');
  await expect(nameBox(page)).toHaveText('character / hp / 3');
  expect(await cellText(page, 1, 'hp')).toBe('1000');
  // セル単位式 hp * 2 も計算し直される
  expect(await cellText(page, 1, 'effective_hp')).toBe('2000');
  await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect.poll(() => cellText(page, 1, 'hp')).toBe('800');
  expect(await cellText(page, 1, 'effective_hp')).toBe('1600');
  await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect.poll(() => cellText(page, 1, 'hp')).toBe('1000');
});

test('テーブルを切り替えても未保存の変更と印が残る（§5.17 の 5 番）', async ({ page }) => {
  const hp = await colIndex(page, 'hp');
  await clickCell(page, 1, hp);
  await page.keyboard.type('1000');
  await page.keyboard.press('Enter');
  await page.getByTestId('sheet-tab-skill').click();
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'skill');
  expect(await cellText(page, 0, 'name')).toBe('ファイア');
  await page.getByTestId('sheet-tab-character').click();
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'character');
  expect(await cellText(page, 1, 'hp')).toBe('1000');
  await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toBeVisible();
  await expect(page.getByTestId('sheet-tab-skill').getByTestId('tab-modified')).toHaveCount(0);
  // 選択の位置もテーブルごとに残る
  await expect(nameBox(page)).toHaveText('character / hp / 3');
});

test('元に戻すと、変更のあったテーブルを表示する（§5.17 の 6 番）', async ({ page }) => {
  const hp = await colIndex(page, 'hp');
  await clickCell(page, 0, hp);
  await page.keyboard.type('1300');
  await page.keyboard.press('Enter');
  await page.getByTestId('sheet-tab-skill').click();
  await clickCell(page, 0, await colIndex(page, 'cost'));
  await page.keyboard.type('99');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'skill');
  await expect.poll(() => cellText(page, 0, 'cost')).toBe('10');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'character');
  await expect.poll(() => cellText(page, 0, 'hp')).toBe('1200');
});

test('int の列に 12a を入れると確定されず、入力を残したまま理由が出る（FR-EDT-05）', async ({ page }) => {
  const hp = await colIndex(page, 'hp');
  await clickCell(page, 0, hp);
  await page.keyboard.type('12a');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('edit-error')).toContainText('12a は整数ではありません');
  await expect(page.getByTestId('edit-error')).toContainText('整数を入力してください');
  await expect(page.getByTestId('cell-input')).toHaveValue('12a');
  await expect(nameBox(page)).toHaveText('character / hp / 1');
  expect(await cellText(page, 0, 'hp')).toBe('1200');
  // Esc で取り消す
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-error')).toHaveCount(0);
  expect(await cellText(page, 0, 'hp')).toBe('1200');
  await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toHaveCount(0);
});

test('編集できない列（id）は入力を受け付けない（FR-EDT-06）', async ({ page }) => {
  await clickCell(page, 0, 0);
  await page.keyboard.type('5');
  await expect(page.getByTestId('status')).toContainText('編集できません');
  expect(await cellText(page, 0, 'id')).toBe('1');
});

test('数式バー: セル単位式は式を、列レベル式に従うセルは列の式を「列の式」として表示する（FR-UI-02）', async ({ page }) => {
  const eff = await colIndex(page, 'effective_hp');
  await clickCell(page, 1, eff);
  await expect(page.getByTestId('formula-input')).toHaveValue('=hp * 2');
  await expect(page.getByTestId('formula-badge')).toHaveCount(0);
  await clickCell(page, 0, eff);
  await expect(page.getByTestId('formula-input')).toHaveValue('');
  await expect(page.getByTestId('formula-input')).toHaveAttribute('placeholder', '=hp * (1 + defense / 100)');
  await expect(page.getByTestId('formula-badge')).toHaveText('列の式');
  // 数式バーで編集して Enter で確定する
  const hp = await colIndex(page, 'hp');
  await clickCell(page, 2, hp);
  await page.getByTestId('formula-input').click();
  await page.getByTestId('formula-input').fill('700');
  await page.keyboard.press('Enter');
  await expect.poll(() => cellText(page, 2, 'hp')).toBe('700');
});

test('貼り付けの失敗は、失敗したセルの一覧を示して全体を取りやめる（§5.17 の 3 番）', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const hp = await colIndex(page, 'hp');
  await clickCell(page, 0, hp);
  await page.evaluate(() => navigator.clipboard.writeText('10\nabc\n30'));
  await page.keyboard.press('Control+v');
  await expect(page.getByTestId('message-items')).toContainText('2 行目: abc は整数ではありません');
  await page.getByTestId('message-dialog').getByRole('button').click();
  expect(await cellText(page, 0, 'hp')).toBe('1200');
  expect(await cellText(page, 2, 'hp')).toBe('650');
  // 正しい値なら貼り付けられ、1 回の Ctrl+Z で戻る
  await page.evaluate(() => navigator.clipboard.writeText('10\n20\n30'));
  await page.keyboard.press('Control+v');
  await expect.poll(() => cellText(page, 2, 'hp')).toBe('30');
  expect(await cellText(page, 0, 'hp')).toBe('10');
  await page.keyboard.press('Control+z');
  await expect.poll(() => cellText(page, 2, 'hp')).toBe('650');
});

test('コピーするとタブ区切りのテキストをクリップボードに入れる（FR-CLP-02）', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const name = await colIndex(page, 'name');
  const hp = await colIndex(page, 'hp');
  await clickCell(page, 0, name);
  await page.keyboard.down('Shift');
  await clickCell(page, 1, hp);
  await page.keyboard.up('Shift');
  await page.keyboard.press('Control+c');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toBe('勇者アルス\tSSR\t1200\n魔法使いリナ\tSR\t800');
});

test('保存すると変更したファイルをダウンロードし、未保存の印が消える（サンプルはダウンロード保存方式）', async ({ page }) => {
  const hp = await colIndex(page, 'hp');
  await clickCell(page, 1, hp);
  await page.keyboard.type('1000');
  await page.keyboard.press('Enter');
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const file = await download;
  expect(file.suggestedFilename()).toBe('character.yaml');
  const path = await file.path();
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(path, 'utf8');
  expect(text).toContain('hp: { value: 1000, color: red, comment: 次回調整予定 }');
  await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toHaveCount(0);
  await expect(page.getByTestId('project-modified')).toHaveCount(0);
});
