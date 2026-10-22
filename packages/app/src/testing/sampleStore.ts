// 単体テスト用: 組み込みのサンプル（samples/basic-yaml）を開いた store（保存はしない）
import { MemoryProjectFs } from '@masterdata-maker/core';
import { allCommands } from '../commands';
import { downloadSource } from '../fs/download';
import { basicSampleFiles } from '../fs/sample';
import { AppStore } from '../store/AppStore';

export async function openSampleStore(files: Record<string, string> = basicSampleFiles()): Promise<AppStore> {
  const store = new AppStore({ commands: allCommands(), platform: 'other', validationDelay: 0 });
  const ok = await store.open(downloadSource('basic-yaml', new MemoryProjectFs(files), 'sample', () => undefined));
  if (!ok) throw new Error('failed to open the sample');
  await store.flushValidation();
  return store;
}

/** テーブル名から uid */
export function tableUid(store: AppStore, name: string): number {
  const uid = store.tabs().find((t) => t.name === name)?.uid;
  if (uid === undefined) throw new Error(`table ${name} not found`);
  return uid;
}

/** 主キー（id）の値からレコードの uid */
export function recordUid(store: AppStore, table: string, id: number): number {
  const t = store.project?.tables.find((x) => x.name === table);
  const record = t?.records.find((r) => store.calc?.getCell(t, r.uid, 'id').raw === id);
  if (record === undefined) throw new Error(`record ${table} ${id} not found`);
  return record.uid;
}
