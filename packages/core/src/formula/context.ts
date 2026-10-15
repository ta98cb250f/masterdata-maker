// 評価の文脈と、関数の定義の型

import type { CallNode, Node } from './ast';
import type { FValue } from './values';

/** 評価のときにホスト（表の計算）が提供するもの */
export interface EvalScope {
  /**
   * 同じレコードの列の実効値（P-10）。列が無ければ undefined（→ #NAME?）。
   * 遅延評価と循環参照の検出はホスト側が行い、循環なら FormulaError（circularReference()）を返す
   */
  column(name: string): FValue | undefined;
  /**
   * REF の解決。キーが単一の値のときだけ呼ばれる（リストのキーは評価器が要素ごとに呼んで FList にまとめる）。
   * テーブルや列が無ければ refTableNotFound / refColumnNotFound、キーが無ければ refKeyNotFound を返す
   */
  ref(table: string, key: FValue, column: string): FValue;
  /** 日時の関数に使う IANA タイムゾーン */
  timeZone: string;
}

export interface EvalContext {
  readonly scope: EvalScope;
  readonly timeZone: string;
  evaluate(node: Node): FValue;
}

/** 関数の引数。value() で初めて評価する（IF の遅延評価のため） */
export interface FnArg {
  readonly node: Node;
  /** 引数が列の参照か（Googleスプレッドシートのセル参照＝範囲と同じに扱う） */
  readonly isReference: boolean;
  value(): FValue;
}

export interface FunctionDef {
  readonly minArgs: number;
  readonly maxArgs: number;
  call(args: readonly FnArg[], ctx: EvalContext, node: CallNode, name: string): FValue;
}
