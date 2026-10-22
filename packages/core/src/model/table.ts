import type { Cell, ExtraValue } from './cell';
import type { Diagnostic } from './diagnostic';
import type { FieldDef } from './field';
import type { TableProto } from './proto';
import type { SourceFile } from './source';

/** レコード（行）。名前が組み込みの Record と衝突するので TableRecord とする */
export interface TableRecord {
  /** 内部用の不変の番号（プロジェクト全体で一意） */
  uid: number;
  /** 列名 → セル。キーが無ければ未入力 */
  cells: Map<string, Cell>;
  /** 列定義に無いキー（DR-34）。保存時はレコードの末尾に元の順で残す */
  extra: [string, ExtraValue][];
}

/** 表示設定（DR-06） */
export interface TableView {
  column_widths: [string, number][];
  frozen_columns?: number;
  hidden_columns?: string[];
}

/** 読み込みエラーの無いテーブル。編集・保存の対象 */
export interface Table {
  kind: 'table';
  uid: number;
  /** ファイルの `table` */
  name: string;
  display_name?: string;
  /** 共通列を含まない（P-03） */
  fields: FieldDef[];
  records: TableRecord[];
  view: TableView;
  /**
   * Protocol Buffers のフィールド番号（ファイルの `proto`。P-63）。無ければ以前の規則（出力する列の順）で決める。
   * 今の列と合っていないこともある（手で書き換えたファイル）ので、使うときは resolveProto で列に合わせる
   */
  proto?: TableProto;
  /** 読み込み元。新しく作ったテーブルなら null */
  source: SourceFile | null;
  /** 読み込み時の警告 */
  diagnostics: Diagnostic[];
}

/**
 * 読み込みエラーのあるテーブル（P-40）。エラーの内容だけを持ち、編集も保存もしない
 */
export interface BrokenTable {
  kind: 'broken';
  uid: number;
  /** ファイルの `table`。読めなければファイル名から拡張子を除いたもの */
  name: string;
  source: SourceFile;
  /** エラーと警告 */
  diagnostics: Diagnostic[];
}

export function emptyView(): TableView {
  return { column_widths: [] };
}

/** P-05: 表示設定がすべて既定値か（`view` キー自体を書かない） */
export function isViewEmpty(view: TableView): boolean {
  return view.column_widths.length === 0 && view.frozen_columns === undefined && view.hidden_columns === undefined;
}

/** テーブルの列一覧（共通列が先。DR-32） */
export function tableColumns(baseFields: readonly FieldDef[], table: Pick<Table, 'fields'>): FieldDef[] {
  return [...baseFields, ...table.fields];
}

/** 列名 → 列定義。同じ名前が複数あれば先のものを使う */
export function columnMap(columns: readonly FieldDef[]): Map<string, FieldDef> {
  const map = new Map<string, FieldDef>();
  for (const column of columns) {
    if (!map.has(column.name)) map.set(column.name, column);
  }
  return map;
}

/** 主キーの列（`primary: true` の最初の列） */
export function primaryColumn(columns: readonly FieldDef[]): FieldDef | undefined {
  return columns.find((column) => column.primary === true);
}
