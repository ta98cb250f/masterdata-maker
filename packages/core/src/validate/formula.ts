// 式のエラーの診断（FR-FML-13）と、列レベル式の静的な検査（構文・列名・関数名・引数の数・REF の参照先）
import type { DiagnosticParams } from '../model/diagnostic';
import type { Calculator } from '../calc';
import { formulaError, refColumnNotFound, refTableBroken, refTableNotFound, walk } from '../formula';
import type { FormulaError } from '../formula';
import { FUNCTIONS, VOLATILE_FUNCTIONS } from '../formula/functions';
import { refTarget } from '../formula/functions/ref';
import { ValidateCode } from './codes';
import type { Issue } from './values';

/** 入れ子のメッセージの引数の接頭辞（formatDiagnostic が展開する） */
export const CAUSE_PREFIX = 'cause.';

/** 入れ子のメッセージ（cause）を持つ引数を作る */
export function withCause(params: DiagnosticParams, causeCode: string, causeParams: DiagnosticParams): DiagnosticParams {
  const out: Record<string, string | number> = { ...params, cause: causeCode };
  for (const [k, v] of Object.entries(causeParams)) out[`${CAUSE_PREFIX}${k}`] = v;
  return out;
}

/**
 * 式のエラーを診断のコードと引数にする。エラーの種類・式の中の位置（1 から数える）・元のエラーの文言を持つ。
 * 参照先から伝わってきたエラーは、参照の位置と、たどった元のエラーの文言にする
 */
export function formulaIssue(e: FormulaError, columnLevel = false): Issue {
  const origin = e.origin;
  const base: Record<string, string | number> = { error: e.code };
  if (e.position !== undefined) base.position = e.position;
  const params = withCause(base, origin.messageCode, origin.messageArgs);
  let code: string;
  if (columnLevel) code = ValidateCode.columnFormulaError;
  else if (e.cause !== undefined) code = ValidateCode.formulaErrorPropagated;
  else if (e.position === undefined) code = ValidateCode.formulaResultType;
  else code = ValidateCode.formulaError;
  return { code, params };
}

/**
 * 式の静的なエラー。columns は式の中で使える列名（小文字）。null なら列名は検査しない
 */
export function staticFormulaErrors(calc: Calculator, text: string, columns: ReadonlySet<string> | null): FormulaError[] {
  const parsed = calc.parse(text);
  if (!parsed.ok) return [parsed.error];
  const errors: FormulaError[] = [];
  walk(parsed.ast, (n) => {
    if (n.type === 'column') {
      if (columns !== null && !columns.has(n.name)) {
        errors.push(formulaError('#NAME?', 'formula.unknownColumn', { name: n.name }).at(n.start, n.end));
      }
      return;
    }
    if (n.type !== 'call') return;
    const name = n.name;
    if (VOLATILE_FUNCTIONS.has(name)) {
      errors.push(formulaError('#NAME?', 'formula.volatileFunction', { name }).at(n.nameStart, n.nameEnd));
      return;
    }
    const def = FUNCTIONS.get(name);
    if (def === undefined) {
      errors.push(formulaError('#NAME?', 'formula.unknownFunction', { name }).at(n.nameStart, n.nameEnd));
      return;
    }
    const actual = n.args.length;
    if (actual < def.minArgs || actual > def.maxArgs) {
      const e =
        def.minArgs === def.maxArgs
          ? formulaError('#N/A', 'formula.argCount.exact', { name, expected: def.minArgs, actual })
          : def.maxArgs === Infinity
            ? formulaError('#N/A', 'formula.argCount.atLeast', { name, min: def.minArgs, actual })
            : formulaError('#N/A', 'formula.argCount.range', { name, min: def.minArgs, max: def.maxArgs, actual });
      errors.push(e.at(n.nameStart, n.nameEnd));
      return;
    }
    if (name !== 'REF') return;
    // P-31: REF のテーブル名と列名は文字列リテラル。参照先が無ければ #REF!
    const target = refTarget(n.args);
    if ('error' in target) {
      errors.push(target.error);
      return;
    }
    const table = calc.findTable(target.table);
    if (table === undefined) {
      errors.push((calc.isBrokenTable(target.table) ? refTableBroken(target.table) : refTableNotFound(target.table)).at(n.start, n.end));
    } else if (!calc.columns(table).some((c) => c.name.toLowerCase() === target.column)) {
      errors.push(refColumnNotFound(target.table, target.column).at(n.start, n.end));
    }
  });
  return errors;
}
