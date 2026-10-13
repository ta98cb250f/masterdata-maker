// 構文木の評価。eval や Function は使わない（FR-FML-15）

import { applyBinary, applyNegate, applyPercent } from './arith';
import { unwrapGroup } from './ast';
import { formulaError } from './errors';
import { FUNCTIONS, VOLATILE_FUNCTIONS } from './functions';
import { parseFormula } from './parser';
import { EMPTY, FormulaError } from './values';
import type { CallNode, Node } from './ast';
import type { EvalContext, EvalScope, FnArg, FunctionDef } from './context';
import type { FValue } from './values';

class LazyArg implements FnArg {
  readonly isReference: boolean;
  private evaluated = false;
  private cached: FValue = EMPTY;

  constructor(
    readonly node: Node,
    private readonly ctx: EvalContext,
  ) {
    this.isReference = unwrapGroup(node).type === 'column';
  }

  value(): FValue {
    if (!this.evaluated) {
      this.cached = this.ctx.evaluate(this.node);
      this.evaluated = true;
    }
    return this.cached;
  }
}

function argCountError(name: string, def: FunctionDef, actual: number): FormulaError {
  if (def.minArgs === def.maxArgs) {
    return formulaError('#N/A', 'formula.argCount.exact', { name, expected: def.minArgs, actual });
  }
  if (def.maxArgs === Infinity) {
    return formulaError('#N/A', 'formula.argCount.atLeast', { name, min: def.minArgs, actual });
  }
  return formulaError('#N/A', 'formula.argCount.range', {
    name,
    min: def.minArgs,
    max: def.maxArgs,
    actual,
  });
}

class Evaluator implements EvalContext {
  readonly timeZone: string;

  constructor(readonly scope: EvalScope) {
    this.timeZone = scope.timeZone;
  }

  /** ノードを評価する。ここで生じた位置なしのエラーには、このノードの位置を付ける */
  evaluate(node: Node): FValue {
    const v = this.evalNode(node);
    return v instanceof FormulaError && !v.hasPosition ? v.at(node.start, node.end) : v;
  }

  private evalNode(node: Node): FValue {
    switch (node.type) {
      case 'number':
      case 'string':
      case 'boolean':
        return node.value;
      case 'blank':
        return EMPTY;
      case 'group':
        return this.evaluate(node.expr);
      case 'column': {
        const v = this.scope.column(node.name);
        if (v === undefined) return formulaError('#NAME?', 'formula.unknownColumn', { name: node.name });
        // 参照先のセルのエラーには、この式の中の参照の位置を付ける
        return v instanceof FormulaError ? v.propagatedAt(node.start, node.end) : v;
      }
      case 'unary': {
        const v = this.evaluate(node.operand);
        // 単項の + は値をそのまま返す
        return node.op === '-' ? applyNegate(v, this.timeZone) : v;
      }
      case 'percent':
        return applyPercent(this.evaluate(node.operand), this.timeZone);
      case 'binary': {
        const left = this.evaluate(node.left);
        // 左がエラーなら結果は左のエラーなので、右は評価しない（結果は同じ）
        if (left instanceof FormulaError) return left;
        return applyBinary(node.op, left, this.evaluate(node.right), this.timeZone);
      }
      case 'call':
        return this.call(node);
    }
  }

  private call(node: CallNode): FValue {
    const name = node.name;
    if (VOLATILE_FUNCTIONS.has(name)) {
      return formulaError('#NAME?', 'formula.volatileFunction', { name }).at(node.nameStart, node.nameEnd);
    }
    const def = FUNCTIONS.get(name);
    if (def === undefined) {
      return formulaError('#NAME?', 'formula.unknownFunction', { name }).at(node.nameStart, node.nameEnd);
    }
    const n = node.args.length;
    if (n < def.minArgs || n > def.maxArgs) {
      return argCountError(name, def, n).at(node.nameStart, node.nameEnd);
    }
    const args = node.args.map((a) => new LazyArg(a, this));
    return def.call(args, this, node, name);
  }
}

/** 構文木を評価する。構文木は変更しないので、同じ構文木を何度でも評価できる */
export function evaluate(ast: Node, scope: EvalScope): FValue {
  return new Evaluator(scope).evaluate(ast);
}

/** 式のテキストを構文解析して評価する（構文エラーなら #ERROR!） */
export function evaluateFormula(text: string, scope: EvalScope): FValue {
  const parsed = parseFormula(text);
  return parsed.ok ? evaluate(parsed.ast, scope) : parsed.error;
}
