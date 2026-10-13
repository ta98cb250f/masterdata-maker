import type { Diagnostic, DiagnosticParams } from '../model/diagnostic';

// YAML と JSON を同じ形にした構文木。値の解釈（列の型に従う変換）はこの木に対して行う

export interface SrcPos {
  line: number;
  column: number;
}

export type SrcScalarValue = null | boolean | number | bigint | string;

export interface SrcScalar {
  kind: 'scalar';
  value: SrcScalarValue;
  /** 元の表記（YAML の引用符なしの値の復元に使う。DR-42） */
  source: string;
  /** 型が表記から推定された値か（YAML の引用符なしのスカラー）。JSON は常に false */
  implicit: boolean;
  pos: SrcPos;
}

export interface SrcSeq {
  kind: 'seq';
  items: SrcNode[];
  pos: SrcPos;
}

export interface SrcEntry {
  key: string;
  keyPos: SrcPos;
  value: SrcNode;
}

export interface SrcMap {
  kind: 'map';
  entries: SrcEntry[];
  pos: SrcPos;
}

export type SrcNode = SrcScalar | SrcSeq | SrcMap;

export interface ParseResult {
  /** エラーがあれば null */
  node: SrcNode | null;
  diagnostics: Diagnostic[];
}

/** 診断の付加情報（ファイル・テーブル・レコード・列） */
export type DiagnosticScope = Omit<Diagnostic, 'severity' | 'code' | 'params' | 'line' | 'column'>;

/** 診断を集める。child で付加情報を足した報告先を作れる（集めた先は共有） */
export class Reporter {
  constructor(
    readonly items: Diagnostic[] = [],
    private readonly scope: DiagnosticScope = {},
  ) {}

  child(scope: DiagnosticScope): Reporter {
    return new Reporter(this.items, { ...this.scope, ...scope });
  }

  error(code: string, at?: SrcPos, params?: DiagnosticParams): void {
    this.push('error', code, at, params);
  }

  warn(code: string, at?: SrcPos, params?: DiagnosticParams): void {
    this.push('warning', code, at, params);
  }

  hasErrors(): boolean {
    return this.items.some((d) => d.severity === 'error');
  }

  private push(severity: 'error' | 'warning', code: string, at?: SrcPos, params?: DiagnosticParams): void {
    const d: Diagnostic = { severity, code };
    if (params !== undefined) d.params = params;
    Object.assign(d, this.scope);
    if (at !== undefined) {
      d.line = at.line;
      d.column = at.column;
    }
    this.items.push(d);
  }
}
