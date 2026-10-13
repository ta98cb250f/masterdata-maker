// 式の値（FValue）の型

/** Googleスプレッドシートと同じエラー値 */
export type ErrorCode = '#DIV/0!' | '#VALUE!' | '#NAME?' | '#REF!' | '#N/A' | '#NUM!' | '#ERROR!';

export const ERROR_CODES: readonly ErrorCode[] = [
  '#DIV/0!',
  '#VALUE!',
  '#NAME?',
  '#REF!',
  '#N/A',
  '#NUM!',
  '#ERROR!',
];

/** メッセージに差し込む引数 */
export type MessageArgs = Readonly<Record<string, string | number>>;

/** 日時の値。瞬間（エポックからのミリ秒）を持つ */
export class DateTimeValue {
  constructor(readonly epochMs: number) {}
}

/** 未入力を表す値。唯一のインスタンス EMPTY だけを使う */
export class EmptyValue {
  static readonly instance: EmptyValue = new EmptyValue();
  private constructor() {}
}

export const EMPTY: EmptyValue = EmptyValue.instance;

/**
 * 式のエラー。
 * start / end は式のテキスト（先頭の `=` を除いた部分）の中の位置（0 始まり。end は含まない）。
 * 参照先のセル（列の参照や REF）から伝わってきたエラーは、この式の中で参照したノードの位置を持ち、
 * 元のエラーを cause に持つ
 */
export class FormulaError {
  constructor(
    readonly code: ErrorCode,
    readonly messageCode: string,
    readonly messageArgs: MessageArgs = {},
    readonly start?: number,
    readonly end?: number,
    readonly cause?: FormulaError,
  ) {}

  get hasPosition(): boolean {
    return this.start !== undefined;
  }

  /** 利用者に示す位置（1 始まり）。位置が無ければ undefined */
  get position(): number | undefined {
    return this.start === undefined ? undefined : this.start + 1;
  }

  /** 位置が無ければ付けたものを返す */
  at(start: number, end: number): FormulaError {
    if (this.hasPosition) return this;
    return new FormulaError(this.code, this.messageCode, this.messageArgs, start, end, this.cause);
  }

  /** 参照先から伝わってきたエラーとして、この式の中の参照の位置を付けたものを返す */
  propagatedAt(start: number, end: number): FormulaError {
    return new FormulaError(this.code, this.messageCode, this.messageArgs, start, end, this);
  }

  /** 参照をたどった元のエラー */
  get origin(): FormulaError {
    let e: FormulaError = this;
    while (e.cause !== undefined) e = e.cause;
    return e;
  }
}

/** スカラーの値 */
export type Scalar = number | bigint | string | boolean | DateTimeValue | EmptyValue | FormulaError;

/** リスト（Googleスプレッドシートの範囲にあたる）。要素はスカラー */
export class FList {
  constructor(readonly items: readonly Scalar[]) {}
}

export type FValue = Scalar | FList;

export function isEmpty(v: FValue): v is EmptyValue {
  return v === EMPTY;
}

export function isError(v: FValue): v is FormulaError {
  return v instanceof FormulaError;
}

/** int64 の範囲（DR-19: ±9,223,372,036,854,775,807） */
export const INT64_MAX = 9_223_372_036_854_775_807n;
export const INT64_MIN = -INT64_MAX;

export function inInt64Range(v: bigint): boolean {
  return v >= INT64_MIN && v <= INT64_MAX;
}
