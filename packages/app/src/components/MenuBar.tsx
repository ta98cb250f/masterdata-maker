// メニューバー（FR-UI-01）。項目は操作の登録簿から作る。Alt+Shift+F などで開ける（Googleスプレッドシートと同じ。NFR-40）。
// F6 で移ってきたときは ← → で隣のメニューへ、Enter・↓ で開き、Esc でグリッドへ戻る
import { useEffect, useRef, useState } from 'react';
import type { MenuId } from '../commands/registry';
import { MENU_IDS } from '../commands/registry';
import { moveAmongButtons } from './focusRegions';
import { useAppState, useStore, useT } from '../store/hooks';
import type { MenuListItem } from './MenuList';
import { MenuList, shortcutText } from './MenuList';

/** Alt+Shift+<文字> で開くメニュー（KeyboardEvent.code） */
const ACCESS_KEYS: Readonly<Record<string, MenuId>> = {
  KeyF: 'file',
  KeyE: 'edit',
  KeyV: 'view',
  KeyI: 'insert',
  KeyD: 'data',
  KeyH: 'help',
};

export function MenuBar() {
  const store = useStore();
  const t = useT();
  const [open, setOpen] = useState<MenuId | null>(null);
  const buttons = useRef(new Map<MenuId, HTMLButtonElement>());
  const navRef = useRef<HTMLElement>(null);
  // 開いている間は、状態が変わるたびに項目の使える・使えないを描き直す
  useAppState((s) => (open === null ? null : s));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
      const menu = ACCESS_KEYS[e.code];
      if (menu === undefined) return;
      e.preventDefault();
      setOpen(menu);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const close = (refocus: boolean) => {
    setOpen(null);
    if (refocus) store.focusGrid();
  };

  // メニューの外を押したら閉じる（サブメニューはメニューバーの外に描くので、一覧の中を押したときは閉じない）
  useEffect(() => {
    if (open === null) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inMenu = target instanceof Element && target.closest('.sc-menu') !== null;
      if (!(navRef.current?.contains(target) ?? false) && !inMenu) setOpen(null);
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [open]);

  const itemsOf = (menu: MenuId): MenuListItem[] => {
    const items: MenuListItem[] = [];
    store.commands.menuGroups(menu).forEach((group, gi) => {
      if (gi > 0) items.push({ kind: 'separator', key: `sep${gi}` });
      for (const def of group) {
        items.push({
          kind: 'item',
          key: def.id,
          label: store.commandLabel(def.id),
          shortcut: shortcutText(store, def.id),
          disabled: !store.isEnabled(def.id),
          checked: def.checked?.(store),
          onSelect: () => void store.run(def.id),
          testId: `menu-${def.id}`,
        });
      }
    });
    if (items.length === 0) items.push({ kind: 'item', key: 'empty', label: t('ui.menu.empty'), disabled: true, onSelect: () => undefined });
    return items;
  };

  const anchor = open === null ? undefined : buttons.current.get(open)?.getBoundingClientRect();

  return (
    <nav
      ref={navRef}
      className="sc-menubar"
      aria-label={t('ui.menu.label')}
      data-region="menubar"
      onKeyDown={(e) => {
        if (open === null) moveAmongButtons(e, navRef.current);
      }}
    >
      {MENU_IDS.map((menu) => (
        <button
          key={menu}
          type="button"
          ref={(el) => {
            if (el === null) buttons.current.delete(menu);
            else buttons.current.set(menu, el);
          }}
          className={`sc-menubar-item${open === menu ? ' open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={open === menu}
          data-testid={`menubar-${menu}`}
          onMouseDown={(e) => {
            e.preventDefault();
            setOpen(open === menu ? null : menu);
          }}
          onMouseEnter={() => open !== null && open !== menu && setOpen(menu)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(menu);
            }
          }}
        >
          {t(`ui.menu.${menu}`)}
        </button>
      ))}
      {open !== null && anchor !== undefined && (
        <MenuList
          key={open}
          items={itemsOf(open)}
          onClose={() => close(true)}
          onHorizontal={(dir) => {
            const i = MENU_IDS.indexOf(open);
            setOpen(MENU_IDS[(i + dir + MENU_IDS.length) % MENU_IDS.length]);
          }}
          style={{ position: 'fixed', left: anchor.left, top: anchor.bottom }}
          testId={`menu-${open}`}
        />
      )}
    </nav>
  );
}
