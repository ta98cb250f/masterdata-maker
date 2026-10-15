import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    // 変換結果のファイルへのキャッシュは、import.meta.glob で拾うファイル（文言ファイルなど）が増えても作り直されないので使わない
    fsModuleCache: false,
  },
});
