// 版を指定した出力（FR-OUT-07、P-64）。`version` 列が指定の版以下のレコードだけを残したプロジェクトの写しを作る。
// 写しで計算と検査をやり直すので、除いたレコードへの ref と REF は、参照先が無いエラーとして見つかる
import type { Diagnostic } from '../model/diagnostic';
import type { Project } from '../model/project';
import type { Table } from '../model/table';
import { Calculator } from '../calc';
import type { SemVer } from '../sheet/compare';
import { compareSemverParsed, parseSemver } from '../sheet/compare';
import { ExportCode } from './codes';

/** 版で絞り込む列（並べ替えの semver と同じく、列名で判定する。P-57） */
export const VERSION_COLUMN = 'version';

export interface VersionSelection {
  /** 指定の版以下のレコードだけを残したプロジェクト（テーブルの順と、残したレコードの順は元のまま） */
  project: Project;
  /** 写しの計算 */
  calc: Calculator;
  /** semver として読めない version のレコード（出力から除く） */
  diagnostics: Diagnostic[];
}

/**
 * version が target 以下のレコードだけを残す。version が未入力（空文字を含む）のレコードは版に依らず残す。
 * version 列の無いテーブルはすべてのレコードを残す
 */
export function selectByVersion(project: Project, calc: Calculator, target: SemVer): VersionSelection {
  const diagnostics: Diagnostic[] = [];
  const tables = project.tables.map((table): Table => {
    if (!calc.columns(table).some((c) => c.name === VERSION_COLUMN)) return table;
    const records = table.records.filter((record) => {
      const res = calc.getCell(table, record.uid, VERSION_COLUMN);
      if (res.error === undefined && (res.raw === undefined || res.raw === '')) return true;
      const parsed = typeof res.raw === 'string' && res.error === undefined ? parseSemver(res.raw) : null;
      if (parsed !== null) return compareSemverParsed(parsed, target) <= 0;
      diagnostics.push({
        severity: 'error',
        code: ExportCode.invalidRecordVersion,
        file: table.source?.path,
        table: table.name,
        recordUid: record.uid,
        recordKey: calc.recordKey(table, record),
        field: VERSION_COLUMN,
        params: { value: res.error !== undefined ? res.error.code : String(res.raw) },
      });
      return false;
    });
    return records.length === table.records.length ? table : { ...table, records };
  });
  const selected: Project = { ...project, tables };
  return { project: selected, calc: new Calculator(selected, { parseCache: calc.parseCache }), diagnostics };
}
