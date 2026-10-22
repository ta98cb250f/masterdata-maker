// 検査の Web Worker 化（FR-VAL-09〜11、NFR-10、NFR-12）: 検査が Worker で動き、編集から 300 ミリ秒以内に枠とシートタブの件数に反映される。
// 1 万行 × 50 列（?sample=large）で、1 セルの編集の後もメインスレッドが 100 ミリ秒を超えて止まらない。測った値は標準出力に出す
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { clickCell, colIndex, openBasicSample } from './helpers';

interface WorkerStats {
  mode: 'worker' | 'main';
  jobs: number;
  timeouts: number;
  restarts: number;
  lastInitMs: number;
}

function workerStats(page: Page): Promise<WorkerStats | null> {
  return page.evaluate(() => (globalThis as unknown as { masterdataMakerWorker: { stats(): WorkerStats | null } }).masterdataMakerWorker.stats());
}

async function waitValidated(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const s = (globalThis as unknown as { masterdataMaker: { getState(): { validation: { version: number; running: boolean } } } }).masterdataMaker.getState();
    return s.validation.version > 0 && !s.validation.running;
  });
}

interface EditMeasure {
  /** 確定から、枠とシートタブの件数に出るまで（ミリ秒） */
  reflectMs: number;
  /** その間の最も長いタスク（Long Tasks API。50 ミリ秒未満は数えられないので 0） */
  maxLongTaskMs: number;
  longTasks: number;
  /** その間のフレームの間隔の最大（ミリ秒） */
  maxFrameGapMs: number;
}

/**
 * 選択中のセルに text を入力して確定し、テーブル table のエラーの件数が errors になって画面に出るまでを測る。
 * 確定から結果が出るまでのメインスレッドの止まり（長いタスク・フレームの間隔）も測る
 */
function editAndMeasure(page: Page, table: string, text: string, errors: number): Promise<EditMeasure> {
  return page.evaluate(
    async ({ table, text, errors }) => {
      const input = document.querySelector<HTMLTextAreaElement>('[data-testid=cell-input]') as HTMLTextAreaElement;
      const longTasks: number[] = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      });
      observer.observe({ type: 'longtask', buffered: false });
      let maxGap = 0;
      let last = performance.now();
      let watching = true;
      const frame = (now: number) => {
        maxGap = Math.max(maxGap, now - last);
        last = now;
        if (watching) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      await new Promise((r) => setTimeout(r, 50));
      const shown = () => {
        const badge = document.querySelector(`[data-testid="sheet-tab-${table}"] [data-testid=tab-errors]`);
        // 確定したセル（0 行目）の赤枠と、シートタブの件数
        return (badge?.textContent ?? '0') === String(errors) && document.querySelector('.sc-row[data-row="0"] .sc-issue-error') !== null;
      };
      input.focus();
      const started = performance.now();
      input.value = text;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      let reflectMs = -1;
      await new Promise<void>((resolve) => {
        const poll = () => {
          if (shown()) {
            reflectMs = performance.now() - started;
            resolve();
          } else if (performance.now() - started > 10_000) resolve();
          else requestAnimationFrame(poll);
        };
        poll();
      });
      // 後から届く長いタスクの記録を待つ
      await new Promise((r) => setTimeout(r, 100));
      watching = false;
      observer.disconnect();
      return { reflectMs, maxLongTaskMs: Math.max(0, ...longTasks), longTasks: longTasks.length, maxFrameGapMs: maxGap };
    },
    { table, text, errors },
  );
}

function errorCount(page: Page, table: string): Promise<number> {
  return page.evaluate(
    (name) =>
      (globalThis as unknown as { masterdataMaker: { getState(): { validation: { tables: Map<string, { errors: number }> } } } }).masterdataMaker
        .getState()
        .validation.tables.get(name)?.errors ?? 0,
    table,
  );
}

test('検査は Worker で動き、編集から 300 ミリ秒以内に枠とシートタブの件数に反映される（FR-VAL-09）', async ({ page }) => {
  await openBasicSample(page);
  await waitValidated(page);
  const stats = await workerStats(page);
  expect(stats?.mode).toBe('worker');
  expect(stats?.jobs).toBeGreaterThan(0);
  const before = await errorCount(page, 'character');
  await clickCell(page, 0, await colIndex(page, 'hp'));
  const results: number[] = [];
  // hp: 0 は min: 1 に反する（エラー）。1 に戻すと消える
  for (let i = 0; i < 5; i++) {
    const m = await editAndMeasure(page, 'character', '0', before + 1);
    results.push(m.reflectMs);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.type('1');
    await page.keyboard.press('Enter');
    await expect.poll(() => errorCount(page, 'character')).toBe(before);
    await page.keyboard.press('ArrowUp');
  }
  console.log(`[perf] basic sample: edit -> border and tab count: ${results.map((x) => x.toFixed(0)).join(', ')} ms`);
  for (const ms of results) {
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(300);
  }
  expect((await workerStats(page))?.jobs).toBeGreaterThan(stats?.jobs ?? 0);
});

test('1 万行 × 50 列: 1 セルの編集の後もメインスレッドは 100 ミリ秒を超えて止まらない（NFR-10、NFR-12）', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?sample=large');
  await expect(page.locator('[data-testid=grid][data-table=big]')).toBeVisible({ timeout: 60_000 });
  await waitValidated(page);
  const stats = await workerStats(page);
  expect(stats?.mode).toBe('worker');
  console.log(`[perf] large sample: snapshot posted to the worker on open (main thread): ${stats?.lastInitMs.toFixed(0)} ms`);
  await clickCell(page, 0, await colIndex(page, 'hp'));
  const measures: EditMeasure[] = [];
  for (let i = 0; i < 5; i++) {
    const before = await errorCount(page, 'big');
    const m = await editAndMeasure(page, 'big', '0', before + 1);
    measures.push(m);
    // 元に戻す（エラーを消す）
    await page.keyboard.press('Control+z');
    await expect.poll(() => errorCount(page, 'big'), { timeout: 10_000 }).toBe(before);
  }
  for (const [i, m] of measures.entries()) {
    console.log(
      `[perf] large sample edit #${i + 1}: reflect ${m.reflectMs.toFixed(0)} ms, longest main-thread task ${m.maxLongTaskMs.toFixed(0)} ms (${m.longTasks} long tasks), longest frame gap ${m.maxFrameGapMs.toFixed(0)} ms`,
    );
  }
  for (const m of measures) {
    expect(m.reflectMs).toBeGreaterThan(0);
    // 反映までの時間は環境で揺れるので、ここでは測った値を出すだけにする（大きくずれたときだけ失敗させる）
    expect(m.reflectMs).toBeLessThan(1000);
    expect(m.maxLongTaskMs).toBeLessThan(100);
  }
});

test('時間制限を過ぎたら Worker を作り直し、時間切れを示す。その後も検査できる（FR-VAL-10）', async ({ page }) => {
  test.setTimeout(180_000);
  // 検査に 100 ミリ秒以上かかる 1 万行のテーブルで、時間制限を 1 ミリ秒にする
  await page.goto('/?sample=large');
  await expect(page.locator('[data-testid=grid][data-table=big]')).toBeVisible({ timeout: 60_000 });
  await waitValidated(page);
  await page.evaluate(() => (globalThis as unknown as { masterdataMakerWorker: { setTimeLimit(ms: number): void } }).masterdataMakerWorker.setTimeLimit(1));
  await clickCell(page, 0, await colIndex(page, 'hp'));
  await page.keyboard.type('0');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('status')).toContainText('秒以内に終わらなかったため中断しました（時間切れ）');
  const stats = await workerStats(page);
  expect(stats?.timeouts).toBeGreaterThan(0);
  expect(stats?.restarts).toBeGreaterThan(0);
  expect(stats?.mode).toBe('worker');
  // 時間制限を戻すと、作り直した Worker で検査できる（時間切れの間の変更も検査する）
  await page.evaluate(() => (globalThis as unknown as { masterdataMakerWorker: { setTimeLimit(ms: number): void } }).masterdataMakerWorker.setTimeLimit(5000));
  const before = await errorCount(page, 'big');
  await page.keyboard.type('-1');
  await page.keyboard.press('Enter');
  await expect.poll(() => errorCount(page, 'big'), { timeout: 10_000 }).toBe(before + 2);
  await expect(page.locator('.sc-row[data-row="0"] .sc-issue-error')).not.toHaveCount(0);
});

test('Worker が使えない環境では、メインスレッドで検査する', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { Worker?: unknown }).Worker;
  });
  await openBasicSample(page);
  await waitValidated(page);
  expect((await workerStats(page))?.mode).toBe('main');
  await clickCell(page, 0, await colIndex(page, 'hp'));
  await page.keyboard.type('0');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-errors')).toHaveText('1');
});
