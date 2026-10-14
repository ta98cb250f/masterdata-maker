// 出力ファイルの生成（§9.1、FR-OUT-01〜05）。1 テーブル＝1 ファイル＝レコードの配列
import type { RawValue } from '../model/cell';
import type { Diagnostic } from '../model/diagnostic';
import { hasErrors } from '../model/diagnostic';
import type { FieldDef, FieldType } from '../model/field';
import { elementType, isFieldExported, isListType } from '../model/field';
import type { OutputFormat, Project } from '../model/project';
import { compareNames, joinPath, normalizeDir, resolveProjectPaths } from '../model/project';
import type { BrokenTable, Table } from '../model/table';
import type { Calculator } from '../calc';
import type { OutNode } from '../io/emit';
import { emitJson, emitYaml, map, scalar, seq, SerializeError } from '../io/emit';
import { validateCommon, validateTable } from '../validate';
import { ExportCode } from './codes';

export interface ExportOptions {
  /** 出力するテーブル（省略時はすべて） */
  tables?: readonly string[];
  /** 検査エラーがあっても出力する（FR-OUT-05） */
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
  text: string;
}

export interface ExportResult {
  /** 出力してよいか（エラーが無い、または force） */
  ok: boolean;
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

/**
 * テーブルの出力ファイルのテキスト（FR-OUT-02〜04）。キーは列の順（共通列が先）で、export: false の列と
 * 列定義に無いキーは出さない。式は計算結果、未入力は default か null（実効値。P-10）
 */
export function exportTableText(calc: Calculator, table: Table, format: OutputFormat): string {
  const columns = uniqueColumns(calc.columns(table)).filter(isFieldExported);
  const rows = table.records.map((record) =>
    map(
      columns.map((column): [string, OutNode] => [
        column.name,
        outValue(calc.getCell(table, record.uid, column.name).raw, column.type),
      ]),
      false,
    ),
  );
  const root = seq(rows, false);
  return format === 'yaml' ? emitYaml(root) : emitJson(root);
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

  const force = options.force === true;
  if (hasErrors(diagnostics) && !force) return { ok: false, files: [], diagnostics };

  const ext = format === 'yaml' ? 'yaml' : 'json';
  const files: ExportFile[] = [];
  let failed = false;
  for (const table of selected) {
    if (table.kind !== 'table') continue;
    try {
      files.push({ path: joinPath(outDir, `${table.name}.${ext}`), table: table.name, text: exportTableText(calc, table, format) });
    } catch (e) {
      // DR-35: NaN・Infinity は書き出せない（式の結果は型の検査で除かれるので、通常は起きない）
      if (!(e instanceof SerializeError)) throw e;
      diagnostics.push({ severity: 'error', code: e.code, table: table.name, params: e.params });
      failed = true;
    }
  }
  if (failed && !force) return { ok: false, files: [], diagnostics };
  return { ok: true, files, diagnostics };
}
