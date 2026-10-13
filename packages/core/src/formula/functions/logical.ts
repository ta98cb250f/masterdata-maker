// 論理: IF AND OR NOT（TRUE() / FALSE() も）

import { dateTimeToSerial } from '../coerce';
import { formulaError } from '../errors';
import { DateTimeValue, EmptyValue, FList, FormulaError } from '../values';
import { argNotBoolean, boolArg } from './helpers';
import type { EvalContext, FnArg, FunctionDef } from '../context';
import type { Scalar } from '../values';

/** IF は選ばれなかった側を評価しない（FR-FML-10）。偽を省略して条件が偽なら FALSE */
const IF: FunctionDef = {
  minArgs: 2,
  maxArgs: 3,
  call(args, ctx, _node, name) {
    const cond = boolArg(args[0], name, 1, ctx);
    if (cond instanceof FormulaError) return cond;
    if (cond) return args[1].value();
    return args.length > 2 ? args[2].value() : false;
  },
};

/** 範囲の要素を真偽値にする。文字列と空は無視する（undefined） */
function rangeItemToBool(v: Exclude<Scalar, FormulaError>, ctx: EvalContext): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'bigint') return v !== 0n;
  if (v instanceof DateTimeValue) return dateTimeToSerial(v, ctx.timeZone) !== 0;
  return undefined;
}

/**
 * AND / OR の引数の論理値を集める。
 * - 短絡しない（全引数を評価し、最初のエラーを返す）
 * - 範囲（リストと列の参照）の中の文字列と空は無視する
 * - 直接の引数の文字列は "TRUE" / "FALSE" だけ受け付け、それ以外は #VALUE!。直接の空は無視する
 * - 論理値が 1 つも無ければ #VALUE!
 * （Excel の公式ヘルプの規則に合わせた。Googleスプレッドシートでは未検証）
 */
function logicalValues(args: readonly FnArg[], ctx: EvalContext, name: string): boolean[] | FormulaError {
  const out: boolean[] = [];
  for (let i = 0; i < args.length; i++) {
    const v = args[i].value();
    if (v instanceof FormulaError) return v;
    if (v instanceof FList || args[i].isReference) {
      const items = v instanceof FList ? v.items : [v];
      for (const item of items) {
        if (item instanceof FormulaError) return item;
        const b = rangeItemToBool(item, ctx);
        if (b !== undefined) out.push(b);
      }
      continue;
    }
    if (v instanceof EmptyValue) continue;
    if (typeof v === 'string') {
      const u = v.toUpperCase();
      if (u !== 'TRUE' && u !== 'FALSE') return argNotBoolean(name, i + 1, v, ctx);
      out.push(u === 'TRUE');
      continue;
    }
    const b = rangeItemToBool(v, ctx);
    if (b !== undefined) out.push(b);
  }
  if (out.length === 0) return formulaError('#VALUE!', 'formula.noLogicalValues', { name });
  return out;
}

const AND: FunctionDef = {
  minArgs: 1,
  maxArgs: Infinity,
  call(args, ctx, _node, name) {
    const values = logicalValues(args, ctx, name);
    return values instanceof FormulaError ? values : values.every((b) => b);
  },
};

const OR: FunctionDef = {
  minArgs: 1,
  maxArgs: Infinity,
  call(args, ctx, _node, name) {
    const values = logicalValues(args, ctx, name);
    return values instanceof FormulaError ? values : values.some((b) => b);
  },
};

const NOT: FunctionDef = {
  minArgs: 1,
  maxArgs: 1,
  call(args, ctx, _node, name) {
    const b = boolArg(args[0], name, 1, ctx);
    return b instanceof FormulaError ? b : !b;
  },
};

const TRUE_FN: FunctionDef = { minArgs: 0, maxArgs: 0, call: () => true };
const FALSE_FN: FunctionDef = { minArgs: 0, maxArgs: 0, call: () => false };

export const logicalFunctions: Readonly<Record<string, FunctionDef>> = {
  IF,
  AND,
  OR,
  NOT,
  TRUE: TRUE_FN,
  FALSE: FALSE_FN,
};

