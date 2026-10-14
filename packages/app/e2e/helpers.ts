// 画面テストの共通の処理
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** 組み込みのサンプルを開く（開始画面のボタンから） */
export async function openBasicSample(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('open-sample').click();
  await expect(page.getByTestId('grid')).toBeVisible();
}

/** 表示上の (row, col) のセルの中央の座標（列ヘッダーと行番号の位置から求める） */
export async function cellPoint(page: Page, row: number, col: number): Promise<{ x: number; y: number }> {
  const head = await page.locator(`.sc-colhead[data-col="${col}"]`).first().boundingBox();
  const rowHead = await page.locator('.sc-rowhead').nth(row).boundingBox();
  if (head === null || rowHead === null) throw new Error(`cell ${row},${col} is not visible`);
  // 列挙型のセルの右端のプルダウンの印を避けて、少し左を押す
  return { x: head.x + head.width / 2 - 10, y: rowHead.y + rowHead.height / 2 };
}

export async function clickCell(page: Page, row: number, col: number): Promise<void> {
  const p = await cellPoint(page, row, col);
  await page.mouse.click(p.x, p.y);
}

/** 表示上の列の番号（列名から） */
export async function colIndex(page: Page, name: string): Promise<number> {
  const heads = page.locator('.sc-colhead');
  const count = await heads.count();
  for (let i = 0; i < count; i++) {
    const head = heads.nth(i);
    if ((await head.locator('.sc-colhead-name').textContent()) === name) return Number(await head.getAttribute('data-col'));
  }
  throw new Error(`column ${name} not found`);
}

/** 表示上の (row, col) のセルの要素 */
export function cell(page: Page, row: number, col: number, frozen = false): Locator {
  const pane = frozen ? '.sc-pane-frozen > .sc-row' : '.sc-body > .sc-row';
  return page.locator(`${pane}[data-row="${row}"] .sc-cell`).nth(col);
}

/** セルの位置の表示（テーブル / 列名 / 主キー） */
export function nameBox(page: Page): Locator {
  return page.getByTestId('name-box');
}

/** 位置の表示の 1 セルの文字（表示上の行と列名から、数式バーを使わずにグリッドの表示を読む） */
export async function cellText(page: Page, row: number, column: string): Promise<string> {
  const col = await colIndex(page, column);
  const frozenCount = await page.locator('.sc-head-frozen .sc-colhead').count();
  const cells = col < frozenCount ? page.locator(`.sc-pane-frozen > .sc-row[data-row="${row}"] .sc-cell`) : page.locator(`.sc-body > .sc-row[data-row="${row}"] .sc-cell`);
  // 描かれているセルの中から、列の左端の位置が一致するものを探す
  const head = await page.locator(`.sc-colhead[data-col="${col}"]`).first().boundingBox();
  const n = await cells.count();
  for (let i = 0; i < n; i++) {
    const box = await cells.nth(i).boundingBox();
    if (box !== null && head !== null && Math.abs(box.x - head.x) < 2) return (await cells.nth(i).textContent()) ?? '';
  }
  throw new Error(`cell ${row} ${column} is not rendered`);
}
