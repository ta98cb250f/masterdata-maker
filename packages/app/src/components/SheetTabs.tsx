// シートタブ（FR-UI-05）: 新しいテーブルを足す +、全シートの一覧（≡）、テーブルごとのタブ（未保存の印・エラーの件数）。
// 並びは P-06（テーブル名の昇順）。
// キー操作（NFR-40）: F6 で移ってくると表示中のタブにフォーカスが入る。← → と Home / End でボタンの間を動き、Enter・Space で
// そのテーブルを開く。Shift+F10（ContextMenu キー）でタブの右クリックメニュー、F2 で名前の変更、Esc でグリッドへ戻る。
// 全シートの一覧は Alt+Shift+K でも開け、Esc で閉じると開く前の場所へフォーカスを戻す
import type { KeyboardEvent, MouseEvent } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { dispatchContextMenu } from '../grid/extensions';
import { GRID_EXTENSIONS } from '../grid/extensions/index';
import { useAppState, useStore, useT } from '../store/hooks';
import { moveAmongButtons, registerSheetListOpener } from './focusRegions';
import { ErrorIcon, ListIcon, PlusIcon } from './icons';
import type { MenuListItem } from './MenuList';
import { MenuList } from './MenuList';

/** 新しいテーブルを足す操作の識別子（操作は後の段階で登録する） */
export const CREATE_TABLE_COMMAND = 'table.create';

export function SheetTabs() {
  const store = useStore();
  const t = useT();
  useAppState((s) => s.revision);
  useAppState((s) => s.validation.version);
  const active = useAppState((s) => s.activeTable);
  const status = useAppState((s) => s.status);
  const [listOpen, setListOpen] = useState(false);
  const listButton = useRef<HTMLButtonElement>(null);
  const activeTab = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  /** 全シートの一覧を開く前にフォーカスがあった要素（Esc で閉じたときに戻す） */
  const returnFocus = useRef<Element | null>(null);
  const tabs = store.tabs();

  useLayoutEffect(() => {
    activeTab.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  useEffect(() => {
    registerSheetListOpener(store, () => {
      returnFocus.current = document.activeElement;
      setListOpen(true);
    });
    return () => registerSheetListOpener(store, null);
  }, [store]);

  const closeList = () => {
    setListOpen(false);
    const back = returnFocus.current;
    returnFocus.current = null;
    if (back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
    else store.focusGrid();
  };

  const openTabMenu = (uid: number, x: number, y: number): boolean =>
    dispatchContextMenu(store, GRID_EXTENSIONS, { area: 'sheetTab', table: uid, clientX: x, clientY: y });

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, uid: number) => {
    if ((e.key === 'F10' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) || e.key === 'ContextMenu') {
      const r = e.currentTarget.getBoundingClientRect();
      e.preventDefault();
      openTabMenu(uid, r.left + 8, r.top);
    } else if (e.key === 'F2' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      void store.run('table.rename', { table: uid });
    }
  };

  const listItems: MenuListItem[] = tabs.map((tab) => ({
    kind: 'item',
    key: String(tab.uid),
    label: tab.label === tab.name ? tab.name : `${tab.label} (${tab.name})`,
    checked: tab.uid === active,
    onSelect: () => {
      store.setActiveTable(tab.uid);
      store.focusGrid();
    },
    testId: `sheet-list-${tab.name}`,
  }));
  const rect = listButton.current?.getBoundingClientRect();

  return (
    <div className="sc-sheetbar" ref={barRef} data-region="sheetTabs" onKeyDown={(e) => !listOpen && moveAmongButtons(e, barRef.current)}>
      <button
        type="button"
        className="sc-icon-button"
        title={t('ui.sheets.add')}
        aria-label={t('ui.sheets.add')}
        disabled={!store.isEnabled(CREATE_TABLE_COMMAND)}
        onClick={() => void store.run(CREATE_TABLE_COMMAND)}
        // テーブルが 1 つも無いときは、F6 で入ったときにここにフォーカスを置く
        data-region-fallback=""
        data-testid="sheet-add"
      >
        <PlusIcon />
      </button>
      <button
        ref={listButton}
        type="button"
        className={`sc-icon-button${listOpen ? ' checked' : ''}`}
        title={t('ui.sheets.all')}
        aria-label={t('ui.sheets.all')}
        aria-haspopup="menu"
        onClick={() => {
          returnFocus.current = document.activeElement;
          setListOpen(!listOpen);
        }}
        data-testid="sheet-list"
      >
        <ListIcon />
      </button>
      {listOpen && rect !== undefined && (
        <div className="sc-menu-layer" onMouseDown={(e) => e.target === e.currentTarget && setListOpen(false)}>
          <MenuList
            items={listItems}
            onClose={closeList}
            initialIndex={Math.max(0, tabs.findIndex((tab) => tab.uid === active))}
            style={{ position: 'fixed', left: rect.left, bottom: window.innerHeight - rect.top + 4 }}
            testId="sheet-list-menu"
          />
        </div>
      )}
      <div className="sc-tabs" role="tablist">
        {tabs.map((tab) => {
          const issues = store.issues(tab.name);
          const modified = store.isTableModified(tab.uid);
          const selected = tab.uid === active;
          return (
            <button
              key={tab.uid}
              ref={selected ? activeTab : undefined}
              type="button"
              role="tab"
              aria-selected={selected}
              // Tab で入るのは表示中のタブだけ（ほかのタブへは ← →）
              tabIndex={selected ? 0 : -1}
              data-region-focus={selected ? '' : undefined}
              className={`sc-tab${selected ? ' active' : ''}${tab.broken ? ' broken' : ''}`}
              title={tab.label === tab.name ? tab.name : `${tab.label} (${tab.name})`}
              data-testid={`sheet-tab-${tab.name}`}
              data-modified={modified ? 'true' : 'false'}
              onClick={() => {
                store.setActiveTable(tab.uid);
                store.focusGrid();
              }}
              onDoubleClick={() => void store.run('table.rename', { table: tab.uid })}
              onKeyDown={(e) => onTabKeyDown(e, tab.uid)}
              onContextMenu={(e: MouseEvent<HTMLButtonElement>) => {
                // キーで開いたメニューの後に、ブラウザの contextmenu が続いても開き直さない
                if (store.getState().contextMenu !== null) {
                  e.preventDefault();
                  return;
                }
                if (openTabMenu(tab.uid, e.clientX, e.clientY)) e.preventDefault();
              }}
            >
              {tab.broken && (
                <span className="sc-tab-broken" aria-label={t('ui.sheets.broken')}>
                  <ErrorIcon />
                </span>
              )}
              <span className="sc-tab-label">{tab.label}</span>
              {modified && (
                <span className="sc-tab-modified" title={t('ui.sheets.modified')} data-testid="tab-modified">
                  ●
                </span>
              )}
              {issues !== undefined && issues.errors > 0 && (
                <span className="sc-tab-count error" title={t('ui.sheets.errors', { count: issues.errors })} data-testid="tab-errors">
                  {issues.errors}
                </span>
              )}
              {issues !== undefined && issues.errors === 0 && issues.warnings > 0 && (
                <span className="sc-tab-count warning" title={t('ui.sheets.warnings', { count: issues.warnings })}>
                  {issues.warnings}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className={`sc-status${status?.kind === 'error' ? ' error' : ''}`} role="status" data-testid="status">
        {status?.text ?? ''}
      </div>
    </div>
  );
}
