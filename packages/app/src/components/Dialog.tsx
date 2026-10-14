// ダイアログの枠（見出し・本文・ボタン）。Esc で閉じ、Tab はダイアログの中を巡回する
import type { KeyboardEvent, ReactNode } from 'react';
import { useEffect, useRef } from 'react';

export interface DialogFrameProps {
  title: string;
  children?: ReactNode;
  /** 下に並べるボタン */
  footer?: ReactNode;
  onClose(): void;
  width?: number;
  /** 一番手前でなければ、キー操作を受け付けない */
  active?: boolean;
  testId?: string;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function DialogFrame({ title, children, footer, onClose, width = 440, active = true, testId }: DialogFrameProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null || !active) return;
    // 最初の入力欄、無ければ最後のボタン（主な操作）にフォーカスを置く
    const input = el.querySelector<HTMLElement>('input, textarea, select');
    const buttons = el.querySelectorAll<HTMLElement>('.sc-dialog-footer button:not([disabled])');
    (input ?? buttons[buttons.length - 1] ?? el).focus();
  }, [active]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    // グリッドなどのキー操作に渡さない
    e.stopPropagation();
  };

  return (
    <div className="sc-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sc-dialog"
        style={{ width }}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid={testId}
      >
        <div className="sc-dialog-title">{title}</div>
        <div className="sc-dialog-body">{children}</div>
        {footer !== undefined && <div className="sc-dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}
