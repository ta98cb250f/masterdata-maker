// ダイアログの入力欄の部品（見出し・欄・誤りの表示）。列の設定・共通設定・テーブル・連番入力・検索と置換で使う
import type { Locale } from '@sheetcraft/core';
import { formatInputError } from '@sheetcraft/core';
import type { ReactNode } from 'react';
import type { FieldError } from './columnDraft';
import { useAppState } from '../store/hooks';
import '../styles/dialogForms.css';

export function useLocale(): Locale {
  return useAppState((s) => s.locale);
}

export function errorText(error: FieldError | undefined, locale: Locale): string | undefined {
  return error === undefined ? undefined : formatInputError(error, locale);
}

export interface FieldProps {
  label: string;
  htmlFor?: string;
  /** 誤りの文言（あれば赤く出す） */
  error?: string;
  /** 欄の下に出す説明 */
  hint?: string;
  /** 注意（使えない設定など） */
  warning?: string;
  children: ReactNode;
  testId?: string;
}

/** 見出しと入力欄の 1 行 */
export function Field({ label, htmlFor, error, hint, warning, children, testId }: FieldProps) {
  return (
    <div className="sc-field" data-testid={testId}>
      <label className="sc-field-label" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="sc-field-control">
        {children}
        {hint !== undefined && <div className="sc-field-hint">{hint}</div>}
        {warning !== undefined && <div className="sc-field-warning">{warning}</div>}
        {error !== undefined && (
          <div className="sc-field-error" role="alert" data-testid={testId === undefined ? undefined : `${testId}-error`}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

export function Check({ label, checked, onChange, testId, disabled }: { label: string; checked: boolean; onChange(v: boolean): void; testId?: string; disabled?: boolean }) {
  return (
    <label className="sc-check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span>{label}</span>
    </label>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sc-form-section">
      <h3 className="sc-form-section-title">{title}</h3>
      {children}
    </section>
  );
}

/** 確定できなかった理由の一覧（ダイアログの上に出す） */
export function Failures({ items, testId = 'dialog-failures' }: { items: readonly string[]; testId?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className="sc-form-failures" role="alert" data-testid={testId}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** Enter（入力欄の上で、IME の変換中でなく、補完などが受け取っていなければ）で確定する */
export function submitOnEnter(submit: () => void) {
  return (e: { key: string; target: EventTarget; defaultPrevented: boolean; nativeEvent: KeyboardEvent; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; preventDefault(): void }) => {
    if (e.key !== 'Enter' || e.defaultPrevented || e.nativeEvent.isComposing || e.shiftKey || e.altKey) return;
    if (!(e.target instanceof HTMLInputElement) || e.target.type === 'checkbox') return;
    e.preventDefault();
    submit();
  };
}
