// 画面テスト（NFR-31）。ビルドしたものを vite preview で配り、Chromium で動かす
import { defineConfig, devices } from '@playwright/test';

// 複数の作業が同時に画面テストを走らせても、ビルドの出力先とポートが重ならないように環境変数で変えられる
const PORT = Number(process.env.E2E_PORT ?? 4173);
const OUT_DIR = process.env.E2E_OUTDIR ?? 'dist';
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } };

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // test.only の消し忘れで、CI がその 1 件だけ動かして通らないようにする
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1400, height: 900 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    trace: 'retain-on-failure',
  },
  // 性能の確認（perf.spec.ts）は環境で揺れるので、CI では別のジョブで測るだけにする（--project で分けて動かせるようにする）
  projects: [
    { name: 'chromium', testIgnore: /perf\.spec\.ts$/, use: desktop },
    { name: 'perf', testMatch: /perf\.spec\.ts$/, use: desktop },
  ],
  webServer: {
    command: `pnpm exec vite build --outDir ${OUT_DIR} && pnpm exec vite preview --outDir ${OUT_DIR} --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // 古いビルドを配っているサーバーを使い回さないよう、毎回ビルドし直す
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
