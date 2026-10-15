// 独自の関数 REF(テーブル名, キーまたはキーのリスト, 列名)（FR-FML-04、P-31）

import { formulaError } from '../errors';
import { FList, FormulaError } from '../values';
import type { Node } from '../ast';
import type { FunctionDef } from '../context';
import type { FValue, Scalar } from '../values';

/** REF の第 1・第 3 引数は文字列リテラルに限る。そうでなければ静的なエラー */
export function refLiteralError(arg: Node, index: number): FormulaError {
  return formulaError('#ERROR!', 'formula.ref.literalRequired', { index }).at(arg.start, arg.end);
}

/** REF の引数から、静的に決まるテーブル名と列名を取り出す */
export function refTarget(
  args: readonly Node[],
): { table: string; column: string } | { error: FormulaError } {
  const t = args[0];
  const c = args[2];
  if (t.type !== 'string') return { error: refLiteralError(t, 1) };
  if (c.type !== 'string') return { error: refLiteralError(c, 3) };
  return { table: t.value, column: c.value.toLowerCase() };
}

/**
 * キーが単一の値なら参照先の値、リストなら要素ごとの値の FList を返す。
 * 要素の 1 つでもエラーならそのエラー。参照先の値がリストのときは平らにする
 */
const REF: FunctionDef = {
  minArgs: 3,
  maxArgs: 3,
  call(args, ctx, node) {
    const target = refTarget(args.map((a) => a.node));
    if ('error' in target) return target.error;
    const key = args[1].value();
    if (key instanceof FormulaError) return key;
    const lookup = (k: Scalar): FValue => {
      const r = ctx.scope.ref(target.table, k, target.column);
      return r instanceof FormulaError ? r.propagatedAt(node.start, node.end) : r;
    };
    if (!(key instanceof FList)) return lookup(key);
    const out: Scalar[] = [];
    for (const k of key.items) {
      if (k instanceof FormulaError) return k;
      const r = lookup(k);
      if (r instanceof FormulaError) return r;
      if (r instanceof FList) {
        for (const item of r.items) {
          if (item instanceof FormulaError) return item.propagatedAt(node.start, node.end);
          out.push(item);
        }
      } else {
        out.push(r);
      }
    }
    return new FList(out);
  },
};

export const refFunctions: Readonly<Record<string, FunctionDef>> = { REF };
