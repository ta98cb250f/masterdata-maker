// 検査用の Web Worker とのやり取りの形（計画書 §4.2、FR-VAL-09〜10）。
// Worker はプロジェクトの複製を持つ。最初に複製（init）を受け取り、その後はメインスレッドで当てたパッチ（patches）を同じ順で当てて同期する。
// 検査・出力・正規形のテキストの作成は「仕事」（job）として頼み、受け取ったら started、終わったら done を返す
import type {
  BrokenTable,
  CommonPartName,
  ExportOptions,
  ExportResult,
  Patch,
  ProjectSnapshot,
  StorageFormat,
} from '@sheetcraft/core';
import type { ValidationOutput, ValidationRequest } from '../store/validation';

/**
 * パッチでは伝わらないモデルの変化。仕事のたびに添える。
 * - sources: 読み込み元のパスと形式（保存・名前の変更で変わる。診断のファイル名に使う）
 * - brokenTables: 読み込みエラーのテーブル（外部での変更の読み込み直しで増減する）。変わったときだけ
 */
export interface SyncInfo {
  tableSources: [uid: number, path: string, format: StorageFormat][];
  commonSources: [part: CommonPartName, path: string | null, format: StorageFormat | null][];
  brokenTables?: BrokenTable[];
}

/** 正規形のテキストを作るテーブル（未保存の変更の退避に使う。FR-FIO-06） */
export interface SerializeTarget {
  uid: number;
  format: StorageFormat;
}

export interface SerializedTable {
  uid: number;
  /** 書き出せない値（NaN など）があれば null */
  text: string | null;
}

export type Job =
  | { kind: 'validate'; request: ValidationRequest }
  | { kind: 'export'; options: ExportOptions }
  | { kind: 'serialize'; tables: SerializeTarget[] };

export interface JobResults {
  validate: ValidationOutput;
  export: ExportResult;
  serialize: SerializedTable[];
}

export type JobResult = JobResults[keyof JobResults];

export type ToWorker =
  | { type: 'init'; snapshot: ProjectSnapshot }
  | { type: 'patches'; patches: readonly Patch[] }
  | { type: 'job'; id: number; job: Job; sync: SyncInfo };

export type FromWorker =
  /** 仕事を受け取って始めた（時間制限はここから数える） */
  | { type: 'started'; id: number }
  | { type: 'done'; id: number; result: JobResult }
  /** desync: パッチを当てられず、複製がメインスレッドとずれた（複製を送り直してやり直す） */
  | { type: 'failed'; id: number; message: string; desync: boolean };
