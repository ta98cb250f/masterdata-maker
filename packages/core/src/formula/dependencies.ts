// 依存関係の抽出（FR-FML-08、FR-FML-11）

import { walk } from './ast';
import { refTarget } from './functions/ref';
import type { Node } from './ast';
import type { FormulaError } from './values';

export interface RefDependency {
  table: string;
  /** 小文字にした列名 */
  column: string;
}

export interface FormulaDependencies {
  /** 同じレコードの列（小文字） */
  columns: Set<string>;
  /** REF で参照する他のテーブルの列（重複なし、出てきた順） */
  refs: RefDependency[];
  /** 静的なエラー（REF の第 1・第 3 引数が文字列リテラルでない。P-31） */
  errors: FormulaError[];
}

/** 構文木から依存関係を抜き出す。文字列リテラルの中の語は依存とみなさない */
export function extractDependencies(ast: Node): FormulaDependencies {
  const columns = new Set<string>();
  const refs: RefDependency[] = [];
  const seen = new Set<string>();
  const errors: FormulaError[] = [];
  walk(ast, (n) => {
    if (n.type === 'column') {
      columns.add(n.name);
    } else if (n.type === 'call' && n.name === 'REF' && n.args.length === 3) {
      const t = refTarget(n.args);
      if ('error' in t) {
        errors.push(t.error);
        return;
      }
      const key = `${t.table}\u0000${t.column}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ table: t.table, column: t.column });
      }
    }
  });
  return { columns, refs, errors };
}
