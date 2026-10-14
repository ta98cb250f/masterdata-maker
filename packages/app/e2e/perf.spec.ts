// 性能の確認（NFR-10）: 1 万行 × 50 列のテーブル（?sample=large）で、セルの移動・入力への反応とスクロールを測る。
// 測った値は標準出力に出す（環境で揺れるので、判定は要件の 100 ミリ秒に対して余裕を持たせる）
import { expect, test } from '@playwright/test';

interface Stats {
  median: number;
  p90: number;
  max: number;
  count: number;
}

test('1 万行 × 50 列: 矢印キーの移動・入力の確定・スクロール', async ({ page }) => {
  test.setTimeout(120_000);
  const started = Date.now();
  await page.goto('/?sample=large');
  await expect(page.locator('[data-testid=grid][data-table=big]')).toBeVisible({ timeout: 60_000 });
  const openMs = Date.now() - started;
  await expect(page.locator('.sc-rowhead').first()).toBeVisible();
  // 開いた直後の全体の検査を待つ
  await page.waitForFunction(() => {
    const s = (globalThis as unknown as { sheetcraft: { getState(): { validation: { version: number; running: boolean } } } }).sheetcraft.getState();
    return s.validation.version > 0 && !s.validation.running;
  });

  const results = await page.evaluate(async () => {
    type Store = {
      getState(): { validation: { version: number }; editing: unknown };
      flushValidation(): Promise<void>;
      scheduleValidation(changed: string[]): void;
    };
    const store = (globalThis as unknown as { sheetcraft: Store }).sheetcraft;
    const input = document.querySelector<HTMLTextAreaElement>('[data-testid=cell-input]') as HTMLTextAreaElement;
    const scroller = document.querySelector<HTMLElement>('.sc-grid-scroller') as HTMLElement;
    // 描画が終わって次のフレームが始まるまで
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const stats = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return { median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1], count: s.length };
    };
    const key = (k: string, extra: KeyboardEventInit = {}) =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true, ...extra }));
    input.focus();

    // 1. 矢印キーの移動（下へ 60 回・右へ 30 回。表示領域の外に出てスクロールする分を含む）
    const arrows: number[] = [];
    for (let i = 0; i < 60; i++) {
      const t = performance.now();
      key('ArrowDown');
      await frame();
      arrows.push(performance.now() - t);
    }
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      key('ArrowRight');
      await frame();
      arrows.push(performance.now() - t);
    }
    // 2. Ctrl+End（末尾の行へ）と Ctrl+Home
    const jumps: number[] = [];
    for (const k of ['End', 'Home', 'End', 'Home']) {
      const t = performance.now();
      key(k, { ctrlKey: true });
      await frame();
      jumps.push(performance.now() - t);
    }
    // 3. 入力の確定（文字を入れて Enter）。検査は 60 ミリ秒後に始まるので、確定の描画には含まれない
    const inputs: number[] = [];
    const validations: number[] = [];
    key('ArrowRight');
    key('ArrowRight');
    key('ArrowRight');
    await frame();
    for (let i = 0; i < 10; i++) {
      const t = performance.now();
      input.value = String(100 + i);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(100 + i), inputType: 'insertText' }));
      key('Enter');
      await frame();
      inputs.push(performance.now() - t);
      // 4. 1 セルの編集の後の検査（メインスレッド。後の段階で Web Worker に移す）
      const v = performance.now();
      await store.flushValidation();
      validations.push(performance.now() - v);
    }
    // 5. スクロール: フレームごとに一定の量だけ進め、フレームの間隔を測る（100px はマウスのホイールの 1 段ほど、300px はかなり速いスクロール）
    const scrollGaps = async (stepPx: number) => {
      scroller.scrollTop = 0;
      await frame();
      const gaps: number[] = [];
      let last = performance.now();
      await new Promise<void>((resolve) => {
        let n = 0;
        const step = (now: number) => {
          gaps.push(now - last);
          last = now;
          scroller.scrollTop += stepPx;
          if (++n < 120) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      await frame();
      return gaps.slice(1);
    };
    const scroll100 = await scrollGaps(100);
    const scroll300 = await scrollGaps(300);
    // スクロールの後も、表示領域の行が描かれているか（白い部分が無いか）
    const rows = [...document.querySelectorAll<HTMLElement>('.sc-pane-frozen .sc-rowhead')].map((el) => Number(el.textContent));
    const firstVisible = Math.floor(scroller.scrollTop / 21) + 1;
    const lastVisible = Math.floor((scroller.scrollTop + scroller.clientHeight - 40) / 21) + 1;
    const covered = rows.includes(firstVisible) && rows.includes(lastVisible);
    return { arrows: stats(arrows), jumps: stats(jumps), inputs: stats(inputs), validations: stats(validations), scroll100: stats(scroll100), scroll300: stats(scroll300), covered };
  });

  const report = (name: string, s: Stats) => `${name}: median ${s.median.toFixed(1)} ms / p90 ${s.p90.toFixed(1)} ms / max ${s.max.toFixed(1)} ms (n=${s.count})`;
  console.log(`[perf] open (until the grid is visible): ${openMs} ms`);
  console.log(`[perf] ${report('arrow key move', results.arrows)}`);
  console.log(`[perf] ${report('Ctrl+End / Ctrl+Home', results.jumps)}`);
  console.log(`[perf] ${report('input + Enter', results.inputs)}`);
  console.log(`[perf] ${report('revalidation after 1 cell edit (main thread)', results.validations)}`);
  console.log(`[perf] ${report('scroll frame interval (100px/frame)', results.scroll100)}`);
  console.log(`[perf] ${report('scroll frame interval (300px/frame)', results.scroll300)}`);
  console.log(`[perf] rows rendered over the viewport after scrolling: ${results.covered}`);

  // NFR-10: 反応は 100 ミリ秒以内
  expect(results.arrows.p90).toBeLessThan(100);
  expect(results.jumps.median).toBeLessThan(100);
  expect(results.inputs.p90).toBeLessThan(100);
  expect(results.covered).toBe(true);
});
