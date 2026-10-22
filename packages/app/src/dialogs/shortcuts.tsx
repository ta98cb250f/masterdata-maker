// キーボード ショートカットの一覧（FR-ETC-01。Ctrl+/）。core の SHORTCUTS を分類ごとに並べる。
// キーの表記は動いている環境（Windows など / Mac）に合わせ、切り替えても見られる。語で絞り込める
import type { Platform, ShortcutCategory, ShortcutDef } from '@masterdata-maker/core';
import { SHORTCUTS, categoryDescriptionKey, shortcutLabels } from '@masterdata-maker/core';
import { useMemo, useState } from 'react';
import { DialogFrame } from '../components/Dialog';
import { useT } from '../store/hooks';
import '../styles/dialogForms.css';
import type { DialogProps } from './registry';
import { defineDialog } from './registry';

/** 分類ごとのショートカット（分類は SHORTCUTS に初めて出てきた順） */
export function groupShortcuts(shortcuts: readonly ShortcutDef[]): [ShortcutCategory, ShortcutDef[]][] {
  const groups = new Map<ShortcutCategory, ShortcutDef[]>();
  for (const s of shortcuts) {
    let list = groups.get(s.category);
    if (list === undefined) {
      list = [];
      groups.set(s.category, list);
    }
    list.push(s);
  }
  return [...groups];
}

function ShortcutsDialog({ store, close }: DialogProps<void>) {
  const t = useT();
  const [platform, setPlatform] = useState<Platform>(store.platform);
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const matches = (s: ShortcutDef) =>
      q === '' || t(s.descriptionKey).toLowerCase().includes(q) || shortcutLabels(s, platform).some((k) => k.toLowerCase().includes(q));
    return groupShortcuts(SHORTCUTS.filter(matches));
  }, [filter, platform, t]);

  return (
    <DialogFrame
      title={t('ui.shortcuts.title')}
      onClose={close}
      width={860}
      testId="shortcuts-dialog"
      footer={
        <button type="button" className="sc-button primary" onClick={close}>
          {t('ui.dialog.ok')}
        </button>
      }
    >
      <div className="sc-inline" style={{ marginBottom: 12 }}>
        <input
          className="sc-text"
          value={filter}
          placeholder={t('ui.shortcuts.filter')}
          aria-label={t('ui.shortcuts.filter')}
          onChange={(e) => setFilter(e.target.value)}
          data-testid="shortcuts-filter"
        />
        <select
          className="sc-select"
          style={{ flex: 'none', width: 250 }}
          value={platform}
          aria-label={t('ui.shortcuts.platform')}
          onChange={(e) => setPlatform(e.target.value as Platform)}
          data-testid="shortcuts-platform"
        >
          <option value="other">{t('ui.shortcuts.platformOther')}</option>
          <option value="mac">{t('ui.shortcuts.platformMac')}</option>
        </select>
      </div>
      {groups.length === 0 && <p className="sc-form-info">{t('ui.shortcuts.noMatch')}</p>}
      <div className="sc-shortcuts">
        {groups.map(([category, list]) => (
          <div key={category} className="sc-shortcut-group" data-testid={`shortcuts-${category}`}>
            <h3>{t(categoryDescriptionKey(category))}</h3>
            {list.map((s) => (
              <div key={s.id} className="sc-shortcut-row" data-testid={`shortcut-${s.id}`}>
                <span>{t(s.descriptionKey)}</span>
                <span className="sc-shortcut-keys">
                  {shortcutLabels(s, platform).map((label) => (
                    <kbd key={label} className="sc-kbd">
                      {label}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </DialogFrame>
  );
}

export const shortcutsDialog = defineDialog<void>('shortcuts', ShortcutsDialog);
