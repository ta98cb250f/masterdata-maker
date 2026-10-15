// 文字列: CONCATENATE LEN LEFT RIGHT MID UPPER LOWER TRIM SUBSTITUTE。
// 文字数は UTF-16 の単位で数える（Googleスプレッドシートの LEN("😀") は 2。第三者の解説で確認）

import { scalarToText } from '../coerce';
import { FList, FormulaError } from '../values';
import { argTooSmall, intArg, textArg } from './helpers';
import type { FunctionDef } from '../context';

/** CONCATENATE: リスト（範囲）は要素を順に連結する */
const CONCATENATE: FunctionDef = {
  minArgs: 1,
  maxArgs: Infinity,
  call(args, ctx) {
    let out = '';
    for (const arg of args) {
      const v = arg.value();
      if (v instanceof FormulaError) return v;
      const items = v instanceof FList ? v.items : [v];
      for (const item of items) {
        if (item instanceof FormulaError) return item;
        out += scalarToText(item, ctx.timeZone);
      }
    }
    return out;
  },
};

const LEN: FunctionDef = {
  minArgs: 1,
  maxArgs: 1,
  call(args, ctx) {
    const s = textArg(args[0], ctx);
    return s instanceof FormulaError ? s : s.length;
  },
};

function leftRight(side: 'left' | 'right'): FunctionDef {
  return {
    minArgs: 1,
    maxArgs: 2,
    call(args, ctx, _node, name) {
      const s = textArg(args[0], ctx);
      if (s instanceof FormulaError) return s;
      let n = 1;
      if (args.length > 1) {
        const v = intArg(args[1], name, 2, ctx);
        if (v instanceof FormulaError) return v;
        if (v < 0) return argTooSmall(name, 2, v, 0);
        n = v;
      }
      if (n === 0) return '';
      return side === 'left' ? s.slice(0, n) : s.slice(Math.max(0, s.length - n));
    },
  };
}

/** MID(text, start, len): start は 1 から数える（J-01）。start が 1 未満、len が負なら #VALUE! */
const MID: FunctionDef = {
  minArgs: 3,
  maxArgs: 3,
  call(args, ctx, _node, name) {
    const s = textArg(args[0], ctx);
    if (s instanceof FormulaError) return s;
    const start = intArg(args[1], name, 2, ctx);
    if (start instanceof FormulaError) return start;
    if (start < 1) return argTooSmall(name, 2, start, 1);
    const len = intArg(args[2], name, 3, ctx);
    if (len instanceof FormulaError) return len;
    if (len < 0) return argTooSmall(name, 3, len, 0);
    return s.slice(start - 1, start - 1 + len);
  },
};

function caseFunction(upper: boolean): FunctionDef {
  return {
    minArgs: 1,
    maxArgs: 1,
    call(args, ctx) {
      const s = textArg(args[0], ctx);
      if (s instanceof FormulaError) return s;
      return upper ? s.toUpperCase() : s.toLowerCase();
    },
  };
}

/** TRIM: 前後の空白を除き、連続する空白を 1 つにする。対象は半角スペースだけ（公式ヘルプ: タブやノーブレークスペースは除かない） */
const TRIM: FunctionDef = {
  minArgs: 1,
  maxArgs: 1,
  call(args, ctx) {
    const s = textArg(args[0], ctx);
    if (s instanceof FormulaError) return s;
    return s.replace(/ {2,}/g, ' ').replace(/^ | $/g, '');
  },
};

/**
 * SUBSTITUTE(text, search, replace, [occurrence]): 大文字と小文字を区別する。
 * occurrence を指定すると、その回目だけを置き換える（1 未満は #VALUE!。未検証）。search が "" なら変えない
 */
const SUBSTITUTE: FunctionDef = {
  minArgs: 3,
  maxArgs: 4,
  call(args, ctx, _node, name) {
    const s = textArg(args[0], ctx);
    if (s instanceof FormulaError) return s;
    const search = textArg(args[1], ctx);
    if (search instanceof FormulaError) return search;
    const replacement = textArg(args[2], ctx);
    if (replacement instanceof FormulaError) return replacement;
    let occurrence: number | undefined;
    if (args.length > 3) {
      const v = intArg(args[3], name, 4, ctx);
      if (v instanceof FormulaError) return v;
      if (v < 1) return argTooSmall(name, 4, v, 1);
      occurrence = v;
    }
    if (search === '') return s;
    if (occurrence === undefined) return s.split(search).join(replacement);
    let from = 0;
    for (let i = 1; ; i++) {
      const at = s.indexOf(search, from);
      if (at < 0) return s;
      if (i === occurrence) return s.slice(0, at) + replacement + s.slice(at + search.length);
      from = at + search.length;
    }
  },
};

export const textFunctions: Readonly<Record<string, FunctionDef>> = {
  CONCATENATE,
  LEN,
  LEFT: leftRight('left'),
  RIGHT: leftRight('right'),
  MID,
  UPPER: caseFunction(true),
  LOWER: caseFunction(false),
  TRIM,
  SUBSTITUTE,
};
