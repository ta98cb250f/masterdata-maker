// メニューの項目の一覧（メニューバー・右クリックメニュー・全シートの一覧で共用）。矢印キー・Enter・Esc で操作できる。
// サブメニューは親の一覧（max-height と overflow-y: auto で切られる）の外に描き、親の項目の右（はみ出すなら左）に出す
import type { CSSProperties, KeyboardEvent } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getShortcut, shortcutLabels } from '@sheetcraft/core';
import type { AppStore } from '../store/AppStore';
import type { MenuEntry } from '../store/types';
import { NoColorIcon } from './gridIcons';
import { CheckIcon } from './icons';

export type MenuListItem =
  | {
      kind: 'item';
      key: string;
      label: string;
      shortcut?: string;
      disabled?: boolean;
      checked?: boolean;
      /** 色の見本（セル色の一覧）。null は「なし」の印 */
      swatch?: string | null;
      onSelect(): void;
      testId?: string;
    }
  | { kind: 'separator'; key: string }
  | { kind: 'submenu'; key: string; label: string; items: MenuListItem[]; testId?: string };

export interface MenuListProps {
  items: MenuListItem[];
  /** 閉じる（Esc。サブメニューでは、そのサブメニューだけを閉じる） */
  onClose(): void;
  /** 項目を選んだとき（省略時は onClose）。サブメニューでは、メニュー全体を閉じる処理を渡す */
  onChosen?(): void;
  style?: CSSProperties;
  /** 右にはみ出すときに使う left（サブメニューを親の項目の左に出す） */
  flipLeft?: number;
  /** 左右の矢印キー（メニューバーで隣のメニューへ移る） */
  onHorizontal?(dir: -1 | 1): void;
  testId?: string;
  /** 開いたときに選んでおく項目（-1 なら選ばない） */
  initialIndex?: number;
}

/** 開いているサブメニューと、その親の項目の位置 */
interface OpenSub {
  index: number;
  left: number;
  right: number;
  top: number;
}

function selectable(item: MenuListItem): boolean {
  return item.kind === 'submenu' || (item.kind === 'item' && item.disabled !== true);
}

/** サブメニューの一覧の上下の余白（.sc-menu の padding）。サブメニューの先頭の項目を親の項目の高さに揃える */
const MENU_PADDING = 6;

export function MenuList({ items, onClose, onChosen, style, flipLeft, onHorizontal, testId, initialIndex = 0 }: MenuListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<number, HTMLDivElement>());
  const firstSelectable = items.findIndex(selectable);
  const [active, setActive] = useState(initialIndex < 0 ? -1 : Math.max(firstSelectable, initialIndex));
  const [sub, setSub] = useState<OpenSub | null>(null);
  const [pos, setPos] = useState<CSSProperties>(style ?? {});

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  // 画面の外にはみ出すなら、内側に寄せる（サブメニューは親の項目の左に出す）
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || style === undefined) return;
    const r = el.getBoundingClientRect();
    const next: CSSProperties = { ...style };
    if (r.right > window.innerWidth - 4 && typeof style.left === 'number') {
      next.left = flipLeft !== undefined && flipLeft - r.width >= 4 ? flipLeft - r.width : Math.max(4, window.innerWidth - 4 - r.width);
    }
    if (r.bottom > window.innerHeight - 4 && typeof style.top === 'number') next.top = Math.max(4, window.innerHeight - 4 - r.height);
    if (next.left !== style.left || next.top !== style.top) setPos(next);
    else setPos(style);
  }, [style?.left, style?.top, flipLeft]);

  const openSubmenu = (i: number) => {
    const el = itemRefs.current.get(i);
    if (el === undefined) return;
    const r = el.getBoundingClientRect();
    setSub({ index: i, left: r.left, right: r.right, top: r.top });
  };

  const closeSubmenu = () => {
    setSub(null);
    ref.current?.focus({ preventScroll: true });
  };

  const move = (delta: number) => {
    if (items.length === 0) return;
    let i = active;
    for (let n = 0; n < items.length; n++) {
      i = (i + delta + items.length) % items.length;
      if (selectable(items[i])) {
        setActive(i);
        return;
      }
    }
  };

  const choose = (i: number) => {
    const item = items[i];
    if (item === undefined) return;
    if (item.kind === 'submenu') {
      openSubmenu(i);
      return;
    }
    if (item.kind !== 'item' || item.disabled === true) return;
    (onChosen ?? onClose)();
    item.onSelect();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Home':
        e.preventDefault();
        setActive(firstSelectable);
        break;
      case 'End': {
        e.preventDefault();
        let last = -1;
        items.forEach((item, i) => {
          if (selectable(item)) last = i;
        });
        setActive(last);
        break;
      }
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(active);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (items[active]?.kind === 'submenu') openSubmenu(active);
        else onHorizontal?.(1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        onHorizontal?.(-1);
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'Tab':
        e.preventDefault();
        (onChosen ?? onClose)();
        break;
    }
  };

  const subItem = sub === null ? undefined : items[sub.index];

  return (
    <div
      ref={ref}
      className="sc-menu"
      role="menu"
      tabIndex={-1}
      style={pos}
      onKeyDown={onKeyDown}
      // 一覧をスクロールすると、サブメニューの位置がずれるので閉じる
      onScroll={() => sub !== null && closeSubmenu()}
      data-testid={testId}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item.kind === 'separator') return <div key={item.key} className="sc-menu-sep" role="separator" />;
        const disabled = item.kind === 'item' && item.disabled === true;
        return (
          <div
            key={item.key}
            ref={(el) => {
              if (el === null) itemRefs.current.delete(i);
              else itemRefs.current.set(i, el);
            }}
            role="menuitem"
            aria-disabled={disabled}
            aria-haspopup={item.kind === 'submenu' ? 'menu' : undefined}
            aria-expanded={item.kind === 'submenu' ? sub?.index === i : undefined}
            className={`sc-menu-item${i === active ? ' active' : ''}${disabled ? ' disabled' : ''}`}
            onMouseEnter={() => {
              setActive(i);
              if (item.kind === 'submenu') {
                if (sub?.index !== i) openSubmenu(i);
              } else if (sub !== null) closeSubmenu();
            }}
            onClick={() => choose(i)}
            data-testid={item.testId}
          >
            <span className="sc-menu-check">
              {item.kind === 'item' && item.checked === true ? <CheckIcon /> : null}
              {item.kind === 'item' && item.swatch !== undefined ? (
                item.swatch === null ? (
                  <span className="sc-menu-swatch-none">
                    <NoColorIcon />
                  </span>
                ) : (
                  <span className="sc-menu-swatch" style={{ background: item.swatch }} />
                )
              ) : null}
            </span>
            <span className="sc-menu-label">{item.label}</span>
            {item.kind === 'item' && item.shortcut !== undefined && <span className="sc-menu-shortcut">{item.shortcut}</span>}
            {item.kind === 'submenu' && <span className="sc-menu-shortcut">▸</span>}
          </div>
        );
      })}
      {sub !== null &&
        subItem?.kind === 'submenu' &&
        createPortal(
          <MenuList
            key={sub.index}
            items={subItem.items}
            onClose={closeSubmenu}
            onChosen={onChosen ?? onClose}
            onHorizontal={(dir) => {
              if (dir === -1) closeSubmenu();
            }}
            style={{ position: 'fixed', left: sub.right, top: sub.top - MENU_PADDING }}
            flipLeft={sub.left}
            testId={subItem.testId === undefined ? undefined : `${subItem.testId}-submenu`}
          />,
          document.body,
        )}
    </div>
  );
}

/** 操作のショートカットの表記（例: Ctrl+Z） */
export function shortcutText(store: AppStore, commandId: string): string | undefined {
  const def = store.commands.get(commandId);
  if (def?.shortcut === undefined) return undefined;
  const sc = getShortcut(def.shortcut);
  return sc === undefined ? undefined : shortcutLabels(sc, store.platform)[0];
}

/** 操作の識別子で指したメニューの項目を、表示する項目にする */
export function menuEntriesToItems(store: AppStore, entries: readonly MenuEntry[], prefix = 'm'): MenuListItem[] {
  return entries.map((entry, i): MenuListItem => {
    const key = `${prefix}${i}`;
    if (entry.kind === 'separator') return { kind: 'separator', key };
    if (entry.kind === 'submenu') {
      return {
        kind: 'submenu',
        key,
        label: store.t(entry.labelKey),
        items: menuEntriesToItems(store, entry.items, `${key}.`),
        testId: entry.testId === undefined ? undefined : `menu-${entry.testId}`,
      };
    }
    const def = store.commands.get(entry.command);
    return {
      kind: 'item',
      key,
      label: entry.label ?? (entry.labelKey !== undefined ? store.t(entry.labelKey) : store.commandLabel(entry.command)),
      shortcut: shortcutText(store, entry.command),
      disabled: def === undefined || !store.isEnabled(entry.command),
      checked: def?.checked?.(store),
      swatch: entry.swatch,
      onSelect: () => void store.run(entry.command, entry.args),
      testId: entry.testId === undefined ? `menu-${entry.command}` : `menu-${entry.testId}`,
    };
  });
}
