// 検査の依存関係（FR-VAL-09、NFR-12）。画面で、変更のあったテーブルとそれを参照するテーブルだけを検査し直すのに使う
import type { Project } from '../model/project';
import type { Table } from '../model/table';
import type { Calculator } from '../calc';
import { parseRef } from './fields';

/**
 * テーブルの検査結果が直接依存するテーブル（列の ref の参照先と、式の REF の参照先）。自分自身は含めない。
 * 名前の昇順
 */
export function validationDependencies(calc: Calculator, table: Table): string[] {
  const deps = new Set<string>();
  for (const column of calc.columns(table)) {
    if (column.ref === undefined) continue;
    const target = parseRef(column.ref);
    if (target !== null) deps.add(target.table);
  }
  for (const name of calc.formulaRefTables(table)) deps.add(name);
  deps.delete(table.name);
  return [...deps].sort();
}

/**
 * 変更のあったテーブルによって検査結果が変わりうるテーブル（変更のあったテーブル自身と、
 * それを直接・間接に参照するテーブル）。名前の昇順
 */
export function affectedTables(project: Project, calc: Calculator, changed: Iterable<string>): string[] {
  const dependents = new Map<string, Set<string>>();
  for (const table of project.tables) {
    for (const dep of validationDependencies(calc, table)) {
      let set = dependents.get(dep);
      if (set === undefined) {
        set = new Set();
        dependents.set(dep, set);
      }
      set.add(table.name);
    }
  }
  const result = new Set<string>();
  const queue = [...changed];
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (result.has(name)) continue;
    result.add(name);
    for (const d of dependents.get(name) ?? []) queue.push(d);
  }
  return [...result].sort();
}
