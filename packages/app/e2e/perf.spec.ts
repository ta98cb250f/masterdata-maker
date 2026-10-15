// 性能の確認（NFR-10〜12）: 1 万行 × 50 列のテーブル（?sample=large）で、セルの移動・入力への反応とスクロール、1 セルの編集の後の
// 再検査（Web Worker との往復）を測る。100 テーブルのプロジェクトを直接保存方式で開く時間も測る（NFR-11）。
// 測った値は標準出力に出す（環境で揺れるので、判定は要件の値に対して余裕を持たせる）
import { expect, test } from '@playwright/test';
import { mockDirectoryPicker, putGeneratedProject } from './opfs';

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
      // 4. 1 セルの編集の後の再検査: 変更を Worker に送り、変更のあったテーブルと参照するテーブルを検査し直した結果が store に入るまで
      //    （Worker との往復。再計算は表示に要るセルだけをメインスレッドで行うので、3 の入力の確定の描画に含まれる）
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
  console.log(`[perf] ${report('revalidation after 1 cell edit (worker round trip)', results.validations)}`);
  console.log(`[perf] ${report('scroll frame interval (100px/frame)', results.scroll100)}`);
  console.log(`[perf] ${report('scroll frame interval (300px/frame)', results.scroll300)}`);
  console.log(`[perf] rows rendered over the viewport after scrolling: ${results.covered}`);

  // NFR-10: 反応は 100 ミリ秒以内
  expect(results.arrows.p90).toBeLessThan(100);
  expect(results.jumps.median).toBeLessThan(100);
  expect(results.inputs.p90).toBeLessThan(100);
  expect(results.covered).toBe(true);
  // NFR-12（推奨）: 1 セルの編集の後の再検査は 300 ミリ秒以内
  expect(results.validations.median).toBeLessThan(300);
});

// NFR-11（推奨）: 100 テーブルのプロジェクトを 5 秒以内に開ける。
// 1 テーブルは 1,000 行 × 20 列（共通列の id・version を含む）とし、99 個の大きなテーブルと参照先の skill（50 行）で 100 テーブルにする。
// 理由: D-4 の「1 テーブル最大 1 万行 × 50 列」は最大のテーブルの大きさで、100 テーブルすべてがその大きさ（5,000 万セル）になるのは
// 現実的でない。ゲームのマスターデータは中小のテーブルが多いので中くらいの大きさにし、合計は約 200 万セル（最大の 1 テーブルの 4 倍）と
// 多めに見積もった。列には全 11 種の型・列レベル式・セル単位式・参照・入力規則・セル色・メモを含む（src/fs/largeSample.ts）
for (const format of ['yaml', 'json'] as const) {
  test(`100 テーブル（1,000 行 × 20 列 × 99 と skill）のプロジェクトを直接保存方式で開く（${format}）`, async ({ page }) => {
    test.setTimeout(180_000);
    await mockDirectoryPicker(page);
    await page.goto('/');
    const generated = await putGeneratedProject(page, { rows: 1000, columns: 20, format, bigTables: 99 });
    expect(generated.files).toBe(100 + 3);
    const measured = await page.evaluate(async () => {
      type State = { phase: string; validation: { version: number; running: boolean } };
      type Store = { getState(): State; project: { tables: unknown[]; brokenTables: unknown[] } | null };
      const store = (globalThis as unknown as { sheetcraft: Store }).sheetcraft;
      const until = (done: () => boolean) =>
        new Promise<void>((resolve) => {
          const poll = () => (done() ? resolve() : requestAnimationFrame(poll));
          poll();
        });
      const started = performance.now();
      document.querySelector<HTMLButtonElement>('[data-testid=open-folder]')?.click();
      // グリッドの行が描かれるまで
      await until(() => document.querySelector('[data-testid=grid] .sc-row') !== null);
      const gridMs = performance.now() - started;
      // 開いた直後の全テーブルの検査（Worker）の結果がシートタブに出るまで
      await until(() => store.getState().validation.version > 0 && !store.getState().validation.running);
      const validatedMs = performance.now() - started;
      return { gridMs, validatedMs, tables: store.project?.tables.length ?? 0, broken: store.project?.brokenTables.length ?? -1 };
    });
    console.log(
      `[perf] open 100 tables (${format}, ${(generated.bytes / 1024 / 1024).toFixed(1)} MB): grid visible ${measured.gridMs.toFixed(0)} ms, ` +
        `first validation of all tables ${measured.validatedMs.toFixed(0)} ms`,
    );
    expect(measured.tables).toBe(100);
    expect(measured.broken).toBe(0);
    await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'big_001');
    // 生成したデータには検査のエラーを混ぜてある（1,000 行ごとに hp: 0）。シートタブの件数に出ている
    await expect(page.getByTestId('sheet-tab-big_001').getByTestId('tab-errors')).toHaveText('1');
    expect(measured.gridMs).toBeLessThan(5000);
  });
}
