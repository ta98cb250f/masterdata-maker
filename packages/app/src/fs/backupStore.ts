// 未保存の変更の退避先（FR-FIO-06）。ブラウザの IndexedDB（idb-keyval）に置く。
// 使えない環境（プライベートブラウズなど）では、読み出し・削除は何もしない。書き込みの失敗は呼び出し元に伝える（画面で知らせる）
import { del as idbDel, get as idbGet, keys as idbKeys, set as idbSet } from 'idb-keyval';

export interface BackupStorage {
  /** 読み出せなければ undefined（投げない） */
  get(key: string): Promise<unknown>;
  /** 書き込めなければ投げる（BackupManager が利用者に知らせる） */
  set(key: string, value: unknown): Promise<void>;
  /** 消せなくても投げない */
  del(key: string): Promise<void>;
  /** 読み出せなければ空（投げない） */
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
    // 失敗は投げる（退避できなくても編集は続けられるが、異常終了したときに復元できないことを利用者に知らせる）
    await idbSet(key, value);
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
