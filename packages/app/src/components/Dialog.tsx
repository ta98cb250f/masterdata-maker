// ダイアログの枠（見出し・本文・ボタン）。Esc で閉じ、Tab はダイアログの中を巡回する
import type { KeyboardEvent, ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef } from 'react';

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

/** 中身が収まらないとスクロールする部分（本文・失敗の一覧など） */
const SCROLLERS = '.sc-dialog-body, .sc-dialog-list, .sc-form-list, .sc-fd-scroll';

/**
 * スクロールする部分に Tab で止まれるようにする（NFR-40。止まった所で ↑↓・PageUp / PageDown でスクロールできる）。
 * 収まっている間は止まらない（余計な Tab の手間を増やさない）
 */
function updateScrollStops(dialog: HTMLElement): void {
  for (const el of dialog.querySelectorAll<HTMLElement>(SCROLLERS)) {
    const scrolls = el.scrollHeight > el.clientHeight + 1;
    if (scrolls && !el.hasAttribute('tabindex')) {
      el.tabIndex = 0;
      el.dataset.scrollStop = '';
    } else if (!scrolls && el.dataset.scrollStop !== undefined) {
      el.removeAttribute('tabindex');
      delete el.dataset.scrollStop;
    }
  }
}

export function DialogFrame({ title, children, footer, onClose, width = 440, active = true, testId }: DialogFrameProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null || !active) return;
    // data-autofocus の欄、最初の入力欄、無ければ最後のボタン（主な操作）の順にフォーカスを置く
    const input = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>('input, textarea, select');
    const buttons = el.querySelectorAll<HTMLElement>('.sc-dialog-footer button:not([disabled])');
    (input ?? buttons[buttons.length - 1] ?? el).focus();
  }, [active]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    updateScrollStops(el);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => updateScrollStops(el));
    ro.observe(el);
    return () => ro.disconnect();
  });

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
