// 組み込みのサンプル（P-45）。samples/basic-yaml をビルドに含め、メモリ上の ProjectFs で開く（保存はダウンロード保存方式）
import { MemoryProjectFs } from '@masterdata-maker/core';
import { downloadSource } from './download';
import type { DownloadFn } from './download';
import { generateLargeProjectFiles } from './largeSample';
import type { ProjectSource } from './types';

const BASIC_PREFIX = '../../../../samples/basic-yaml/';

const basicFiles = import.meta.glob<string>('../../../../samples/basic-yaml/**/*.{yaml,yml,json}', {
  eager: true,
  query: '?raw',
  import: 'default',
});

/** basic-yaml のファイル一式（プロジェクトのルートからの相対パス → 本文） */
export function basicSampleFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [path, text] of Object.entries(basicFiles)) {
    if (path.startsWith(BASIC_PREFIX)) files[path.slice(BASIC_PREFIX.length)] = text;
  }
  return files;
}

export type SampleName = 'basic' | 'large';

export function isSampleName(value: string | null): value is SampleName {
  return value === 'basic' || value === 'large';
}

/** サンプルを開く口。large は 1 万行 × 50 列のテーブルを含むプロジェクトを生成する（NFR-10 の確認用） */
export function sampleSource(name: SampleName, download?: DownloadFn): ProjectSource {
  const files = name === 'basic' ? basicSampleFiles() : generateLargeProjectFiles({ format: 'json' });
  const projectName = name === 'basic' ? 'basic-yaml' : 'large-sample';
  return downloadSource(projectName, new MemoryProjectFs(files), 'sample', download);
}
