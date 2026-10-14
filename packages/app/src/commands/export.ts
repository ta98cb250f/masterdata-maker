// 画面からの出力（FR-OUT-06）: ファイルのメニューの「出力」
import type { CommandDef } from './registry';

export const exportCommands: CommandDef[] = [
  {
    id: 'file.export',
    labelKey: 'ui.command.export',
    menu: { menu: 'file', group: 20, order: 0 },
    enabled: (store) => store.project !== null,
    run: (store) => {
      // 編集中なら先に確定する（確定できなければ出力しない）
      if (store.getState().editing !== null && !store.commitEdit(null)) return;
      store.openDialog('export');
    },
  },
];
