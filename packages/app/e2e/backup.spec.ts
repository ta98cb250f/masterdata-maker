// 未保存の変更の退避と復元（FR-FIO-06）: 変更してから、保存せずにページを開き直すと復元を提案される
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { cellText, clickCell, colIndex } from './helpers';
import { openOpfsProject } from './opfs';

/** 退避の書き込み（kind: set / del）が終わるまで待つ */
async function waitBackup(page: Page, kind: 'set' | 'del'): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const manager = (globalThis as unknown as { masterdataMakerBackup?: { idle(): Promise<void>; lastWrite: { kind: string } | null } }).masterdataMakerBackup;
        if (manager === undefined) return null;
        await manager.idle();
        return manager.lastWrite?.kind ?? null;
      }),
    )
    .toBe(kind);
}

async function editHp(page: Page, row: number, text: string): Promise<void> {
  await clickCell(page, row, await colIndex(page, 'hp'));
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test('サンプル: 保存せずにページを開き直すと復元を提案し、復元すると保存していない変更として読み込む', async ({ page }) => {
  await page.goto('/?sample=basic');
  await expect(page.getByTestId('grid')).toBeVisible();
  await editHp(page, 0, '4321');
  await waitBackup(page, 'set');

  // 保存せずに開き直す（異常終了の代わり）
  await page.goto('/?sample=basic');
  const dialog = page.getByTestId('backup-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('backup-items')).toContainText('tables/character.yaml');
  await dialog.getByTestId('backup-restore').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('status')).toHaveText('保存していない変更を復元しました（1 件）');
  expect(await cellText(page, 0, 'hp')).toBe('4321');
  await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toBeVisible();
  // 復元は 1 回の操作として元に戻せる
  await page.keyboard.press('Control+z');
  expect(await cellText(page, 0, 'hp')).toBe('1200');
  await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toHaveCount(0);
});

test('「復元しない」を選ぶと退避を消し、次に開いても提案しない。プロジェクトを閉じたときも消す', async ({ page }) => {
  await page.goto('/?sample=basic');
  await expect(page.getByTestId('grid')).toBeVisible();
  await editHp(page, 0, '4321');
  await waitBackup(page, 'set');
  await page.goto('/?sample=basic');
  await page.getByTestId('backup-discard').click();
  await waitBackup(page, 'del');
  expect(await cellText(page, 0, 'hp')).toBe('1200');
  await page.goto('/?sample=basic');
  await expect(page.getByTestId('grid')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('backup-dialog')).toHaveCount(0);

  // 変更してからプロジェクトを閉じる（変更を捨てることを確かめる）と、退避も消える
  await editHp(page, 0, '777');
  await waitBackup(page, 'set');
  await page.getByTestId('menubar-file').dispatchEvent('mousedown');
  await page.getByTestId('menu-file.close').click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: '変更を破棄して続ける' }).click();
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await waitBackup(page, 'del');
  await page.getByTestId('open-sample').click();
  await expect(page.getByTestId('grid')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('backup-dialog')).toHaveCount(0);
});

test('直接保存方式: 前回のフォルダを開き直すと復元を提案する。保存すると退避を消す', async ({ page }) => {
  await openOpfsProject(page);
  await editHp(page, 0, '4321');
  await waitBackup(page, 'set');
  await page.reload();
  await page.getByTestId('open-last').click();
  const dialog = page.getByTestId('backup-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('backup-restore').click();
  expect(await cellText(page, 0, 'hp')).toBe('4321');
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('status')).toHaveText('保存しました（1 ファイル）');
  await waitBackup(page, 'del');
  await page.reload();
  await page.getByTestId('open-last').click();
  await expect(page.getByTestId('grid')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('backup-dialog')).toHaveCount(0);
  expect(await cellText(page, 0, 'hp')).toBe('4321');
});

test('1 万行 × 50 列: 退避してもメインスレッドは 100 ミリ秒を超えて止まらない（NFR-10）', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?sample=large');
  await expect(page.locator('[data-testid=grid][data-table=big]')).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => {
    const s = (globalThis as unknown as { masterdataMaker: { getState(): { validation: { version: number; running: boolean } } } }).masterdataMaker.getState();
    return s.validation.version > 0 && !s.validation.running;
  });
  await clickCell(page, 0, await colIndex(page, 'hp'));
  const result = await page.evaluate(async () => {
    const longTasks: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    observer.observe({ type: 'longtask', buffered: false });
    const manager = (globalThis as unknown as { masterdataMakerBackup: { idle(): Promise<void>; lastWrite: { at: number; kind: string } | null } }).masterdataMakerBackup;
    const input = document.querySelector<HTMLTextAreaElement>('[data-testid=cell-input]') as HTMLTextAreaElement;
    input.focus();
    const started = Date.now();
    input.value = '123';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '123', inputType: 'insertText' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    while ((manager.lastWrite?.at ?? 0) < started && Date.now() - started < 20_000) {
      await new Promise((r) => setTimeout(r, 50));
      await manager.idle();
    }
    const writtenMs = Date.now() - started;
    await new Promise((r) => setTimeout(r, 200));
    observer.disconnect();
    return { writtenMs, kind: manager.lastWrite?.kind, maxLongTaskMs: Math.max(0, ...longTasks), longTasks: longTasks.length };
  });
  console.log(
    `[perf] large sample backup: written ${result.writtenMs} ms after the edit, longest main-thread task ${result.maxLongTaskMs.toFixed(0)} ms (${result.longTasks} long tasks)`,
  );
  expect(result.kind).toBe('set');
  expect(result.maxLongTaskMs).toBeLessThan(100);
});
