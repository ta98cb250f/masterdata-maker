// ファイルの読み書きの方式（§4.4、NFR-02〜05）
import type { ProjectFs, SaveFile, SavePlan } from '@sheetcraft/core';

/** direct: 直接保存方式 / download: ダウンロード保存方式 / sample: 組み込みのサンプル（保存はダウンロード。P-45） */
export type SourceKind = 'direct' | 'download' | 'sample';

/** その方式で使える機能（NFR-05: 使えない機能を画面に示す） */
export interface SourceCapabilities {
  /** 前回のフォルダの記憶（FR-FIO-01） */
  rememberFolder: boolean;
  /** 外部での変更の検知（FR-FIO-07） */
  detectExternalChanges: boolean;
  /** フォルダへの直接保存 */
  directSave: boolean;
}

export const DIRECT_CAPABILITIES: SourceCapabilities = { rememberFolder: true, detectExternalChanges: true, directSave: true };
export const DOWNLOAD_CAPABILITIES: SourceCapabilities = { rememberFolder: false, detectExternalChanges: false, directSave: false };

export interface SaveFailure {
  path: string;
  message: string;
}

export interface SaveOutcome {
  /** 書き込めた（ダウンロードした）ファイル。EditSession.markSaved に渡す */
  written: SaveFile[];
  /** 消せたファイル */
  removed: string[];
  /** 書き込めなかった・消せなかったファイル */
  failed: SaveFailure[];
  /** 手で消す必要があるファイル（ダウンロード保存方式。P-43） */
  manualRemove: string[];
  /** ダウンロードしたファイルの名前（ダウンロード保存方式） */
  downloaded?: string;
}

/** 開いたプロジェクトの読み書きの口 */
export interface ProjectSource {
  kind: SourceKind;
  /** プロジェクトのフォルダ名（タイトルに出す） */
  name: string;
  /** 読み込み */
  fs: ProjectFs;
  capabilities: SourceCapabilities;
  /** 保存（EditSession.planSave の結果を書き込む） */
  save(plan: SavePlan): Promise<SaveOutcome>;
  /** ファイルの更新日時（ミリ秒）。直接保存方式だけ（外部での変更の検知。FR-FIO-07） */
  lastModified?(path: string): Promise<number | null>;
}
