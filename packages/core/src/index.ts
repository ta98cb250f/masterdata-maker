// @sheetcraft/core の公開 API（画面と CLI で共有する。NFR-24）
export * from './model';
export * from './io';
export * from './formula';
export * from './sheet';
export * from './util/datetime';
export * from './i18n';
export * from './calc';
export * from './validate';
export * from './export';

// 名前が衝突するものの解決
// - フィールド型とセルの値の型は model と formula で同じもの。model の側を公開する
export type { FieldType, RawValue, ScalarFieldType } from './model';
// - isError: model は診断がエラーか、formula は式の値がエラーか。式の側は isFormulaError として公開する
export { isError } from './model';
export { isError as isFormulaError } from './formula';
// - ParseResult: formula は式の構文解析の結果、io は YAML / JSON の構文木。io の側は SourceParseResult として公開する
export type { ParseResult } from './formula';
export type { ParseResult as SourceParseResult } from './io';
// - isValidTimeZone: io と util/datetime で同じ判定。util/datetime の側を公開する
export { isValidTimeZone } from './util/datetime';
