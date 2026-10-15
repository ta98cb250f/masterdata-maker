// 失敗の文言を組み立てる（文言そのものは i18n/locales/<locale>/edit.json）
import { formatMessage } from '../i18n/index';
import { EditCode } from './codes';
import type { InputError } from './input';
import type { EditFailure } from './transaction';

/** 入力値の変換の失敗の文言（リストの要素なら「2 番目の要素: …」を付ける） */
export function formatInputError(error: Pick<InputError, 'code' | 'params' | 'index'>, locale?: string): string {
  const message = formatMessage(error.code, error.params, locale);
  return error.index === undefined ? message : formatMessage(EditCode.inListItem, { index: error.index, message }, locale);
}

/** 入力欄に出す「どう直せばよいか」の文言（FR-EDT-05 の例「整数を入力してください」） */
export function formatInputHint(error: Pick<InputError, 'hint' | 'params'>, locale?: string): string {
  return formatMessage(error.hint, error.params, locale);
}

export interface FailureLocation {
  /** 画面に出す行の番号（1 から数える。§5.17 の 3 番「2 行目」） */
  row?: number;
  /** 画面に出す列の名前（表示名など） */
  column?: string;
}

/** 失敗の文言。位置を渡せば「2 行目: abc は整数ではありません」の形にする */
export function formatEditFailure(failure: EditFailure, location: FailureLocation = {}, locale?: string): string {
  const message = formatInputError(failure, locale);
  if (location.row === undefined) return message;
  if (location.column === undefined) return formatMessage(EditCode.atRow, { row: location.row, message }, locale);
  return formatMessage(EditCode.atCell, { row: location.row, column: location.column, message }, locale);
}
