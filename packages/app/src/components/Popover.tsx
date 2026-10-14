// 要素の近くに出す小さな画面（フィルタ・セル色の一覧・メモの編集欄）。画面の外にはみ出さないように寄せる。
// 外側を押す・Esc で閉じ（onDismiss）、Tab は中を巡回する。キー操作はグリッドに渡さない
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AnchorRect } from '../grid/domAnchors';
import '../styles/popover.css';

export interface PopoverProps {
  /** 基準の要素の枠（クライアント座標） */
  anchor: AnchorRect;
  /** below: 基準の下に左端をそろえて出す / right: 基準の右に上端をそろえて出す */
  placement?: 'below' | 'right';
  /** 外側を押した・Esc を押したとき */
  onDismiss(): void;
  children: ReactNode;
  width?: number;
  className?: string;
  testId?: string;
  label?: string;
  /** 開いたときにフォーカスを置く要素（省略時は最初の入力欄かボタン） */
  initialFocus?: string;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Popover({ anchor, placement = 'below', onDismiss, children, width, className, testId, label, initialFocus }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const initial: CSSProperties =
    placement === 'below' ? { left: anchor.left, top: anchor.bottom + 2 } : { left: anchor.right + 4, top: anchor.top };
  const [pos, setPos] = useState<CSSProperties>(initial);

  // 開いたときに 1 回だけ、画面の内側に寄せる
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    let left = initial.left as number;
    let top = initial.top as number;
    if (left + r.width > window.innerWidth - 4) left = placement === 'right' ? Math.max(4, anchor.left - r.width - 4) : Math.max(4, window.innerWidth - 4 - r.width);
    if (top + r.height > window.innerHeight - 4) top = placement === 'below' ? Math.max(4, anchor.top - r.height - 2) : Math.max(4, window.innerHeight - 4 - r.height);
    if (left !== pos.left || top !== pos.top) setPos({ left, top });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const target = initialFocus !== undefined ? el.querySelector<HTMLElement>(initialFocus) : el.querySelector<HTMLElement>(FOCUSABLE);
    (target ?? el).focus({ preventScroll: true });
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onDismiss();
      return;
    }
    if (e.key === 'Tab') {
      const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (items.length > 0) {
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
    }
    e.stopPropagation();
  };

  return (
    <div
      className="sc-popover-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          onDismiss();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        className={`sc-popover${className === undefined ? '' : ` ${className}`}`}
        style={{ ...pos, width }}
        onKeyDown={onKeyDown}
        data-testid={testId}
      >
        {children}
      </div>
    </div>
  );
}
