// 版を指定した出力（FR-OUT-07、P-64）。`version` 列が指定の版以下のレコードだけを残したプロジェクトの写しを作る。
// 写しで計算と検査をやり直すので、除いたレコードへの ref と REF は、参照先が無いエラーとして見つかる
import type { Diagnostic } from '../model/diagnostic';
import type { Project } from '../model/project';
import type { Table } from '../model/table';
import { Calculator } from '../calc';
import type { SemVer } from '../sheet/compare';
import { compareSemverParsed, parseSemver } from '../sheet/compare';
import { parseRef } from '../validate/fields';
import { formulaIssue } from '../validate/formula';
import { rawText } from '../validate/values';
import { ExportCode } from './codes';

/** 版で絞り込む列（並べ替えの semver と同じく、列名で判定する。P-57） */
export const VERSION_COLUMN = 'version';

export interface VersionSelection {
  /** 指定の版以下のレコードだけを残したプロジェクト（テーブルの順と、残したレコードの順は元のまま） */
  project: Project;
  /** 写しの計算（何も除かなければ元の計算をそのまま使う） */
  calc: Calculator;
  /** 版を比べられなかったレコード（式のエラー、semver として読めない値）。すべてのテーブルの分 */
  diagnostics: Diagnostic[];
}

/**
 * version が target 以下のレコードだけを残す。比べるのは実効値（default や式があればその値。P-10）で、
 * 未入力（空文字を含む）のレコードは版に依らず残す。version 列の無いテーブルはすべてのレコードを残す。
 * 残すかどうかは元のプロジェクトの値で決める（version の式が除いたレコードを参照していても、判定は変えない）
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
      // 式のエラーは検査と同じ診断にする（写しから除くので、写しの検査では出ない）
      const issue =
        res.error !== undefined
          ? formulaIssue(res.error)
          : { code: ExportCode.invalidRecordVersion, params: { value: rawText(res.raw as NonNullable<typeof res.raw>) } };
      diagnostics.push({
        severity: 'error',
        code: issue.code,
        file: table.source?.path,
        table: table.name,
        recordUid: record.uid,
        recordKey: calc.recordKey(table, record),
        field: VERSION_COLUMN,
        params: issue.params,
      });
      return false;
    });
    return records.length === table.records.length ? table : { ...table, records };
  });
  if (tables.every((table, i) => table === project.tables[i])) return { project, calc, diagnostics };
  const selected: Project = { ...project, tables };
  return { project: selected, calc: new Calculator(selected, { parseCache: calc.parseCache }), diagnostics };
}

/**
 * names のテーブルから ref と REF でたどれるテーブル（names を含む）。版で除いたレコードへの参照切れの原因
 * （参照先のテーブルの版を比べられなかったレコード）を、選んだテーブルの出力でも示すために使う
 */
export function referencedTables(calc: Calculator, names: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const queue = [...names];
  while (queue.length > 0) {
    const name = queue.pop() as string;
    const table = calc.findTable(name);
    if (table === undefined || seen.has(table.name)) continue;
    seen.add(table.name);
    for (const column of calc.columns(table)) {
      const target = column.ref === undefined ? null : parseRef(column.ref);
      if (target !== null) queue.push(target.table);
    }
    queue.push(...calc.formulaRefTables(table));
  }
  return seen;
}
