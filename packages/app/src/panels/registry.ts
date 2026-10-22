// パネルの置き場（右側と下側）。パネルは機能ごとのファイル（panels/<機能>.tsx）に書き、panels/index.ts の一覧に 1 行足して登録する
import type { ShortcutId } from '@masterdata-maker/core';
import type { ComponentType } from 'react';
import type { CommandDef } from '../commands/registry';
import { panelRegion, requestRegionFocus } from '../components/focusRegions';
import type { AppStore } from '../store/AppStore';
import type { PanelPosition } from '../store/types';

export interface PanelProps {
  store: AppStore;
  close(): void;
}

export interface PanelDef {
  id: string;
  /** 見出しの文言キー（表示メニューの項目名にも使う） */
  titleKey: string;
  position: PanelPosition;
  component: ComponentType<PanelProps>;
  /** 既定の大きさ（右なら幅、下なら高さ。ピクセル） */
  size?: number;
  /** 表示メニューに開閉の項目を出す（操作の識別子は `panel.<id>`） */
  menu?: { group: number; order: number };
  shortcut?: ShortcutId;
}

/** パネルの開閉の操作（`panel.<id>`）。表示メニューやキー操作から呼ぶ。開いたらフォーカスをパネルへ移す（NFR-40） */
export function panelCommand(def: PanelDef): CommandDef {
  return {
    id: `panel.${def.id}`,
    labelKey: def.titleKey,
    shortcut: def.shortcut,
    menu: def.menu === undefined ? undefined : { menu: 'view', ...def.menu },
    enabled: (store) => store.project !== null,
    checked: (store) => store.isPanelOpen(def.id),
    run: (store) => {
      if (store.getState().panels[def.position] !== def.id) requestRegionFocus(store, panelRegion(def.position));
      store.togglePanel(def.id, def.position);
    },
  };
}
