// 操作の登録簿。メニューバー・ツールバー・キー操作・右クリックメニューは、すべて操作の識別子で操作を呼ぶ。
// 操作は機能ごとのファイル（commands/<機能>.ts）で定義し、commands/index.ts の一覧に 1 行足して登録する
import type { ShortcutId } from '@sheetcraft/core';
import type { ComponentType } from 'react';
import type { AppStore } from '../store/AppStore';

export type MenuId = 'file' | 'edit' | 'view' | 'insert' | 'data' | 'help';

/** メニューバーの並び（FR-UI-01） */
export const MENU_IDS: readonly MenuId[] = ['file', 'edit', 'view', 'insert', 'data', 'help'];

export interface MenuPlacement {
  menu: MenuId;
  /** 同じ group の項目をまとめ、group の間に区切り線を入れる（小さい順） */
  group: number;
  /** group の中の並び（小さい順） */
  order: number;
}

export interface ToolbarPlacement {
  group: number;
  order: number;
  /** components/icons.tsx の ICONS の名前か、アイコンのコンポーネント */
  icon: string | ComponentType;
}

export interface CommandDef {
  /** 操作の識別子（例: `edit.undo`） */
  id: string;
  /** 名前の文言キー（`ui.` で始まる。core の文言キーでもよい） */
  labelKey: string;
  /** 名前を状態に応じて変えるとき（例: 「元に戻す: 貼り付け」） */
  label?(store: AppStore): string;
  /** core の SHORTCUTS の識別子。キー操作でこの操作を呼ぶ */
  shortcut?: ShortcutId;
  /**
   * キー操作のときはブラウザの既定の動作に任せる（コピー・切り取り・貼り付けは copy / cut / paste のイベントで行う）。
   * before はキーを押したときに呼ぶ（例: 値のみ貼り付けの印を立てる）
   */
  native?: { before?(store: AppStore): void };
  menu?: MenuPlacement;
  toolbar?: ToolbarPlacement;
  /** 使えるか（省略時は常に使える） */
  enabled?(store: AppStore): boolean;
  /** チェックの印を付けるか（パネルの開閉など） */
  checked?(store: AppStore): boolean;
  /** 実行する。args は右クリックメニューなどから渡す引数 */
  run(store: AppStore, args?: unknown): void | Promise<void>;
}

export class CommandRegistry {
  private readonly byId = new Map<string, CommandDef>();
  private readonly byShortcutId = new Map<ShortcutId, CommandDef>();

  constructor(defs: Iterable<CommandDef> = []) {
    for (const def of defs) this.register(def);
  }

  /** 登録する。同じ識別子・同じショートカットは後から登録したものが優先される */
  register(def: CommandDef): void {
    const old = this.byId.get(def.id);
    if (old?.shortcut !== undefined && this.byShortcutId.get(old.shortcut) === old) this.byShortcutId.delete(old.shortcut);
    this.byId.set(def.id, def);
    if (def.shortcut !== undefined) this.byShortcutId.set(def.shortcut, def);
  }

  get(id: string): CommandDef | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): CommandDef[] {
    return [...this.byId.values()];
  }

  byShortcut(id: ShortcutId): CommandDef | undefined {
    return this.byShortcutId.get(id);
  }

  /** メニューの項目（group ごとに分けた並び） */
  menuGroups(menu: MenuId): CommandDef[][] {
    return groupBy(
      this.all().filter((d) => d.menu?.menu === menu),
      (d) => d.menu as MenuPlacement,
    );
  }

  /** ツールバーの項目（group ごとに分けた並び） */
  toolbarGroups(): CommandDef[][] {
    return groupBy(
      this.all().filter((d) => d.toolbar !== undefined),
      (d) => d.toolbar as ToolbarPlacement,
    );
  }
}

function groupBy(defs: CommandDef[], place: (d: CommandDef) => { group: number; order: number }): CommandDef[][] {
  const sorted = [...defs].sort((a, b) => place(a).group - place(b).group || place(a).order - place(b).order);
  const groups: CommandDef[][] = [];
  let current: number | null = null;
  for (const def of sorted) {
    const g = place(def).group;
    if (g !== current) {
      groups.push([]);
      current = g;
    }
    groups[groups.length - 1].push(def);
  }
  return groups;
}
