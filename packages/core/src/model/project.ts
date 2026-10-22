import type { CommonConfig } from './common';
import type { Diagnostic } from './diagnostic';
import type { SourceFile, StorageFormat } from './source';
import type { BrokenTable, Table } from './table';
import type { UidAllocator } from './uid';

/** 出力ファイルの形式（FR-OUT-01）。protobuf はテーブルごとにスキーマ（.proto）とバイナリ（.pb）を出す */
export const OUTPUT_FORMATS = ['json', 'yaml', 'csv', 'protobuf'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value);
}

export const CURRENT_FORMAT_VERSION = 1;
export const DEFAULT_TABLES_DIR = 'tables/';
export const DEFAULT_CONFIG_DIR = 'config/';
export const DEFAULT_OUTPUT_FORMAT: OutputFormat = 'json';
export const DEFAULT_OUT_DIR = 'build/';

/** P-01: プロジェクト設定ファイルの名前（設定ファイル自身の形式は拡張子で決める） */
export const PROJECT_CONFIG_FILES = ['masterdata-maker.yaml', 'masterdata-maker.json'] as const;

/**
 * プロジェクト設定（P-01）。省略可能なキーは、ファイルに書かれていたときだけ値を持つ。
 * 既定値を補った値は resolveProjectPaths で得る
 */
export interface ProjectConfig {
  format_version: number;
  storage: { format: StorageFormat };
  /** IANA のタイムゾーン名（DR-07） */
  timezone?: string;
  paths?: { tables?: string; config?: string };
  output?: { format?: OutputFormat; out_dir?: string };
  /** 読み込み元。新しく作ったプロジェクトなら null */
  source: SourceFile | null;
}

export interface ResolvedProjectPaths {
  /** テーブルのフォルダ（末尾の `/` なし。ルートなら空文字） */
  tablesDir: string;
  configDir: string;
  outDir: string;
  outputFormat: OutputFormat;
}

/** フォルダのパスを `a/b` の形にそろえる（ルートは空文字） */
export function normalizeDir(path: string): string {
  const parts = path.split('/').filter((part) => part !== '' && part !== '.');
  return parts.join('/');
}

export function joinPath(dir: string, name: string): string {
  const d = normalizeDir(dir);
  return d === '' ? name : `${d}/${name}`;
}

export function resolveProjectPaths(config: ProjectConfig): ResolvedProjectPaths {
  return {
    tablesDir: normalizeDir(config.paths?.tables ?? DEFAULT_TABLES_DIR),
    configDir: normalizeDir(config.paths?.config ?? DEFAULT_CONFIG_DIR),
    outDir: normalizeDir(config.output?.out_dir ?? DEFAULT_OUT_DIR),
    outputFormat: config.output?.format ?? DEFAULT_OUTPUT_FORMAT,
  };
}

export interface Project {
  config: ProjectConfig;
  common: CommonConfig;
  /** 読み込みエラーの無いテーブル。table 名の昇順（P-06） */
  tables: Table[];
  /** 読み込みエラーのあるテーブル（P-40）。table 名の昇順 */
  brokenTables: BrokenTable[];
  /** プロジェクト設定・共通設定の読み込みで出た警告（テーブルの診断は各テーブルが持つ） */
  diagnostics: Diagnostic[];
  /** 内部番号の続き（編集で追加するレコードに使う） */
  uids: UidAllocator;
}

/** 読み込みで出たすべての診断（プロジェクト・共通設定・全テーブル） */
export function allLoadDiagnostics(project: Project): Diagnostic[] {
  const result = [...project.diagnostics];
  const tables = [...project.tables, ...project.brokenTables].sort((a, b) => compareNames(a.name, b.name));
  for (const table of tables) result.push(...table.diagnostics);
  return result;
}

/** テーブル名の比較（コードポイント順。P-06） */
export function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
