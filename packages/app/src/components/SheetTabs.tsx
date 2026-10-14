// シートタブ（FR-UI-05）: 新しいテーブルを足す +、全シートの一覧（≡）、テーブルごとのタブ（未保存の印・エラーの件数）。
// 並びは P-06（テーブル名の昇順）
import { useLayoutEffect, useRef, useState } from 'react';
import { dispatchContextMenu } from '../grid/extensions';
import { GRID_EXTENSIONS } from '../grid/extensions/index';
import { useAppState, useStore, useT } from '../store/hooks';
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
  const tabs = store.tabs();

  useLayoutEffect(() => {
    activeTab.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

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
    <div className="sc-sheetbar">
      <button
        type="button"
        className="sc-icon-button"
        title={t('ui.sheets.add')}
        aria-label={t('ui.sheets.add')}
        disabled={!store.isEnabled(CREATE_TABLE_COMMAND)}
        onClick={() => void store.run(CREATE_TABLE_COMMAND)}
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
        onClick={() => setListOpen(!listOpen)}
        data-testid="sheet-list"
      >
        <ListIcon />
      </button>
      {listOpen && rect !== undefined && (
        <div className="sc-menu-layer" onMouseDown={(e) => e.target === e.currentTarget && setListOpen(false)}>
          <MenuList
            items={listItems}
            onClose={() => setListOpen(false)}
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
              className={`sc-tab${selected ? ' active' : ''}${tab.broken ? ' broken' : ''}`}
              title={tab.label === tab.name ? tab.name : `${tab.label} (${tab.name})`}
              data-testid={`sheet-tab-${tab.name}`}
              data-modified={modified ? 'true' : 'false'}
              onClick={() => {
                store.setActiveTable(tab.uid);
                store.focusGrid();
              }}
              onDoubleClick={() => void store.run('table.rename', { table: tab.uid })}
              onContextMenu={(e) => {
                const handled = dispatchContextMenu(store, GRID_EXTENSIONS, { area: 'sheetTab', table: tab.uid, clientX: e.clientX, clientY: e.clientY });
                if (handled) e.preventDefault();
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
