// アプリの状態の型
import type {
  Calculator,
  CellPos,
  CellRange,
  Diagnostic,
  EditSession,
  FilterCondition,
  Locale,
  Project,
  Selection,
  Severity,
  SortDirection,
} from '@sheetcraft/core';
import type { ProjectSource } from '../fs/types';

/** 表示だけの並べ替えの条件（FR-SRT-01。ファイルには保存しない） */
export interface SortState {
  column: string;
  direction: SortDirection;
}

/** 列ごとのフィルタの条件（FR-SRT-03。ファイルには保存しない） */
export interface FilterState {
  column: string;
  condition: FilterCondition;
}

/**
 * テーブルごとの表示の状態。テーブルを切り替えても残す（FR-FIO-04）。
 * 選択範囲の座標は表示上の座標（行は rowUids の位置、列は表示中の列の位置）
 */
export interface TableViewState {
  selection: Selection;
  sort: readonly SortState[];
  filters: readonly FilterState[];
  /** エラー・警告のある行だけを表示する（FR-SRT-06） */
  onlyIssues: boolean;
  /**
   * 並べ替え・フィルタを当てた行の並び（レコードの uid）。null ならファイル上の順。
   * 条件を変えたときに store.applySortFilter で作り直す（編集のたびには並べ替え直さない）
   */
  order: readonly number[] | null;
  /** order を作った時点で存在したレコード（後から足した行を見分けて、近くに表示する） */
  orderKnown: ReadonlySet<number> | null;
}

/** セルの編集の状態（FR-EDT-01〜05） */
export interface EditingState {
  table: number;
  record: number;
  column: string;
  /** 編集を始めたときの表示上の位置 */
  pos: CellPos;
  /** cell: セルの上の入力欄 / formulaBar: 数式バー */
  origin: 'cell' | 'formulaBar';
  /**
   * overwrite: 文字を打って始めた（矢印キーで確定して移動する）
   * edit: Enter / F2 / ダブルクリックで始めた（矢印キーは文字の間を動く）
   */
  mode: 'overwrite' | 'edit';
  /** 今の入力内容（数式バーとセルの入力欄で共有する） */
  text: string;
  /** 確定できなかった理由（FR-EDT-05）。null なら無し */
  error: { message: string; hint: string } | null;
}

export interface DialogEntry {
  /** 開くたびに振る番号（同じダイアログを重ねて開いたときの区別） */
  key: number;
  id: string;
  args: unknown;
}

export type PanelPosition = 'right' | 'bottom';

/** 右クリックメニューなどの項目 */
export type MenuEntry =
  /**
   * label は組み立て済みの名前（参照先の名前など、文言キーで表せないもの。labelKey より優先）。
   * swatch は色の見本（null は「なし」の印）。testId は画面テスト用の名前（省略時は操作の識別子）
   */
  | { kind: 'command'; command: string; args?: unknown; labelKey?: string; label?: string; swatch?: string | null; testId?: string }
  | { kind: 'separator' }
  | { kind: 'submenu'; labelKey: string; items: MenuEntry[]; testId?: string };

export interface ContextMenuState {
  /** クライアント座標 */
  x: number;
  y: number;
  items: MenuEntry[];
}

export interface StatusMessage {
  id: number;
  kind: 'info' | 'error';
  text: string;
}

/** テーブルごとの検査の結果 */
export interface TableIssues {
  diagnostics: readonly Diagnostic[];
  errors: number;
  warnings: number;
  /** レコードの uid → 列名 → 重い方の重大度 */
  cells: ReadonlyMap<number, ReadonlyMap<string, Severity>>;
}

export interface ValidationState {
  /** 結果が変わるたびに増える */
  version: number;
  /** テーブル名 → 結果 */
  tables: ReadonlyMap<string, TableIssues>;
  /** プロジェクト設定・共通設定の診断 */
  common: readonly Diagnostic[];
  /** 検査の途中か */
  running: boolean;
}

/** コピー・切り取りした範囲の点線の枠 */
export interface ClipboardMark {
  table: number;
  range: CellRange;
  cut: boolean;
}

/** スクロールして見せるセル（キー操作で選択を動かしたとき） */
export interface RevealRequest {
  table: number;
  pos: CellPos;
  seq: number;
}

export type AppPhase = 'start' | 'loading' | 'open';

export interface AppState {
  locale: Locale;
  phase: AppPhase;
  project: Project | null;
  session: EditSession | null;
  calc: Calculator | null;
  source: ProjectSource | null;
  /** 編集（適用・元に戻す・やり直す・保存）のたびに増える */
  revision: number;
  /** 表示中のテーブル（読み込みエラーのテーブルも含む）の uid */
  activeTable: number | null;
  views: ReadonlyMap<number, TableViewState>;
  validation: ValidationState;
  editing: EditingState | null;
  panels: Readonly<Record<PanelPosition, string | null>>;
  /** 開いているダイアログ（後のものが手前） */
  dialogs: readonly DialogEntry[];
  contextMenu: ContextMenuState | null;
  status: StatusMessage | null;
  clipboardMark: ClipboardMark | null;
  reveal: RevealRequest | null;
  /** 開けなかったときの理由 */
  loadError: readonly string[] | null;
  /** 前回のフォルダの名前（直接保存方式。FR-FIO-01） */
  lastFolder: string | null;
}
