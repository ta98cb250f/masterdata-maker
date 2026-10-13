// 診断（読み込み・検査で見つかったエラーと警告）。文言は持たず、コードと引数で表す（FR-ETC-02）
export type Severity = 'error' | 'warning';

export type DiagnosticParams = Record<string, string | number>;

export interface Diagnostic {
  severity: Severity;
  /** 文言ファイルのキー（例: `io.yamlAnchorNotAllowed`） */
  code: string;
  params?: DiagnosticParams;
  /** プロジェクトのルートからの相対パス */
  file?: string;
  table?: string;
  recordUid?: number;
  /** レコードの主キーの値（FR-VAL-08） */
  recordKey?: string;
  field?: string;
  /** 1 から数える */
  line?: number;
  /** 1 から数える（UTF-16 の単位） */
  column?: number;
}

export function isError(d: Diagnostic): boolean {
  return d.severity === 'error';
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some(isError);
}
