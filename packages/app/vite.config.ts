import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * ビルドした画面の通信先を、自分と GitHub の API だけに絞る（NFR-07。GitHub 方式 P-67 のトークンを
 * 注入されたスクリプトが他へ送れないようにする多層の守り）。開発サーバーは HMR の WebSocket を使うので、ビルドだけに入れる
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'masterdata-maker-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: "connect-src 'self' https://api.github.com" }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  base: './',
  worker: { format: 'es' },
  // core（YAML・正規表現のライブラリを含む）を 1 つにまとめるため、既定の 500kB では警告が出る
  build: { chunkSizeWarningLimit: 1500 },
});
