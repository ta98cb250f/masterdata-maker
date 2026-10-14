// メニューの項目の一覧（メニューバー・右クリックメニュー・全シートの一覧で共用）。矢印キー・Enter・Esc で操作できる
import type { CSSProperties, KeyboardEvent } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getShortcut, shortcutLabels } from '@sheetcraft/core';
import type { AppStore } from '../store/AppStore';
import type { MenuEntry } from '../store/types';
import { CheckIcon } from './icons';

export type MenuListItem =
  | {
      kind: 'item';
      key: string;
      label: string;
      shortcut?: string;
      disabled?: boolean;
      checked?: boolean;
      onSelect(): void;
      testId?: string;
    }
  | { kind: 'separator'; key: string }
  | { kind: 'submenu'; key: string; label: string; items: MenuListItem[] };

export interface MenuListProps {
  items: MenuListItem[];
  onClose(): void;
  style?: CSSProperties;
  /** 左右の矢印キー（メニューバーで隣のメニューへ移る） */
  onHorizontal?(dir: -1 | 1): void;
  testId?: string;
  /** 開いたときに選んでおく項目（-1 なら選ばない） */
  initialIndex?: number;
}

function selectable(item: MenuListItem): boolean {
  return item.kind === 'submenu' || (item.kind === 'item' && item.disabled !== true);
}

export function MenuList({ items, onClose, style, onHorizontal, testId, initialIndex = 0 }: MenuListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const firstSelectable = items.findIndex(selectable);
  const [active, setActive] = useState(initialIndex < 0 ? -1 : Math.max(firstSelectable, initialIndex));
  const [openSub, setOpenSub] = useState<number | null>(null);
  const [pos, setPos] = useState<CSSProperties>(style ?? {});

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  // 画面の外にはみ出すなら、内側に寄せる
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || style === undefined) return;
    const r = el.getBoundingClientRect();
    const next: CSSProperties = { ...style };
    if (r.right > window.innerWidth - 4 && typeof style.left === 'number') next.left = Math.max(4, window.innerWidth - 4 - r.width);
    if (r.bottom > window.innerHeight - 4 && typeof style.top === 'number') next.top = Math.max(4, window.innerHeight - 4 - r.height);
    if (next.left !== style.left || next.top !== style.top) setPos(next);
    else setPos(style);
  }, [style?.left, style?.top]);

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
      setOpenSub(i);
      return;
    }
    if (item.kind !== 'item' || item.disabled === true) return;
    onClose();
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
        if (items[active]?.kind === 'submenu') setOpenSub(active);
        else onHorizontal?.(1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        onHorizontal?.(-1);
        break;
      case 'Escape':
      case 'Tab':
        e.preventDefault();
        onClose();
        break;
    }
  };

  return (
    <div ref={ref} className="sc-menu" role="menu" tabIndex={-1} style={pos} onKeyDown={onKeyDown} data-testid={testId} onMouseDown={(e) => e.preventDefault()}>
      {items.map((item, i) => {
        if (item.kind === 'separator') return <div key={item.key} className="sc-menu-sep" role="separator" />;
        const disabled = item.kind === 'item' && item.disabled === true;
        return (
          <div
            key={item.key}
            role="menuitem"
            aria-disabled={disabled}
            className={`sc-menu-item${i === active ? ' active' : ''}${disabled ? ' disabled' : ''}`}
            onMouseEnter={() => {
              setActive(i);
              setOpenSub(item.kind === 'submenu' ? i : null);
            }}
            onClick={() => choose(i)}
            data-testid={item.kind === 'item' ? item.testId : undefined}
          >
            <span className="sc-menu-check">{item.kind === 'item' && item.checked === true ? <CheckIcon /> : null}</span>
            <span className="sc-menu-label">{item.label}</span>
            {item.kind === 'item' && item.shortcut !== undefined && <span className="sc-menu-shortcut">{item.shortcut}</span>}
            {item.kind === 'submenu' && <span className="sc-menu-shortcut">▸</span>}
            {item.kind === 'submenu' && openSub === i && (
              <MenuList
                items={item.items}
                onClose={() => {
                  setOpenSub(null);
                  ref.current?.focus();
                }}
                onHorizontal={(dir) => {
                  if (dir === -1) {
                    setOpenSub(null);
                    ref.current?.focus();
                  }
                }}
                style={{ position: 'absolute', left: '100%', top: 0 }}
              />
            )}
          </div>
        );
      })}
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
    if (entry.kind === 'submenu') return { kind: 'submenu', key, label: store.t(entry.labelKey), items: menuEntriesToItems(store, entry.items, `${key}.`) };
    const def = store.commands.get(entry.command);
    return {
      kind: 'item',
      key,
      label: entry.label ?? (entry.labelKey !== undefined ? store.t(entry.labelKey) : store.commandLabel(entry.command)),
      shortcut: shortcutText(store, entry.command),
      disabled: def === undefined || !store.isEnabled(entry.command),
      checked: def?.checked?.(store),
      onSelect: () => void store.run(entry.command, entry.args),
      testId: `menu-${entry.command}`,
    };
  });
}
