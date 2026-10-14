// 検査の診断コード。文言は i18n/locales/<locale>/validate.json に置く
export const ValidateCode = {
  // 式（FR-FML-12、FR-FML-13）
  formulaError: 'validate.formulaError',
  formulaErrorPropagated: 'validate.formulaErrorPropagated',
  formulaResultType: 'validate.formulaResultType',
  columnFormulaError: 'validate.columnFormulaError',

  // 値の型（FR-VAL-03）
  typeMismatch: 'validate.typeMismatch',
  notInteger: 'validate.notInteger',
  intOutOfRange: 'validate.intOutOfRange',
  invalidDateTime: 'validate.invalidDateTime',
  notInEnum: 'validate.notInEnum',
  listElementTypeMismatch: 'validate.listElementTypeMismatch',
  listElementNotInteger: 'validate.listElementNotInteger',
  listElementOutOfRange: 'validate.listElementOutOfRange',
  listElementInvalidDateTime: 'validate.listElementInvalidDateTime',
  listElementNotInEnum: 'validate.listElementNotInEnum',
  refNotFound: 'validate.refNotFound',
  listElementRefNotFound: 'validate.listElementRefNotFound',
  primaryKeyMissing: 'validate.primaryKeyMissing',
  primaryKeyDuplicate: 'validate.primaryKeyDuplicate',

  // 列ごとのルール（FR-VAL-04）
  required: 'validate.required',
  belowMin: 'validate.belowMin',
  aboveMax: 'validate.aboveMax',
  listElementBelowMin: 'validate.listElementBelowMin',
  listElementAboveMax: 'validate.listElementAboveMax',
  tooLong: 'validate.tooLong',
  listElementTooLong: 'validate.listElementTooLong',
  tooManyItems: 'validate.tooManyItems',
  regexMismatch: 'validate.regexMismatch',
  listElementRegexMismatch: 'validate.listElementRegexMismatch',
  duplicateValue: 'validate.duplicateValue',

  // 警告（FR-VAL-05）
  warnAbove: 'validate.warnAbove',
  warnBelow: 'validate.warnBelow',
  listElementWarnAbove: 'validate.listElementWarnAbove',
  listElementWarnBelow: 'validate.listElementWarnBelow',
  warnDeviation: 'validate.warnDeviation',

  // 列定義（FR-VAL-07）
  duplicateColumn: 'validate.duplicateColumn',
  duplicateBaseColumn: 'validate.duplicateBaseColumn',
  invalidColumnName: 'validate.invalidColumnName',
  enumRefMissing: 'validate.enumRefMissing',
  enumNotFound: 'validate.enumNotFound',
  refInvalidFormat: 'validate.refInvalidFormat',
  refTableNotFound: 'validate.refTableNotFound',
  refColumnNotFound: 'validate.refColumnNotFound',
  refTargetNotUnique: 'validate.refTargetNotUnique',
  refTypeMismatch: 'validate.refTypeMismatch',
  multiplePrimary: 'validate.multiplePrimary',
  autoNotAllowed: 'validate.autoNotAllowed',
  ruleNotApplicable: 'validate.ruleNotApplicable',
  invalidRuleValue: 'validate.invalidRuleValue',
  minGreaterThanMax: 'validate.minGreaterThanMax',
  invalidRegex: 'validate.invalidRegex',
  invalidDefault: 'validate.invalidDefault',

  // 共通設定
  duplicateEnum: 'validate.duplicateEnum',
  duplicateEnumValue: 'validate.duplicateEnumValue',
  duplicateColor: 'validate.duplicateColor',
} as const;

export type ValidateCodeValue = (typeof ValidateCode)[keyof typeof ValidateCode];
