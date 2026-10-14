// 診断の文言（入れ子のメッセージ cause を展開する）
import type { Diagnostic, DiagnosticParams } from '../model/diagnostic';
import { formatMessage } from '../i18n';
import { CAUSE_PREFIX } from './formula';

function expandParams(params: DiagnosticParams | undefined, locale: string | undefined): DiagnosticParams | undefined {
  if (params === undefined || typeof params.cause !== 'string') return params;
  const outer: Record<string, string | number> = {};
  const inner: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k.startsWith(CAUSE_PREFIX)) inner[k.slice(CAUSE_PREFIX.length)] = v;
    else outer[k] = v;
  }
  outer.cause = formatMessage(params.cause, inner, locale);
  return outer;
}

/** 診断の文言（読み込み・検査・出力の診断に共通） */
export function formatDiagnostic(d: Diagnostic, locale?: string): string {
  return formatMessage(d.code, expandParams(d.params, locale), locale);
}
