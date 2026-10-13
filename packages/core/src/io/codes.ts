// 読み書きの診断コード。文言は i18n/locales/<locale>/io.json に置く
export const IoCode = {
  // テキスト
  bomRemoved: 'io.bomRemoved',
  duplicateKey: 'io.duplicateKey',

  // YAML
  yamlSyntaxError: 'io.yamlSyntaxError',
  yamlMultipleDocuments: 'io.yamlMultipleDocuments',
  yamlAnchorNotAllowed: 'io.yamlAnchorNotAllowed',
  yamlAliasNotAllowed: 'io.yamlAliasNotAllowed',
  yamlTagNotAllowed: 'io.yamlTagNotAllowed',
  yamlVersionNotSupported: 'io.yamlVersionNotSupported',
  yamlComplexKey: 'io.yamlComplexKey',
  yamlUnsupportedValue: 'io.yamlUnsupportedValue',
  yamlParserWarning: 'io.yamlParserWarning',

  // JSON（DR-50）
  jsonUnexpectedChar: 'io.jsonUnexpectedChar',
  jsonUnexpectedEnd: 'io.jsonUnexpectedEnd',
  jsonTrailingComma: 'io.jsonTrailingComma',
  jsonComment: 'io.jsonComment',
  jsonSingleQuote: 'io.jsonSingleQuote',
  jsonUnquotedKey: 'io.jsonUnquotedKey',
  jsonInvalidLiteral: 'io.jsonInvalidLiteral',
  jsonInvalidNumber: 'io.jsonInvalidNumber',
  jsonInvalidEscape: 'io.jsonInvalidEscape',
  jsonControlChar: 'io.jsonControlChar',
  jsonTrailingContent: 'io.jsonTrailingContent',

  // 構造
  rootNotMapping: 'io.rootNotMapping',
  expectedMapping: 'io.expectedMapping',
  expectedList: 'io.expectedList',
  expectedString: 'io.expectedString',
  expectedBoolean: 'io.expectedBoolean',
  expectedInteger: 'io.expectedInteger',
  expectedNumber: 'io.expectedNumber',
  missingKey: 'io.missingKey',
  nullValueIgnored: 'io.nullValueIgnored',
  unknownTableKey: 'io.unknownTableKey',
  unknownFieldKey: 'io.unknownFieldKey',
  fieldKeyBelongsToValidation: 'io.fieldKeyBelongsToValidation',
  fieldKeyBelongsToAnomaly: 'io.fieldKeyBelongsToAnomaly',
  unknownValidationKey: 'io.unknownValidationKey',
  unknownAnomalyKey: 'io.unknownAnomalyKey',
  unknownViewKey: 'io.unknownViewKey',
  unknownRichCellKey: 'io.unknownRichCellKey',
  unknownConfigKey: 'io.unknownConfigKey',
  unknownCommonKey: 'io.unknownCommonKey',
  unknownEnumKey: 'io.unknownEnumKey',
  unknownColorKey: 'io.unknownColorKey',
  unknownFieldType: 'io.unknownFieldType',
  invalidAuto: 'io.invalidAuto',
  invalidBound: 'io.invalidBound',
  invalidDefault: 'io.invalidDefault',
  unsupportedValue: 'io.unsupportedValue',
  nullInList: 'io.nullInList',

  // 値（DR-15、DR-34、DR-42、P-12）
  numberRestoredAsString: 'io.numberRestoredAsString',
  boolRestoredAsString: 'io.boolRestoredAsString',
  nullRestoredAsString: 'io.nullRestoredAsString',
  nullAsEmpty: 'io.nullAsEmpty',
  unknownRecordKey: 'io.unknownRecordKey',

  // プロジェクト（DR-01〜07、P-01、P-02）
  multipleProjectConfigs: 'io.multipleProjectConfigs',
  unsupportedFormatVersion: 'io.unsupportedFormatVersion',
  invalidFormatVersion: 'io.invalidFormatVersion',
  invalidStorageFormat: 'io.invalidStorageFormat',
  invalidOutputFormat: 'io.invalidOutputFormat',
  invalidTimezone: 'io.invalidTimezone',
  multipleCommonFiles: 'io.multipleCommonFiles',
  formatMismatch: 'io.formatMismatch',
  fileNameMismatch: 'io.fileNameMismatch',
  duplicateTableName: 'io.duplicateTableName',

  // 書き出し（DR-35）
  nonFiniteNumber: 'io.nonFiniteNumber',
} as const;

export type IoCodeValue = (typeof IoCode)[keyof typeof IoCode];
