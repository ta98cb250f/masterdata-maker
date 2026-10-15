// 未保存のデータを捨てない（NFR-17）: プロジェクトを閉じる・別のフォルダを開く・サンプルを開くときに、未保存の変更があれば確かめる
import { expect, test } from '@playwright/test';
import { cellText, clickCell, colIndex, openBasicSample } from './helpers';

for (const command of ['file.open', 'file.openSample', 'file.close']) {
  test(`未保存の変更があれば、${command} の前に確かめる。キャンセルすれば変更は残る`, async ({ page }) => {
    await openBasicSample(page);
    await clickCell(page, 0, await colIndex(page, 'hp'));
    await page.keyboard.type('4321');
    await page.keyboard.press('Enter');
    await page.getByTestId('menubar-file').dispatchEvent('mousedown');
    await page.getByTestId(`menu-${command}`).click();
    const dialog = page.getByTestId('confirm-dialog');
    await expect(dialog).toContainText('保存していない変更は失われます');
    await dialog.getByRole('button', { name: 'キャンセル' }).click();
    await expect(dialog).toHaveCount(0);
    expect(await cellText(page, 0, 'hp')).toBe('4321');
    await expect(page.getByTestId('project-modified')).toBeVisible();
  });
}
