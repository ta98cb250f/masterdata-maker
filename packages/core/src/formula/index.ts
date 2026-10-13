// 数式エンジンの公開 API

export {
  DateTimeValue,
  EMPTY,
  ERROR_CODES,
  EmptyValue,
  FList,
  FormulaError,
  INT64_MAX,
  INT64_MIN,
  inInt64Range,
  isEmpty,
  isError,
} from './values';
export type { ErrorCode, FValue, MessageArgs, Scalar } from './values';

export {
  FORMULA_MESSAGE_CODES,
  circularReference,
  formulaError,
  refColumnNotFound,
  refKeyNotFound,
  refTableNotFound,
} from './errors';
export type { FormulaMessageCode } from './errors';

export { stripFormulaPrefix, tokenize } from './lexer';
export type { LexResult, Token, TokenType } from './lexer';

export { unwrapGroup, walk } from './ast';
export type { BinaryOp, CallNode, ColumnNode, Node, UnaryOp } from './ast';

export { ParseCache, parseFormula } from './parser';
export type { ParseResult, ParsedFormula } from './parser';

export { extractDependencies } from './dependencies';
export type { FormulaDependencies, RefDependency } from './dependencies';

export { renameColumnInFormula, renameRefColumnInFormula, renameRefTableInFormula } from './rename';

export { evaluate, evaluateFormula } from './evaluate';
export type { EvalScope } from './context';

export { FUNCTION_NAMES, VOLATILE_FUNCTIONS } from './functions';

export {
  compareValues,
  displayValue,
  numberToText,
  parseNumericString,
  scalarToText,
  toBoolean,
} from './coerce';

export { checkResultType, listElementType, rawToValue, valueTypeName } from './resultType';
export type { FieldType, RawValue, ResultTypeCheck, ResultTypeOptions, ScalarFieldType } from './resultType';
