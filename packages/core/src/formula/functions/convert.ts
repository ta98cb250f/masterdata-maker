// 型変換: VALUE TO_TEXT

import { formatDisplay, parseUserDateTime } from '../../util/datetime';
import { dateTimeToSerial, parseNumericString, scalarToText } from '../coerce';
import { DateTimeValue, FormulaError } from '../values';
import { argNotNumber, scalarArg } from './helpers';
import type { FunctionDef } from '../context';

/**
 * VALUE: 文字列を数値にする。数値・"50%"・指数表記のほか、日時の文字列（P-19 の形式）は
 * シリアル値にする。数値と日時はそのまま数値に、未入力は 0、真偽値は 1/0（未検証）
 */
const VALUE: FunctionDef = {
  minArgs: 1,
  maxArgs: 1,
  call(args, ctx, _node, name) {
    const v = scalarArg(args[0]);
    if (v instanceof FormulaError) return v;
    if (typeof v === 'number' || typeof v === 'bigint') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof DateTimeValue) return dateTimeToSerial(v, ctx.timeZone);
    if (typeof v !== 'string') return 0;
    const n = parseNumericString(v);
    if (n !== undefined) return n;
    const dt = parseUserDateTime(v, ctx.timeZone);
    if (dt !== null) return dateTimeToSerial(new DateTimeValue(dt.epochMs), ctx.timeZone);
    return argNotNumber(name, 1, v, ctx);
  },
};

/** TO_TEXT: 数値は有効数字 15 桁（P-34）、日時は "YYYY-MM-DD HH:mm:ss"（P-15）、真偽値は "TRUE" / "FALSE" */
const TO_TEXT: FunctionDef = {
  minArgs: 1,
  maxArgs: 1,
  call(args, ctx) {
    const v = scalarArg(args[0]);
    if (v instanceof FormulaError) return v;
    if (v instanceof DateTimeValue) return formatDisplay(v.epochMs, ctx.timeZone);
    return scalarToText(v, ctx.timeZone);
  },
};

export const convertFunctions: Readonly<Record<string, FunctionDef>> = {
  VALUE,
  TO_TEXT,
};
