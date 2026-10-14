import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  worker: { format: 'es' },
  // core（YAML・正規表現のライブラリを含む）を 1 つにまとめるため、既定の 500kB では警告が出る
  build: { chunkSizeWarningLimit: 1500 },
});
