// 関数の一覧

import { aggregateFunctions } from './aggregate';
import { convertFunctions } from './convert';
import { dateFunctions } from './date';
import { logicalFunctions } from './logical';
import { mathFunctions } from './math';
import { refFunctions } from './ref';
import { textFunctions } from './text';
import type { FunctionDef } from '../context';

/** 関数名（大文字）→ 定義 */
export const FUNCTIONS: ReadonlyMap<string, FunctionDef> = new Map(
  Object.entries({
    ...logicalFunctions,
    ...aggregateFunctions,
    ...mathFunctions,
    ...textFunctions,
    ...convertFunctions,
    ...dateFunctions,
    ...refFunctions,
  }),
);

/** 実行のたびに結果が変わるため使えない関数（FR-FML-06、J-11） */
export const VOLATILE_FUNCTIONS: ReadonlySet<string> = new Set(['NOW', 'TODAY', 'RAND', 'RANDBETWEEN']);

/** 入力補完などに使う、使える関数の名前の一覧（TRUE / FALSE を除く） */
export const FUNCTION_NAMES: readonly string[] = [...FUNCTIONS.keys()]
  .filter((n) => n !== 'TRUE' && n !== 'FALSE')
  .sort();
