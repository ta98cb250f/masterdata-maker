// 出力ファイルの生成（§9.1、FR-OUT-01〜05）。1 テーブル＝1 ファイル＝レコードの配列
// （protobuf だけはテーブルごとにスキーマの .proto とバイナリの .pb の 2 ファイル。P-63）
import type { RawValue } from '../model/cell';
import type { Diagnostic } from '../model/diagnostic';
import { hasErrors } from '../model/diagnostic';
import type { FieldDef, FieldType } from '../model/field';
import { elementType, isFieldExported, isListType } from '../model/field';
import type { OutputFormat, Project } from '../model/project';
import { compareNames, joinPath, normalizeDir, resolveProjectPaths } from '../model/project';
import type { BrokenTable, Table } from '../model/table';
import type { Calculator, CellResult } from '../calc';
import type { OutNode } from '../io/emit';
import { emitJson, emitYaml, map, scalar, seq, SerializeError } from '../io/emit';
import { validateCommon, validateTable } from '../validate';
import { checkDefaultValue, checkRawValue } from '../validate/values';
import { ExportCode } from './codes';
import { emitCsv } from './csv';
import { emitProtoSchema, encodeProtoTable, isProtoIdentifier, protoFieldConflicts, protoMessageNames } from './protobuf';

export interface ExportOptions {
  /** 出力するテーブル（省略時はすべて） */
  tables?: readonly string[];
  /** 検査エラーがあっても出力する（FR-OUT-05）。列の型に合わない値は null で出す（P-51） */
  force?: boolean;
  /** 出力先のフォルダ（プロジェクトのルートからの相対パス）。省略時は output.out_dir */
  outDir?: string;
  /** 出力の形式。省略時は output.format（既定は json。FR-OUT-01） */
  format?: OutputFormat;
}

export interface ExportFile {
  /** プロジェクトのルートからの相対パス */
  path: string;
  table: string;
  /** テキスト（UTF-8 で書く）か、バイナリ（protobuf の .pb） */
  content: string | Uint8Array;
}

export interface ExportResult {
  /** 出力してよいか（エラーが無い、または force） */
  ok: boolean;
  /** force でも出力できないエラーがある（protobuf の名前の問題。P-63） */
  blocked: boolean;
  /** 出力するファイル。ok でなければ空（FR-OUT-05） */
  files: ExportFile[];
  /** 読み込み時の診断と検査の結果（出力するテーブルと共通設定の分） */
  diagnostics: Diagnostic[];
}

function uniqueColumns(columns: readonly FieldDef[]): FieldDef[] {
  const seen = new Set<string>();
  return columns.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
}

/**
 * 出力する型付きの値（P-51）。列の型に合わない値は undefined にして null で出す。判定は常に行う検査（FR-VAL-03）と
 * 同じ関数を使う（値の型・整数の範囲・datetime の形式・列挙型の値・リストの要素。リストは要素が 1 つでも合わなければ全体）。
 * 式の結果は計算のときに列の型で検査済みで（FR-FML-12）、エラーなら raw が undefined
 */
function typedRaw(res: CellResult, column: FieldDef, enumValues: readonly string[] | undefined): RawValue | undefined {
  const raw = res.raw;
  if (raw === undefined) return undefined;
  if (res.source === 'value') return checkRawValue(raw, column, enumValues).length === 0 ? raw : undefined;
  if (res.source === 'default') return checkDefaultValue(raw, column, enumValues).length === 0 ? raw : undefined;
  return raw;
}

/** 出力する値。datetime の文字列は常に引用符で囲む（DR-41）。未入力は null（FR-OUT-04） */
function outValue(raw: RawValue | undefined, type: FieldType): OutNode {
  if (raw === undefined) return scalar(null);
  if (Array.isArray(raw)) {
    const itemType = isListType(type) ? elementType(type) : type;
    return seq(
      raw.map((item) => outValue(item, itemType)),
      true,
    );
  }
  if (typeof raw === 'string') return scalar(raw, type === 'datetime');
  return scalar(raw);
}

/** 出力する列（export: false の列を除く。共通列が先）と、レコードごとの型付きの値（未入力・型に合わない値は undefined） */
function exportRows(calc: Calculator, table: Table): { columns: FieldDef[]; rows: (RawValue | undefined)[][] } {
  const columns = uniqueColumns(calc.columns(table)).filter(isFieldExported);
  const enums = columns.map((column) => calc.enumValues(column));
  const rows = table.records.map((record) =>
    columns.map((column, i) => typedRaw(calc.getCell(table, record.uid, column.name), column, enums[i])),
  );
  return { columns, rows };
}

/**
 * テーブルの出力ファイルのテキスト（FR-OUT-02〜04）。キーは列の順（共通列が先）で、export: false の列と
 * 列定義に無いキーは出さない。式は計算結果、未入力は default か null（実効値。P-10）。
 * 列の型に合わない値と式のエラーは null（P-51。各列は「その列の型の値か null」になる）
 */
export function exportTableText(calc: Calculator, table: Table, format: 'json' | 'yaml' | 'csv'): string {
  const { columns, rows } = exportRows(calc, table);
  if (format === 'csv') return emitCsv(columns, rows);
  const root = seq(
    rows.map((row) =>
      map(
        columns.map((column, i): [string, OutNode] => [column.name, outValue(row[i], column.type)]),
        false,
      ),
    ),
    false,
  );
  return format === 'yaml' ? emitYaml(root) : emitJson(root);
}

/** テーブルの出力ファイル（パスは出力先のフォルダからの相対パス）。protobuf はスキーマとバイナリの 2 つ */
function exportTableFiles(calc: Calculator, table: Table, format: OutputFormat): { name: string; content: string | Uint8Array }[] {
  if (format !== 'protobuf') return [{ name: `${table.name}.${format}`, content: exportTableText(calc, table, format) }];
  const { columns, rows } = exportRows(calc, table);
  return [
    { name: `${table.name}.proto`, content: emitProtoSchema(table.name, table.display_name, columns) },
    { name: `${table.name}.pb`, content: encodeProtoTable(columns, rows) },
  ];
}

/**
 * protobuf で出せないテーブルの診断（P-63）: 同じパッケージの中でメッセージ名が重なるテーブル（foo の FooTable と
 * foo_table など）、JSON 名が重なる列（a_1 と a1 など。protoc がエラーにする）、proto の識別子にならない名前
 * （_1 のメッセージ名 1、ファイルで書いた書式に合わないテーブル名・列名。--force では列名の書式エラーも出力に進むため）
 */
function protobufDiagnostics(calc: Calculator, all: readonly (Table | BrokenTable)[], selected: readonly Table[]): Diagnostic[] {
  const owners = new Map<string, string[]>();
  for (const t of all) {
    for (const message of protoMessageNames(t.name)) owners.set(message, [...(owners.get(message) ?? []), t.name]);
  }
  const ds: Diagnostic[] = [];
  for (const table of selected) {
    const [record] = protoMessageNames(table.name);
    if (!isProtoIdentifier(record)) {
      ds.push({ severity: 'error', code: ExportCode.protoInvalidName, table: table.name, params: { name: table.name, proto: record } });
    }
    for (const message of protoMessageNames(table.name)) {
      const others = (owners.get(message) ?? []).filter((name) => name !== table.name);
      if (others.length > 0) {
        ds.push({ severity: 'error', code: ExportCode.protoMessageConflict, table: table.name, params: { message, other: others.join(', ') } });
      }
    }
    const columns = uniqueColumns(calc.columns(table)).filter(isFieldExported);
    for (const column of columns) {
      if (!isProtoIdentifier(column.name)) {
        ds.push({ severity: 'error', code: ExportCode.protoInvalidName, table: table.name, field: column.name, params: { name: column.name, proto: column.name } });
      }
    }
    for (const [a, b] of protoFieldConflicts(columns)) {
      ds.push({ severity: 'error', code: ExportCode.protoFieldConflict, table: table.name, field: b, params: { field: b, other: a } });
    }
  }
  return ds;
}

/**
 * 出力するファイルを返す（core は書き込まない）。検査でエラーがあれば、force でない限り files は空で ok は false。
 * 読み込みエラーのテーブル（P-40）は force でも出力しない
 */
export function planExport(project: Project, calc: Calculator, options: ExportOptions = {}): ExportResult {
  const paths = resolveProjectPaths(project.config);
  const format = options.format ?? paths.outputFormat;
  const outDir = options.outDir === undefined ? paths.outDir : normalizeDir(options.outDir);
  const diagnostics: Diagnostic[] = [...project.diagnostics, ...validateCommon(project, calc)];

  const all: (Table | BrokenTable)[] = [...project.tables, ...project.brokenTables].sort((a, b) =>
    compareNames(a.name, b.name),
  );
  let selected = all;
  if (options.tables !== undefined) {
    const wanted = new Set(options.tables);
    selected = all.filter((t) => wanted.has(t.name));
    for (const name of options.tables) {
      if (!all.some((t) => t.name === name)) {
        diagnostics.push({ severity: 'error', code: ExportCode.unknownTable, table: name, params: { name } });
      }
    }
  }
  for (const table of selected) {
    diagnostics.push(...table.diagnostics);
    if (table.kind === 'table') diagnostics.push(...validateTable(project, calc, table));
  }

  const tables = selected.filter((t): t is Table => t.kind === 'table');
  // 名前の重なりは force でも出さない（protoc が読めないスキーマになる）
  const blocking = format === 'protobuf' ? protobufDiagnostics(calc, all, tables) : [];
  diagnostics.push(...blocking);

  const force = options.force === true;
  const blocked = blocking.length > 0;
  if (blocked || (hasErrors(diagnostics) && !force)) return { ok: false, blocked, files: [], diagnostics };

  const files: ExportFile[] = [];
  let failed = false;
  for (const table of tables) {
    try {
      for (const file of exportTableFiles(calc, table, format)) {
        files.push({ path: joinPath(outDir, file.name), table: table.name, content: file.content });
      }
    } catch (e) {
      // DR-35: NaN・Infinity は書き出せない（ファイルの値も式の結果も型の検査で除かれるので、通常は起きない）
      if (!(e instanceof SerializeError)) throw e;
      diagnostics.push({ severity: 'error', code: e.code, table: table.name, params: e.params });
      failed = true;
    }
  }
  if (failed && !force) return { ok: false, blocked: false, files: [], diagnostics };
  return { ok: true, blocked: false, files, diagnostics };
}
