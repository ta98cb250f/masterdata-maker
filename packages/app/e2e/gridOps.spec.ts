// グリッドの追加操作（段階 6）の画面テスト: ドラッグの範囲選択（§5.17 の 1 番）、フィルハンドル（4 番）、範囲の移動、
// 右クリックメニュー、並べ替えとフィルタ、行・列の移動、セル色とメモ、参照先への移動、列の固定・非表示、行の複製
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { cellPoint, cellText, clickCell, colIndex, openBasicSample } from './helpers';

interface SelectionInfo {
  kind: string;
  range: { top: number; left: number; bottom: number; right: number };
  /** 表示中のテーブル名・現在のセルの列名・主キー（id） */
  table: string;
  column: string;
  id: unknown;
}

/** 表示中のテーブルの選択（store から読む） */
function selection(page: Page): Promise<SelectionInfo> {
  return page.evaluate(() => {
    type Sheet = { table: { name: string; uid: number }; columns: { name: string }[]; recordAt(row: number): { cells: Map<string, unknown> } | undefined };
    type Sel = { kind: string; ranges: SelectionInfo['range'][]; anchor: { row: number; col: number } };
    const store = (globalThis as unknown as { sheetcraft: { sheet(): Sheet; view(uid: number): { selection: Sel } } }).sheetcraft;
    const sheet = store.sheet();
    const sel = store.view(sheet.table.uid).selection;
    return {
      kind: sel.kind,
      range: sel.ranges[0],
      table: sheet.table.name,
      column: sheet.columns[sel.anchor.col]?.name ?? '',
      id: sheet.recordAt(sel.anchor.row)?.cells.get('id'),
    };
  });
}

/** 表示上の (row, 列名) のセルの要素（描かれているセルの中から、列ヘッダーと左端が一致するもの） */
async function cellAt(page: Page, row: number, column: string): Promise<Locator> {
  const col = await colIndex(page, column);
  const head = await page.locator(`.sc-colhead[data-col="${col}"]`).first().boundingBox();
  const cells = page.locator(`.sc-row[data-row="${row}"] .sc-cell`);
  const n = await cells.count();
  for (let i = 0; i < n; i++) {
    const box = await cells.nth(i).boundingBox();
    if (box !== null && head !== null && Math.abs(box.x - head.x) < 2) return cells.nth(i);
  }
  throw new Error(`cell ${row} ${column} is not rendered`);
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function header(page: Page, column: string): Promise<Locator> {
  return page.locator(`.sc-colhead[data-col="${await colIndex(page, column)}"]`).first();
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

test('§5.17 の 1 番: 1 行目から下へドラッグしてグリッドの下端を越え、500 行目で離すと 1〜500 行目が選択される', async ({ page }) => {
  test.setTimeout(120_000);
  // 1 万行 × 50 列の組み込みのサンプル（1,000 行 × 20 列より大きい）
  await page.goto('/?sample=large');
  await expect(page.locator('[data-testid=grid][data-table=big]')).toBeVisible({ timeout: 60_000 });
  const box = await page.locator('.sc-grid-scroller').boundingBox();
  if (box === null) throw new Error('no grid');
  const start = await cellPoint(page, 0, 2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, box.y + box.height - 30, { steps: 4 });
  const viewportHeight = page.viewportSize()?.height ?? 900;
  await page.mouse.move(start.x, Math.min(box.y + box.height + 40, viewportHeight - 2), { steps: 4 });
  // 自動スクロールで 500 行目がグリッドの下半分に来るまで待つ（FR-SEL-04）
  await page.waitForFunction(
    () => {
      const el = document.querySelector<HTMLElement>('.sc-grid-scroller');
      return el !== null && 40 + 499 * 21 - el.scrollTop <= el.clientHeight * 0.6;
    },
    null,
    { polling: 'raf', timeout: 90_000 },
  );
  // スクロールしながら範囲が伸びている
  expect((await selection(page)).range.bottom).toBeGreaterThan(300);
  // 表示領域の中に戻すと自動スクロールが止まる。その位置で 500 行目を指して離す
  await page.mouse.move(start.x, box.y + box.height / 2, { steps: 2 });
  const scrollTop = await page.locator('.sc-grid-scroller').evaluate((el) => el.scrollTop);
  const y = box.y + 40 + 499 * 21 - scrollTop + 10;
  expect(y).toBeGreaterThan(box.y + 40);
  expect(y).toBeLessThan(box.y + box.height - 10);
  await page.mouse.move(start.x, y, { steps: 2 });
  await page.mouse.up();
  const sel = await selection(page);
  expect(sel.kind).toBe('cells');
  expect(sel.range).toMatchObject({ top: 0, bottom: 499 });
});

test.describe('サンプルのプロジェクト', () => {
  test.beforeEach(async ({ page }) => {
    await openBasicSample(page);
  });

  test('§5.17 の 4 番: 1、2 の 2 セルを選んでフィルハンドルで下へ 3 セル分ドラッグすると 3、4、5 が入る', async ({ page }) => {
    // 行番号の右クリックメニューで、下に行を足して 5 行にする
    for (const row of [2, 3]) {
      await page.locator('.sc-rowhead').nth(row).click({ button: 'right' });
      await expect(page.getByTestId('context-menu')).toBeVisible();
      await page.getByTestId('menu-row.insertBelow').click();
    }
    await expect(page.locator('.sc-pane-frozen .sc-rowhead')).toHaveCount(5);
    const hp = await colIndex(page, 'hp');
    await clickCell(page, 0, hp);
    await page.keyboard.type('1');
    await page.keyboard.press('Enter');
    await page.keyboard.type('2');
    await page.keyboard.press('Enter');
    await clickCell(page, 0, hp);
    await page.keyboard.down('Shift');
    await clickCell(page, 1, hp);
    await page.keyboard.up('Shift');
    const handle = await center(page.getByTestId('fill-handle'));
    const target = await cellPoint(page, 4, hp);
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x, target.y, { steps: 6 });
    // 広げる先の枠を示す
    await expect(page.getByTestId('drag-fill')).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => cellText(page, 2, 'hp')).toBe('3');
    expect(await cellText(page, 3, 'hp')).toBe('4');
    expect(await cellText(page, 4, 'hp')).toBe('5');
    expect((await selection(page)).range).toMatchObject({ top: 0, bottom: 4, left: hp, right: hp });
    // 1 回の Ctrl+Z で戻る（FR-HIS-03）
    await page.keyboard.press('Control+z');
    await expect.poll(() => cellText(page, 2, 'hp')).toBe('650');
    expect(await cellText(page, 4, 'hp')).toBe('');
    expect(await cellText(page, 1, 'hp')).toBe('2');
  });

  test('フィルハンドル: 変換できなければ全体を取りやめ、失敗の一覧を出す', async ({ page }) => {
    const name = await colIndex(page, 'name');
    await clickCell(page, 0, name);
    const handle = await center(page.getByTestId('fill-handle'));
    const target = await cellPoint(page, 0, name + 1);
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(target.x + 30, handle.y - 5, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByTestId('message-items')).toContainText('勇者アルス');
    await page.getByTestId('message-dialog').getByRole('button').click();
    expect(await cellText(page, 0, 'rarity')).toBe('SSR');
  });

  test('範囲の枠をドラッグすると、値・セル色・メモを移す（FR-CLP-06）', async ({ page }) => {
    const hp = await colIndex(page, 'hp');
    await clickCell(page, 1, hp);
    const grip = page.locator('[data-range-border]').first();
    const from = await center(grip);
    const to = await cellPoint(page, 2, hp);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await expect(page.getByTestId('drag-move')).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => cellText(page, 2, 'hp')).toBe('800');
    expect(await cellText(page, 1, 'hp')).toBe('');
    await expect((await cellAt(page, 2, 'hp')).locator('.sc-mark-note')).toHaveCount(1);
    await expect(await cellAt(page, 2, 'hp')).toHaveCSS('background-color', 'rgb(244, 204, 204)');
    expect((await selection(page)).range).toMatchObject({ top: 2, bottom: 2, left: hp, right: hp });
    await page.keyboard.press('Control+z');
    await expect.poll(() => cellText(page, 1, 'hp')).toBe('800');
    expect(await cellText(page, 2, 'hp')).toBe('650');
  });

  test('右クリックメニュー: 選択範囲の外を右クリックすると先にそこを選ぶ。Shift+F10 でも開く（FR-CTX-01、NFR-40）', async ({ page }) => {
    await clickCell(page, 0, await colIndex(page, 'name'));
    const memo = await colIndex(page, 'memo');
    const p = await cellPoint(page, 0, memo);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    expect((await selection(page)).column).toBe('memo');
    const menu = page.getByTestId('context-menu');
    for (const id of ['edit.cut', 'edit.copy', 'edit.paste', 'edit.pasteValues', 'row.insertAbove', 'row.insertBelow', 'row.delete', 'cell.color', 'cell.comment', 'edit.clear', 'cell.gotoRef']) {
      await expect(menu.getByTestId(`menu-${id}`).first()).toBeVisible();
    }
    // 参照列でないので「参照先へ移動」は使えない
    await expect(menu.getByTestId('menu-cell.gotoRef')).toHaveAttribute('aria-disabled', 'true');
    await menu.getByTestId('menu-edit.clear').click();
    await expect(menu).toHaveCount(0);
    await expect.poll(() => cellText(page, 0, 'memo')).toBe('');

    // キーだけで開いて選ぶ
    await clickCell(page, 1, memo);
    await page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId('menu-edit.clear')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await page.keyboard.press('ContextMenu');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');

    // 行番号: 複製（FR-ROW-03）
    await page.locator('.sc-rowhead').nth(0).click({ button: 'right' });
    await expect(menu.getByTestId('menu-row.duplicate')).toBeVisible();
    await menu.getByTestId('menu-row.duplicate').click();
    await expect(page.locator('.sc-pane-frozen .sc-rowhead')).toHaveCount(4);
    expect(await cellText(page, 1, 'name')).toBe('勇者アルス');
    expect(await cellText(page, 1, 'id')).toBe('4');

    // 列ヘッダー: 非表示（FR-COL-08）。隠れた列の印を押すと表示する
    await (await header(page, 'hp')).click({ button: 'right' });
    for (const id of ['column.settings', 'column.insertLeft', 'column.insertRight', 'column.delete', 'column.freeze', 'column.hide', 'sort.asc', 'sort.desc', 'filter.open']) {
      await expect(menu.getByTestId(`menu-${id}`)).toBeVisible();
    }
    await menu.getByTestId('menu-column.hide').click();
    await expect(page.locator('.sc-colhead-name', { hasText: /^hp$/ })).toHaveCount(0);
    await page.locator('.sc-hidden-mark').first().click();
    await expect(page.locator('.sc-colhead-name', { hasText: /^hp$/ })).toHaveCount(1);
  });

  test('列の固定・固定の解除（FR-COL-07）', async ({ page }) => {
    await expect(page.locator('.sc-head-frozen .sc-colhead')).toHaveCount(2);
    await (await header(page, 'rarity')).click({ button: 'right' });
    await page.getByTestId('menu-column.freeze').click();
    await expect(page.locator('.sc-head-frozen .sc-colhead')).toHaveCount(4);
    await page.keyboard.press('Control+z');
    await expect(page.locator('.sc-head-frozen .sc-colhead')).toHaveCount(2);
    await (await header(page, 'rarity')).click({ button: 'right' });
    await page.getByTestId('menu-column.unfreeze').click();
    await expect(page.locator('.sc-head-frozen .sc-colhead')).toHaveCount(0);
  });

  test('並べ替え: 表示だけの昇順・降順・解除と、並べ替えの適用（FR-SRT-01、02）', async ({ page }) => {
    await (await header(page, 'hp')).click({ button: 'right' });
    await page.getByTestId('menu-sort.asc').click();
    await expect.poll(() => cellText(page, 0, 'hp')).toBe('650');
    expect(await cellText(page, 2, 'hp')).toBe('1200');
    await expect(page.getByTestId('sort-mark-hp')).toHaveText('↑');
    // ファイルには保存しない（未保存の印が付かない）
    await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toHaveCount(0);
    await page.getByTestId('menubar-data').click();
    await page.getByTestId('menu-sort.apply').click();
    await expect(page.getByTestId('sort-mark-hp')).toHaveCount(0);
    expect(await cellText(page, 0, 'hp')).toBe('650');
    await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect.poll(() => cellText(page, 0, 'hp')).toBe('1200');
    // 降順と解除
    await (await header(page, 'hp')).click({ button: 'right' });
    await page.getByTestId('menu-sort.desc').click();
    await expect(page.getByTestId('sort-mark-hp')).toHaveText('↓');
    await page.getByTestId('menubar-data').click();
    await page.getByTestId('menu-sort.clear').click();
    await expect(page.getByTestId('sort-mark-hp')).toHaveCount(0);
    expect(await cellText(page, 1, 'hp')).toBe('800');
  });

  test('フィルタ: 値の一覧と条件で絞り込み、表示中の行だけを消す（FR-SRT-03、04）', async ({ page }) => {
    await (await header(page, 'rarity')).hover();
    await page.getByTestId('filter-button-rarity').click();
    const popup = page.getByTestId('filter-popup');
    await expect(popup).toBeVisible();
    const values = popup.getByTestId('filter-values');
    await expect(values).toContainText('SSR');
    await values.getByText('SR', { exact: true }).click();
    await popup.getByTestId('filter-ok').click();
    await expect(popup).toHaveCount(0);
    await expect(page.locator('.sc-pane-frozen .sc-rowhead')).toHaveCount(2);
    expect(await cellText(page, 0, 'name')).toBe('勇者アルス');
    expect(await cellText(page, 1, 'name')).toBe('盗賊カイ');
    await expect(page.getByTestId('filter-button-rarity')).toHaveClass(/active/);

    // 表示中の 2 行の hp を消しても、隠れた行（魔法使いリナ）は変わらない
    const hp = await colIndex(page, 'hp');
    await clickCell(page, 0, hp);
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Delete');
    await expect.poll(() => cellText(page, 1, 'hp')).toBe('');

    // 条件（範囲）で絞り込む
    await page.getByTestId('menubar-data').click();
    await page.getByTestId('menu-filter.clear').click();
    await expect(page.locator('.sc-pane-frozen .sc-rowhead')).toHaveCount(3);
    expect(await cellText(page, 1, 'hp')).toBe('800');
    await (await header(page, 'hp')).click({ button: 'right' });
    await page.getByTestId('menu-filter.open').click();
    await popup.getByTestId('filter-tab-condition').click();
    await popup.getByTestId('filter-condition-type').selectOption('range');
    await popup.getByTestId('filter-condition-min').fill('700');
    await page.keyboard.press('Enter');
    await expect(page.locator('.sc-pane-frozen .sc-rowhead')).toHaveCount(1);
    expect(await cellText(page, 0, 'name')).toBe('魔法使いリナ');
  });

  test('行番号・列ヘッダーをドラッグして並べ替える（FR-ROW-04、FR-COL-05）', async ({ page }) => {
    const rowHead = page.locator('.sc-rowhead');
    await rowHead.nth(2).click();
    const from = await center(rowHead.nth(2));
    const top = await rowHead.nth(0).boundingBox();
    if (top === null) throw new Error('no row header');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, top.y + 3, { steps: 6 });
    await expect(page.getByTestId('drop-line').first()).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => cellText(page, 0, 'name')).toBe('盗賊カイ');
    expect(await cellText(page, 1, 'name')).toBe('勇者アルス');
    expect((await selection(page)).kind).toBe('rows');
    await page.keyboard.press('Control+z');
    await expect.poll(() => cellText(page, 0, 'name')).toBe('勇者アルス');

    // 列: hp を name の前へ
    const hpHead = await header(page, 'hp');
    await hpHead.click();
    const h = await center(hpHead);
    const nameBox = await (await header(page, 'name')).boundingBox();
    if (nameBox === null) throw new Error('no header');
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(nameBox.x + 8, h.y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await colIndex(page, 'hp')) < (await colIndex(page, 'name'))).toBe(true);
    // 動かさずに離すと、その列だけを選ぶ
    await (await header(page, 'name')).click();
    expect((await selection(page)).kind).toBe('cols');
  });

  test('フィルタ中に行をドラッグしても、元に戻しても、表示中の行はファイル上の順に並ぶ', async ({ page }) => {
    await (await header(page, 'rarity')).hover();
    await page.getByTestId('filter-button-rarity').click();
    await page.getByTestId('filter-values').getByText('SR', { exact: true }).click();
    await page.getByTestId('filter-ok').click();
    await expect(page.locator('.sc-pane-frozen .sc-rowhead')).toHaveCount(2);
    const rowHead = page.locator('.sc-rowhead');
    await rowHead.nth(1).click();
    const from = await center(rowHead.nth(1));
    const top = await rowHead.nth(0).boundingBox();
    if (top === null) throw new Error('no row header');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, top.y + 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => cellText(page, 0, 'name')).toBe('盗賊カイ');
    expect(await cellText(page, 1, 'name')).toBe('勇者アルス');
    await page.keyboard.press('Control+z');
    await expect.poll(() => cellText(page, 0, 'name')).toBe('勇者アルス');
    expect(await cellText(page, 1, 'name')).toBe('盗賊カイ');
    // キーでも移せる（編集 > 行を下へ移動）
    await clickCell(page, 0, await colIndex(page, 'name'));
    await page.getByTestId('menubar-edit').click();
    await page.getByTestId('menu-row.moveDown').click();
    await expect.poll(() => cellText(page, 1, 'name')).toBe('勇者アルス');
  });

  test('フィルハンドルをダブルクリックすると、隣の列にデータが続く行まで下へフィルする', async ({ page }) => {
    const hp = await colIndex(page, 'hp');
    await clickCell(page, 0, hp);
    const handle = await center(page.getByTestId('fill-handle'));
    await page.mouse.dblclick(handle.x, handle.y);
    await expect.poll(() => cellText(page, 2, 'hp')).toBe('1200');
    expect(await cellText(page, 1, 'hp')).toBe('1200');
    await expect(page.getByTestId('cell-input')).not.toHaveClass(/editing/);
  });

  test('セル色: ツールバーの一覧から範囲にまとめて当て、選択中でも見分けられる（FR-ANN-01、03）', async ({ page }) => {
    const name = await colIndex(page, 'name');
    await clickCell(page, 0, name);
    await page.keyboard.press('Shift+ArrowDown');
    await page.getByTestId('toolbar-cell.color').click();
    const palette = page.getByTestId('cell-color-palette');
    await expect(palette).toBeVisible();
    await expect(palette).toContainText('緑');
    await palette.getByTestId('cell-color-green').click();
    await expect(palette).toHaveCount(0);
    await expect(await cellAt(page, 0, 'name')).toHaveCSS('background-color', 'rgb(217, 234, 211)');
    await expect(await cellAt(page, 1, 'name')).toHaveCSS('background-color', 'rgb(217, 234, 211)');
    // 選択範囲の塗りは半透明（下のセル色が見える）
    const fill = await page.locator('.sc-sel-range').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fill).toMatch(/^rgba\(.*, 0\.\d+\)$/);
    // 解除（なし）
    await page.getByTestId('toolbar-cell.color').click();
    await palette.getByTestId('cell-color-none').click();
    await expect(await cellAt(page, 0, 'name')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  });

  test('メモ: Shift+F2 で書き、マウスを重ねると内容を出す（FR-ANN-02）', async ({ page }) => {
    const rarity = await colIndex(page, 'rarity');
    await clickCell(page, 0, rarity);
    await page.keyboard.press('Shift+F2');
    const editor = page.getByTestId('note-editor');
    await expect(editor).toBeVisible();
    await expect(page.getByTestId('note-input')).toBeFocused();
    await page.keyboard.type('限定キャラ');
    await page.getByTestId('note-save').click();
    await expect(editor).toHaveCount(0);
    const target = await cellAt(page, 0, 'rarity');
    await expect(target.locator('.sc-mark-note')).toHaveCount(1);
    await page.mouse.move(0, 0);
    await target.hover();
    await expect(page.getByTestId('note-popup')).toHaveText('限定キャラ');
    // 編集して削除する
    await page.keyboard.press('Shift+F2');
    await expect(page.getByTestId('note-input')).toHaveValue('限定キャラ');
    await page.getByTestId('note-delete').click();
    await expect(target.locator('.sc-mark-note')).toHaveCount(0);
    // 元に戻すとメモが戻る
    await page.keyboard.press('Control+z');
    await expect((await cellAt(page, 0, 'rarity')).locator('.sc-mark-note')).toHaveCount(1);
  });

  test('参照: 参照先の名前を添え、Ctrl+クリックと右クリックで参照先へ移る（FR-ANN-05、FR-REF-01）', async ({ page }) => {
    expect(await cellText(page, 1, 'skill_ids')).toContain('ファイア, ヒール');
    await page.getByTestId('sheet-tab-stage').click();
    await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'stage');
    expect(await cellText(page, 0, 'boss_id')).toContain('盗賊カイ');
    const boss = await colIndex(page, 'boss_id');
    const p = await cellPoint(page, 0, boss);
    await page.keyboard.down('Control');
    await page.mouse.click(p.x, p.y);
    await page.keyboard.up('Control');
    await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'character');
    expect(await selection(page)).toMatchObject({ table: 'character', column: 'id', id: 3 });

    await page.getByTestId('sheet-tab-stage').click();
    const q = await cellPoint(page, 1, boss);
    await page.mouse.click(q.x, q.y, { button: 'right' });
    await page.getByTestId('menu-cell.gotoRef').click();
    await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'character');
    expect(await selection(page)).toMatchObject({ table: 'character', column: 'id', id: 2 });
  });
});
