// 未保存の変更の退避先（FR-FIO-06）。ブラウザの IndexedDB（idb-keyval）に置く。使えない環境（プライベートブラウズなど）では何もしない
import { del as idbDel, get as idbGet, keys as idbKeys, set as idbSet } from 'idb-keyval';

export interface BackupStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export const indexedDbBackupStorage: BackupStorage = {
  async get(key) {
    try {
      return await idbGet(key);
    } catch {
      return undefined;
    }
  },
  async set(key, value) {
    try {
      await idbSet(key, value);
    } catch {
      // 退避できなくても編集は続けられる（異常終了したときに復元できないだけ）
    }
  },
  async del(key) {
    try {
      await idbDel(key);
    } catch {
      // 消せなければ、次に開いたときに復元を提案するだけ
    }
  },
  async keys() {
    try {
      return (await idbKeys()).filter((k): k is string => typeof k === 'string');
    } catch {
      return [];
    }
  },
};

/** メモリ上の退避先（テスト用） */
export class MemoryBackupStorage implements BackupStorage {
  readonly data = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    const value = this.data.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, structuredClone(value));
  }

  async del(key: string): Promise<void> {
    this.data.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.data.keys()];
  }
}
