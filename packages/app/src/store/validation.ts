// 検査（FR-VAL-09）。検査の呼び出しはここにまとめる（後の段階で Web Worker に差し替える。FR-VAL-10）
import type { Calculator, Diagnostic, MessageParams, Patch, Project, Severity } from '@sheetcraft/core';
import { patchTable, validateCommon, validateTable } from '@sheetcraft/core';
import type { TableIssues } from './types';

export interface ValidationRequest {
  /** 検査するテーブル名（読み込みエラーのテーブルも含めてよい） */
  tables: readonly string[];
  /** プロジェクト設定・共通設定も検査する */
  common: boolean;
}

export interface ValidationOutput {
  /** テーブル名 → 診断（読み込み時の診断を含む）。要求したテーブルのうち、存在するものだけ */
  tables: Map<string, Diagnostic[]>;
  /** common を要求したときだけ */
  common?: Diagnostic[];
}

/** 検査の実行役。メインスレッドの実装と、後の段階の Worker の実装を差し替えられるようにする */
export interface Validator {
  run(request: ValidationRequest): Promise<ValidationOutput>;
  /** 当てたパッチを知らせる（Worker の実装では、複製のモデルに同じパッチを当てる） */
  notifyPatches?(patches: readonly Patch[]): void;
  dispose?(): void;
}

export type ValidatorFactory = (project: Project, calc: Calculator) => Validator;

/** 利用者に見せる文言を持つ検査の失敗（Worker の時間切れなど。FR-VAL-10）。store は code の文言をそのまま示す */
export class ValidationFailure extends Error {
  constructor(
    readonly code: string,
    readonly params: MessageParams = {},
  ) {
    super(code);
    this.name = 'ValidationFailure';
  }
}

/** その場で検査する（この段階の実装） */
export function runValidation(project: Project, calc: Calculator, request: ValidationRequest): ValidationOutput {
  const tables = new Map<string, Diagnostic[]>();
  for (const name of request.tables) {
    const table = project.tables.find((t) => t.name === name);
    if (table !== undefined) {
      tables.set(name, [...table.diagnostics, ...validateTable(project, calc, table)]);
      continue;
    }
    const broken = project.brokenTables.find((t) => t.name === name);
    if (broken !== undefined) tables.set(name, [...broken.diagnostics]);
  }
  const output: ValidationOutput = { tables };
  if (request.common) output.common = [...project.diagnostics, ...validateCommon(project, calc)];
  return output;
}

export class MainThreadValidator implements Validator {
  constructor(
    private readonly project: Project,
    private readonly calc: Calculator,
  ) {}

  async run(request: ValidationRequest): Promise<ValidationOutput> {
    return runValidation(this.project, this.calc, request);
  }
}

export const mainThreadValidator: ValidatorFactory = (project, calc) => new MainThreadValidator(project, calc);

/** 全テーブル（読み込みエラーのテーブルを含む）の名前 */
export function allTableNames(project: Project): string[] {
  return [...project.tables.map((t) => t.name), ...project.brokenTables.map((t) => t.name)];
}

/**
 * 当てたパッチで変わったテーブル。テーブルの追加・削除・名前の変更、共通設定の変更は all（全体を検査し直す）。
 * 表示設定だけの変更は検査に影響しないので数えない
 */
export function changedTablesOf(project: Project, patches: readonly Patch[]): { tables: Set<string>; all: boolean } {
  const tables = new Set<string>();
  let all = false;
  for (const patch of patches) {
    switch (patch.op) {
      case 'setView':
      case 'setTableDisplayName':
        continue;
      // セル色のプリセットの変更でも、プリセットに無い色の検査結果が変わる
      case 'setCommon':
      case 'setTableName':
      case 'addTable':
      case 'removeTable':
        all = true;
        continue;
      default: {
        const uid = patchTable(patch);
        const table = project.tables.find((t) => t.uid === uid);
        if (table === undefined) all = true;
        else tables.add(table.name);
      }
    }
  }
  return { tables, all };
}

/** 診断をテーブルごとの件数とセルの印にまとめる */
export function summarizeIssues(diagnostics: readonly Diagnostic[]): TableIssues {
  let errors = 0;
  let warnings = 0;
  const cells = new Map<number, Map<string, Severity>>();
  for (const d of diagnostics) {
    if (d.severity === 'error') errors++;
    else warnings++;
    if (d.recordUid === undefined || d.field === undefined) continue;
    let row = cells.get(d.recordUid);
    if (row === undefined) {
      row = new Map();
      cells.set(d.recordUid, row);
    }
    if (row.get(d.field) !== 'error') row.set(d.field, d.severity);
  }
  return { diagnostics, errors, warnings, cells };
}
