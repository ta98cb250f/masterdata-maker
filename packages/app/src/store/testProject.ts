// テスト用: 組み込みのサンプルなどをメモリ上の ProjectFs で開いた AppStore（*.test.ts から使う）
import type { ProjectFs, SavePlan } from '@sheetcraft/core';
import { MemoryProjectFs } from '@sheetcraft/core';
import { allCommands } from '../commands';
import { downloadSource } from '../fs/download';
import { basicSampleFiles } from '../fs/sample';
import type { ProjectSource, SaveOutcome, SourceKind } from '../fs/types';
import { DIRECT_CAPABILITIES } from '../fs/types';
import { AppStore } from './AppStore';
import type { AppStoreOptions } from './AppStore';

export interface TestSourceOptions {
  name?: string;
  kind?: SourceKind;
  /** 保存の記録 */
  saved?: SavePlan[];
  /** ファイルの更新日時（直接保存方式のときだけ使う） */
  lastModified?(path: string): Promise<number | null>;
}

/** メモリ上のファイルを開く口（保存は記録するだけ。kind が direct なら直接保存方式のふりをする） */
export function testSource(fs: ProjectFs, options: TestSourceOptions = {}): ProjectSource {
  const base = downloadSource(options.name ?? 'basic-yaml', fs, options.kind ?? 'sample', () => undefined);
  const source: ProjectSource = {
    ...base,
    save: async (plan): Promise<SaveOutcome> => {
      options.saved?.push(plan);
      if (fs instanceof MemoryProjectFs) {
        for (const f of plan.files) fs.write(f.path, f.text);
      }
      return { written: plan.files, removed: plan.remove, failed: [], manualRemove: [] };
    },
  };
  if (options.kind === 'direct') {
    source.capabilities = DIRECT_CAPABILITIES;
    if (options.lastModified !== undefined) source.lastModified = options.lastModified;
  }
  return source;
}

/** サンプル（basic-yaml）を開いた store。検査は 0 ミリ秒後に行う */
export async function openTestStore(
  options: AppStoreOptions = {},
  files: Record<string, string> = basicSampleFiles(),
  sourceOptions: TestSourceOptions = {},
): Promise<{ store: AppStore; fs: MemoryProjectFs; source: ProjectSource }> {
  const store = new AppStore({ commands: allCommands(), platform: 'other', validationDelay: 0, ...options });
  const fs = new MemoryProjectFs(files);
  const source = testSource(fs, sourceOptions);
  if (!(await store.open(source))) throw new Error('サンプルを開けない');
  await store.flushValidation();
  return { store, fs, source };
}
