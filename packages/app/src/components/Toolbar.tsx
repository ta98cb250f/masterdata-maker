// ツールバー（FR-UI-01）。項目は操作の登録簿から作る。押してもグリッドのフォーカスを奪わない
import { createElement } from 'react';
import { useAppState, useStore } from '../store/hooks';
import { ICONS } from './icons';
import { shortcutText } from './MenuList';

export function Toolbar() {
  const store = useStore();
  // 使える・使えないは状態から決まるので、状態が変わるたびに描き直す（項目は少ない）
  useAppState((s) => s);
  const groups = store.commands.toolbarGroups();
  return (
    <div className="sc-toolbar" role="toolbar">
      {groups.map((group, gi) => (
        <div key={gi} className="sc-toolbar-group">
          {group.map((def) => {
            const icon = def.toolbar?.icon;
            const Icon = typeof icon === 'string' ? ICONS[icon] : icon;
            const label = store.commandLabel(def.id);
            const shortcut = shortcutText(store, def.id);
            const checked = def.checked?.(store) === true;
            return (
              <button
                key={def.id}
                type="button"
                className={`sc-icon-button${checked ? ' checked' : ''}`}
                title={shortcut === undefined ? label : `${label} (${shortcut})`}
                aria-label={label}
                aria-pressed={def.checked === undefined ? undefined : checked}
                disabled={!store.isEnabled(def.id)}
                data-testid={`toolbar-${def.id}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  void store.run(def.id);
                  store.focusGrid();
                }}
              >
                {Icon === undefined ? label : createElement(Icon)}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
