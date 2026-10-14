// ダイアログの置き場。ダイアログは識別子で開閉する（store.openDialog(id, args) / store.closeDialog()）。
// ダイアログは機能ごとのファイル（dialogs/<機能>.tsx）に書き、dialogs/index.ts の一覧に 1 行足して登録する
import type { ComponentType } from 'react';
import type { AppStore } from '../store/AppStore';

export interface DialogProps<A = unknown> {
  store: AppStore;
  /** openDialog に渡した引数 */
  args: A;
  /** このダイアログを閉じる */
  close(): void;
}

export interface DialogDef {
  id: string;
  component: ComponentType<DialogProps<never>>;
}

/** ダイアログを定義する（引数の型を付けるため） */
export function defineDialog<A>(id: string, component: ComponentType<DialogProps<A>>): DialogDef {
  return { id, component: component as ComponentType<DialogProps<never>> };
}
