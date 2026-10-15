// 画面テスト（NFR-31）。ビルドしたものを vite preview で配り、Chromium で動かす
import { defineConfig, devices } from '@playwright/test';

// 複数の作業が同時に画面テストを走らせても、ビルドの出力先とポートが重ならないように環境変数で変えられる
const PORT = Number(process.env.E2E_PORT ?? 4173);
const OUT_DIR = process.env.E2E_OUTDIR ?? 'dist';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } } }],
  webServer: {
    command: `pnpm exec vite build --outDir ${OUT_DIR} && pnpm exec vite preview --outDir ${OUT_DIR} --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // 古いビルドを配っているサーバーを使い回さないよう、毎回ビルドし直す
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
