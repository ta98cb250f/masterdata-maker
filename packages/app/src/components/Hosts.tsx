// ダイアログ・パネル・右クリックメニューを、store の状態に従って描く
import type { ComponentType } from 'react';
import { DIALOGS } from '../dialogs';
import type { DialogProps } from '../dialogs/registry';
import { PANELS } from '../panels';
import type { PanelPosition } from '../store/types';
import { useAppState, useStore, useT } from '../store/hooks';
import { CloseIcon } from './icons';
import { MenuList, menuEntriesToItems } from './MenuList';

const DIALOG_BY_ID = new Map(DIALOGS.map((d) => [d.id, d.component as ComponentType<DialogProps<unknown>>]));

export function DialogHost() {
  const store = useStore();
  const dialogs = useAppState((s) => s.dialogs);
  return (
    <>
      {dialogs.map((entry) => {
        const Component = DIALOG_BY_ID.get(entry.id);
        if (Component === undefined) return null;
        return <Component key={entry.key} store={store} args={entry.args} close={() => store.closeDialog(entry.key)} />;
      })}
    </>
  );
}

const PANEL_BY_ID = new Map(PANELS.map((p) => [p.id, p]));

export function PanelHost({ position }: { position: PanelPosition }) {
  const store = useStore();
  const t = useT();
  const id = useAppState((s) => s.panels[position]);
  const def = id === null ? undefined : PANEL_BY_ID.get(id);
  if (def === undefined) return null;
  const Component = def.component;
  const size = def.size ?? (position === 'right' ? 320 : 200);
  return (
    <aside
      className={`sc-panel sc-panel-${position}`}
      style={position === 'right' ? { width: size } : { height: size }}
      data-testid={`panel-${def.id}`}
    >
      <header className="sc-panel-header">
        <span>{t(def.titleKey)}</span>
        <button type="button" className="sc-icon-button" title={t('ui.panel.close')} onClick={() => store.closePanel(position)}>
          <CloseIcon />
        </button>
      </header>
      <div className="sc-panel-body">
        <Component store={store} close={() => store.closePanel(position)} />
      </div>
    </aside>
  );
}

export function ContextMenuHost() {
  const store = useStore();
  const menu = useAppState((s) => s.contextMenu);
  if (menu === null) return null;
  const close = () => {
    store.closeContextMenu();
    store.focusGrid();
  };
  return (
    <div className="sc-menu-layer" onMouseDown={(e) => e.target === e.currentTarget && close()} onContextMenu={(e) => e.preventDefault()}>
      <MenuList
        items={menuEntriesToItems(store, menu.items)}
        onClose={close}
        style={{ position: 'fixed', left: menu.x, top: menu.y }}
        testId="context-menu"
      />
    </div>
  );
}
