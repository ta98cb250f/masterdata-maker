// 共通設定（列挙型・共通列・セル色。FR-TBL-03）の編集。Googleスプレッドシートの「ファイル > 設定」にあたる
import type { CommandDef } from './registry';

export const settingsCommands: CommandDef[] = [
  {
    id: 'settings.common',
    labelKey: 'ui.command.commonSettings',
    menu: { menu: 'file', group: 80, order: 0 },
    enabled: (store) => store.project !== null && store.getState().editing === null,
    run: (store, args) => {
      store.openDialog('settings.common', args);
    },
  },
];
