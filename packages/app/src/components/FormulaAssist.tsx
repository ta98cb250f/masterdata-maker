// 式の入力補完の候補の一覧（FR-EDT-07）。数式バー・セル内の編集・列の設定の式の欄の下に出す。
// 入力欄のキー操作を handleKey で先に受け取り、候補が出ているときは ↑↓ で選び、Tab / Enter で補完する。
// 補完は入力欄の setRangeText と input のイベントで行う（入力欄の持ち主の onChange / onInput がそのまま動く）
import type { CSSProperties, KeyboardEvent, RefObject } from 'react';
import { forwardRef, useEffect, useImperativeHandle, useReducer, useRef, useState } from 'react';
import type { CompletionColumn, CompletionItem } from '../sheet/complete';
import { completionContext, completionItems } from '../sheet/complete';
import { useT } from '../store/hooks';
import '../styles/formulaAssist.css';

export interface FormulaAssistHandle {
  /** 入力欄のキー操作を先に受け取る。処理したら true（呼び出し側で preventDefault する） */
  handleKey(e: KeyboardEvent<HTMLElement>): boolean;
}

export interface FormulaAssistProps {
  inputRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  /** 入力欄の今のテキスト */
  text: string;
  columns: readonly CompletionColumn[];
  /** `=` で始まるときだけ出す（数式バー・セル）。列の設定の式の欄では偽 */
  requireEquals: boolean;
}

export const FormulaAssist = forwardRef<FormulaAssistHandle, FormulaAssistProps>(function FormulaAssist({ inputRef, text, columns, requireEquals }, ref) {
  const t = useT();
  const [active, setActive] = useState(0);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  /** 補完した直後のテキスト（同じテキストの間は候補を出さない） */
  const suppressed = useRef<string | null>(null);

  // カーソルの移動（キー・クリック）とフォーカスの出入りで描き直す
  useEffect(() => {
    const el = inputRef.current;
    if (el === null) return;
    const onChange = () => refresh();
    for (const type of ['keyup', 'click', 'focus', 'blur', 'select']) el.addEventListener(type, onChange);
    return () => {
      for (const type of ['keyup', 'click', 'focus', 'blur', 'select']) el.removeEventListener(type, onChange);
    };
  }, [inputRef]);

  const el = inputRef.current;
  const focused = el !== null && typeof document !== 'undefined' && document.activeElement === el;
  const caret = el !== null && el.value === text ? (el.selectionStart ?? text.length) : text.length;
  const ctx = focused && suppressed.current !== text ? completionContext(text, caret, requireEquals) : null;
  const items: CompletionItem[] = ctx === null ? [] : completionItems(text, ctx, columns);
  const index = Math.min(active, Math.max(0, items.length - 1));
  const visible = items.length > 0;

  // 候補が変わったら先頭を選び直す
  const itemsKey = items.map((i) => i.label).join('\u0000');
  useEffect(() => setActive(0), [itemsKey]);

  const accept = (item: CompletionItem) => {
    const input = inputRef.current;
    if (input === null || ctx === null) return;
    input.setRangeText(item.insert, ctx.start, ctx.end, 'end');
    suppressed.current = input.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    refresh();
  };

  useImperativeHandle(ref, () => ({
    handleKey(e) {
      if (!visible || e.altKey || e.ctrlKey || e.metaKey) return false;
      if (e.key === 'ArrowDown') {
        setActive((index + 1) % items.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        setActive((index - 1 + items.length) % items.length);
        return true;
      }
      if ((e.key === 'Tab' || e.key === 'Enter') && !e.shiftKey) {
        accept(items[index]);
        return true;
      }
      return false;
    },
  }));

  if (!visible || el === null) return null;
  const rect = el.getBoundingClientRect();
  const style: CSSProperties = { position: 'fixed', left: rect.left, top: rect.bottom + 2 };
  return (
    <div
      className="sc-fx-assist"
      style={style}
      role="listbox"
      aria-label={t('ui.complete.label')}
      data-testid="formula-assist"
      // 入力欄からフォーカスを動かさない。グリッドのマウス操作にも渡さない
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <div
          key={`${item.kind}:${item.label}`}
          role="option"
          aria-selected={i === index}
          className={`sc-fx-assist-item${i === index ? ' active' : ''}`}
          onMouseEnter={() => setActive(i)}
          onClick={() => accept(item)}
          data-testid="formula-assist-item"
        >
          <span className={`sc-fx-assist-kind ${item.kind}`}>{item.kind === 'function' ? 'fx' : t('ui.complete.column')}</span>
          <span className="sc-fx-assist-label">{item.label}</span>
          {item.detail !== undefined && item.detail !== item.label && <span className="sc-fx-assist-detail">{item.detail}</span>}
        </div>
      ))}
      <div className="sc-fx-assist-hint">{t('ui.complete.hint')}</div>
    </div>
  );
});
