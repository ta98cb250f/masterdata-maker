// 言語の切り替え（FR-ETC-02）: ヘルプのメニューで日本語／English を切り替え、選んだ言語をブラウザに覚える
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const JAPANESE = /[぀-ヿ一-鿿]/u;

async function chooseLocale(page: Page, locale: 'ja' | 'en'): Promise<void> {
  await page.getByTestId('menubar-help').dispatchEvent('mousedown');
  await page.getByTestId(`menu-help.locale.${locale}`).click();
}

/** メニューバーのすべてのメニューの項目の文字 */
async function menuTexts(page: Page): Promise<string[]> {
  const texts: string[] = [];
  for (const menu of ['file', 'edit', 'view', 'insert', 'data', 'help']) {
    await page.getByTestId(`menubar-${menu}`).dispatchEvent('mousedown');
    const list = page.getByTestId(`menu-${menu}`);
    await expect(list).toBeVisible();
    texts.push(`${menu}: ${await list.innerText()}`);
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
  }
  return texts;
}

test('English を選ぶと画面の文言が英語になり、開き直しても英語のまま。日本語に戻せる', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('open-sample')).toHaveText('サンプルを開く');
  await chooseLocale(page, 'en');
  await expect(page.getByTestId('open-sample')).toHaveText('Open sample');
  await expect(page.getByTestId('menubar-file')).toHaveText('File');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  expect(await page.getByTestId('start-screen').innerText()).not.toMatch(JAPANESE);

  await page.reload();
  await expect(page.getByTestId('open-sample')).toHaveText('Open sample');
  await page.getByTestId('open-sample').click();
  await expect(page.getByTestId('grid')).toBeVisible();
  // メニューの項目（他の機能の操作を含む）に、英語の文言の抜け（日本語のまま）が無い。言語の名前の項目は除く
  for (const text of await menuTexts(page)) {
    const withoutLanguageNames = text.replace('日本語 (Japanese)', '').replace('English (英語)', '');
    expect(withoutLanguageNames, text).not.toMatch(JAPANESE);
  }
  await expect(page.getByTestId('menubar-help')).toHaveText('Help');

  await chooseLocale(page, 'ja');
  await expect(page.getByTestId('menubar-file')).toHaveText('ファイル');
  await page.reload();
  await expect(page.getByTestId('open-sample')).toHaveText('サンプルを開く');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('ja');
});

test('localStorage が使えなくても切り替えられる（覚えないだけ）', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
  });
  await page.goto('/');
  await chooseLocale(page, 'en');
  await expect(page.getByTestId('open-sample')).toHaveText('Open sample');
  await page.reload();
  await expect(page.getByTestId('open-sample')).toHaveText('サンプルを開く');
});
