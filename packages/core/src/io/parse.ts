import type { ColorDef, CommonPartName, EnumDef } from '../model/common';
import { defaultBaseFields } from '../model/defaults';
import type { Diagnostic } from '../model/diagnostic';
import type { FieldDef } from '../model/field';
import type { ProjectConfig } from '../model/project';
import type { SourceFile, StorageFormat } from '../model/source';
import { extensionOf, formatFromPath } from '../model/source';
import type { BrokenTable, Table } from '../model/table';
import { UidAllocator } from '../model/uid';
import { IoCode } from './codes';
import { decodeBaseFields, decodeColors, decodeEnums, decodeProjectConfig } from './decode-config';
import { decodeTable } from './decode-table';
import { parseJson } from './json-parse';
import type { ParseResult } from './tree';
import { Reporter } from './tree';
import { parseYaml } from './yaml-parse';

// ファイル単位の読み込み（テキスト → モデル）

/** テキストを構文木にする。先頭の BOM は警告して取り除く（DR-31）。CRLF はそのまま受け付ける */
export function parseText(text: string, format: StorageFormat, reporter: Reporter): ParseResult {
  let body = text;
  if (body.charCodeAt(0) === 0xfeff) {
    reporter.warn(IoCode.bomRemoved, { line: 1, column: 1 });
    body = body.slice(1);
  }
  return format === 'yaml' ? parseYaml(body, reporter) : parseJson(body, reporter);
}

function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

function stemOf(path: string): string {
  return baseName(path).replace(/\.(?:ya?ml|json)$/, '');
}

function sourceOf(path: string, text: string, fallback: StorageFormat): SourceFile {
  return { path, format: formatFromPath(path) ?? fallback, text };
}

export interface ParseTableOptions {
  /** 共通列（省略時は既定の共通列） */
  baseFields?: readonly FieldDef[];
  /** 内部番号の採番（省略時は 1 から） */
  uids?: UidAllocator;
  /** プロジェクトのリソースファイルの形式。拡張子が違えば警告する（DR-02） */
  storageFormat?: StorageFormat;
}

/** テーブルファイルを読む。読み込みエラーがあれば BrokenTable（P-40） */
export function parseTableFile(path: string, text: string, options: ParseTableOptions = {}): Table | BrokenTable {
  const source = sourceOf(path, text, options.storageFormat ?? 'yaml');
  const reporter = new Reporter([], { file: path });
  if (options.storageFormat !== undefined && source.format !== options.storageFormat) {
    reporter.warn(IoCode.formatMismatch, undefined, { path, expected: options.storageFormat });
  }
  const parsed = parseText(text, source.format, reporter);
  const table = decodeTable(parsed.node, reporter, {
    baseFields: options.baseFields ?? defaultBaseFields(),
    uids: options.uids ?? new UidAllocator(),
    source,
    fallbackName: stemOf(path),
  });
  // DR-04: ファイル名は <table>.<拡張子>
  if (parsed.node !== null && table.name !== stemOf(path)) {
    reporter.warn(IoCode.fileNameMismatch, undefined, {
      path,
      expected: `${table.name}.${baseName(path).match(/\.(ya?ml|json)$/)?.[1] ?? extensionOf(source.format)}`,
    });
  }
  return table;
}

export type ParsedFile<T> = { ok: true; value: T; diagnostics: Diagnostic[] } | { ok: false; diagnostics: Diagnostic[] };

function finish<T>(value: T | null, reporter: Reporter): ParsedFile<T> {
  if (value === null || reporter.hasErrors()) return { ok: false, diagnostics: reporter.items };
  return { ok: true, value, diagnostics: reporter.items };
}

/** プロジェクト設定ファイル（masterdata-maker.yaml / masterdata-maker.json）を読む */
export function parseProjectConfigFile(path: string, text: string): ParsedFile<ProjectConfig> {
  const reporter = new Reporter([], { file: path });
  const format = formatFromPath(path) ?? 'yaml';
  const parsed = parseText(text, format, reporter);
  return finish(decodeProjectConfig(parsed.node, reporter, { path, format, text }), reporter);
}

export interface CommonPartValues {
  enums: EnumDef;
  base_fields: FieldDef;
  colors: ColorDef;
}

/** 共通設定のファイルを 1 つ読む */
export function parseCommonFile<N extends CommonPartName>(
  name: N,
  path: string,
  text: string,
): ParsedFile<CommonPartValues[N][]> {
  const reporter = new Reporter([], { file: path });
  const parsed = parseText(text, formatFromPath(path) ?? 'yaml', reporter);
  const node = parsed.node;
  let value: unknown[] | null;
  if (name === 'enums') value = decodeEnums(node, reporter);
  else if (name === 'base_fields') value = decodeBaseFields(node, reporter);
  else value = decodeColors(node, reporter);
  return finish(value as CommonPartValues[N][] | null, reporter);
}
