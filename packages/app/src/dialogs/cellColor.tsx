// 塗りつぶしの色（FR-ANN-01）: プリセットの色とラベル・「なし」の一覧。選んだ色を選択範囲にまとめて当てる
import type { KeyboardEvent } from 'react';
import { applyCellColor } from '../commands/annotations';
import { NoColorIcon } from '../components/gridIcons';
import { Popover } from '../components/Popover';
import type { AnchorRect } from '../grid/domAnchors';
import { useT } from '../store/hooks';
import '../styles/notes.css';
import type { DialogProps } from './registry';
import { defineDialog } from './registry';

export interface CellColorDialogArgs {
  anchor: AnchorRect;
}

function CellColorPalette({ store, args, close }: DialogProps<CellColorDialogArgs>) {
  const t = useT();
  const colors = store.project?.common.colors.items ?? [];
  const choose = (key: string | null) => {
    close();
    applyCellColor(store, key);
  };
  // 上下の矢印キーで項目を移る
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    e.preventDefault();
    next?.focus();
  };
  return (
    <Popover anchor={args.anchor} onDismiss={close} testId="cell-color-palette" label={t('ui.cellColor.command')} width={200}>
      <div className="sc-color-list" role="menu" onKeyDown={onKeyDown}>
        <button type="button" role="menuitem" className="sc-color-item" onClick={() => choose(null)} data-testid="cell-color-none">
          <span className="sc-color-none">
            <NoColorIcon />
          </span>
          <span>{t('ui.cellColor.none')}</span>
        </button>
        {colors.map((c) => (
          <button
            key={c.key}
            type="button"
            role="menuitem"
            className="sc-color-item"
            title={c.key}
            onClick={() => choose(c.key)}
            data-testid={`cell-color-${c.key}`}
          >
            <span className="sc-color-swatch" style={{ background: c.color }} />
            <span>{c.label ?? c.key}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}

export const cellColorDialog = defineDialog<CellColorDialogArgs>('cellColor', CellColorPalette);
