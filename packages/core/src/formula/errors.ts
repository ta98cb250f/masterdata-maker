// 式のエラーのメッセージコードと、エラーを作る関数。
// 文言は i18n/locales/{ja,en}/formula.json に置く（キーはここのコードそのもの）

import { FormulaError } from './values';
import type { ErrorCode, MessageArgs } from './values';

export const FORMULA_MESSAGE_CODES = [
  // 構文エラー（#ERROR!）
  'formula.syntax.empty',
  'formula.syntax.unexpectedChar',
  'formula.syntax.unterminatedString',
  'formula.syntax.unexpectedToken',
  'formula.syntax.unexpectedEnd',
  'formula.syntax.missingCloseParen',
  'formula.syntax.tooDeep',
  'formula.ref.literalRequired',
  // 名前（#NAME?）
  'formula.unknownColumn',
  'formula.unknownFunction',
  'formula.volatileFunction',
  // 引数の数（#N/A）
  'formula.argCount.exact',
  'formula.argCount.range',
  'formula.argCount.atLeast',
  // 値の変換（#VALUE!）
  'formula.operandNotNumber',
  'formula.argNotNumber',
  'formula.argNotBoolean',
  'formula.listAsScalar',
  'formula.int64MixedWithFloat',
  'formula.argTooSmall',
  'formula.noLogicalValues',
  'formula.invalidDateTime',
  // 数値（#DIV/0!・#NUM!）
  'formula.divByZero',
  'formula.numInvalid',
  'formula.int64Overflow',
  'formula.int64NotDivisible',
  'formula.int64NegativeExponent',
  'formula.sqrtNegative',
  'formula.signMismatch',
  'formula.noNumbers',
  'formula.dateYearOutOfRange',
  'formula.dateOutOfRange',
  // REF と循環参照（ホスト側が使う）
  'formula.ref.tableNotFound',
  'formula.ref.columnNotFound',
  'formula.ref.keyNotFound',
  'formula.circular',
  // 結果の型の検査
  'formula.result.typeMismatch',
  'formula.result.notInteger',
  'formula.result.outOfRange',
  'formula.result.notInEnum',
  'formula.result.listElementTypeMismatch',
  'formula.result.listElementNotInteger',
  'formula.result.listElementOutOfRange',
  'formula.result.listElementNotInEnum',
  'formula.result.listElementEmpty',
] as const;

export type FormulaMessageCode = (typeof FORMULA_MESSAGE_CODES)[number];

/** 位置なしのエラーを作る（位置は評価器がノードの位置を付ける） */
export function formulaError(
  code: ErrorCode,
  messageCode: FormulaMessageCode,
  messageArgs: MessageArgs = {},
): FormulaError {
  return new FormulaError(code, messageCode, messageArgs);
}

/** REF の参照先のテーブルが無い（P-31）。EvalScope.ref の実装で使う */
export function refTableNotFound(table: string): FormulaError {
  return formulaError('#REF!', 'formula.ref.tableNotFound', { table });
}

/** REF の参照先の列が無い（P-31） */
export function refColumnNotFound(table: string, column: string): FormulaError {
  return formulaError('#REF!', 'formula.ref.columnNotFound', { table, column });
}

/** REF のキーが見つからない（P-31。VLOOKUP と同じ #N/A）。key は表示用の文字列 */
export function refKeyNotFound(table: string, key: string): FormulaError {
  return formulaError('#N/A', 'formula.ref.keyNotFound', { table, key });
}

/** 循環参照（P-33） */
export function circularReference(): FormulaError {
  return formulaError('#REF!', 'formula.circular');
}
