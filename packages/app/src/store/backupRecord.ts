// 未保存の変更の退避の内容（FR-FIO-06）。画面のメインスレッドと検査用の Web Worker の両方で使う（AppStore には依存しない）。
// 1 万行のテーブルでは、正規形のテキストを作る・ハッシュを取る・IndexedDB に書き込む（構造化複製）のそれぞれに数十ミリ秒かかるので、
// Worker が使えるときは Worker で行い、メインスレッドを止めない（NFR-10）
import type { CommonPartName, Project, StorageFormat } from '@masterdata-maker/core';
import { SerializeError, serializeTable } from '@masterdata-maker/core';
import type { BackupStorage } from '../fs/backupStore';

export const BACKUP_VERSION = 1;

/** プロジェクトの同一性の判定に使う情報 */
export interface ProjectIdentity {
  /** フォルダの名前 */
  name: string;
  configPath: string;
  configText: string;
}

export interface BackupTable {
  /** 読み込み元のファイル（新しく作ったテーブルなら null） */
  basePath: string | null;
  /** 退避したときの読み込み元のファイルの中身のハッシュ（退避の後にファイルが書き換えられたかを見る） */
  baseHash: string | null;
  name: string;
  format: StorageFormat;
  /** 今の内容の正規形のテキスト */
  text: string;
}

export interface BackupCommon {
  part: CommonPartName;
  path: string;
  format: StorageFormat;
  /** 既定値に戻したなら null */
  text: string | null;
}

export interface BackupRecord {
  version: number;
  /** 退避した日時（ミリ秒） */
  savedAt: number;
  project: ProjectIdentity;
  /** 直接保存方式のフォルダのハンドル（同じフォルダかを確かめる） */
  handle?: unknown;
  tables: BackupTable[];
  common: BackupCommon[];
  /** 削除したテーブルの読み込み元のファイル */
  removed: string[];
}

/** 退避するテーブル（正規形のテキストは、これから作る） */
export interface BackupTarget {
  uid: number;
  format: StorageFormat;
  basePath: string | null;
  baseHash: string | null;
}

const H1 = 0xdeadbeef;
const H2 = 0x41c6ce57;

function hashStep(text: string, from: number, to: number, state: [number, number]): void {
  let [h1, h2] = state;
  for (let i = from; i < to; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  state[0] = h1;
  state[1] = h2;
}

function hashFinish(state: [number, number]): string {
  let [h1, h2] = state;
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** 文字列のハッシュ（cyrb53。同一性の判定のキーと、ファイルが書き換えられたかの判定に使う。暗号用ではない） */
export function hashText(text: string): string {
  const state: [number, number] = [H1, H2];
  hashStep(text, 0, text.length, state);
  return hashFinish(state);
}

/** hashText と同じ値を、長い文字列では区切って間に他の処理を挟みながら求める（メインスレッドを止めない） */
export async function hashTextSliced(text: string, slice = 1 << 19): Promise<string> {
  const state: [number, number] = [H1, H2];
  for (let from = 0; from < text.length; from += slice) {
    if (from > 0) await new Promise((r) => setTimeout(r, 0));
    hashStep(text, from, Math.min(text.length, from + slice), state);
  }
  return hashFinish(state);
}

/**
 * 退避するテーブルの正規形のテキストを作る。手で元の値に戻したなどで読み込み元と同じ中身（ハッシュが同じ）なら除く
 */
export function backupTables(project: Project, targets: readonly BackupTarget[]): BackupTable[] {
  const baseFields = project.common.base_fields.items;
  const tables: BackupTable[] = [];
  for (const target of targets) {
    const table = project.tables.find((t) => t.uid === target.uid);
    if (table === undefined) continue;
    let text: string;
    try {
      text = serializeTable(table, baseFields, target.format);
    } catch (e) {
      // 書き出せない値（NaN など）があるテーブルは退避しない
      if (e instanceof SerializeError) continue;
      throw e;
    }
    if (target.baseHash !== null && hashText(text) === target.baseHash) continue;
    tables.push({ basePath: target.basePath, baseHash: target.baseHash, name: table.name, format: target.format, text });
  }
  return tables;
}

/**
 * 退避する。record.tables に targets のテキストを入れて書き込む。退避するものが無ければ消す。
 * 戻り値は書き込んだか（false なら消した）
 */
export async function persistBackup(
  project: Project,
  storage: BackupStorage,
  key: string,
  record: BackupRecord,
  targets: readonly BackupTarget[],
): Promise<boolean> {
  const tables = backupTables(project, targets);
  if (tables.length === 0 && record.common.length === 0 && record.removed.length === 0) {
    await storage.del(key);
    return false;
  }
  await storage.set(key, { ...record, tables });
  return true;
}
