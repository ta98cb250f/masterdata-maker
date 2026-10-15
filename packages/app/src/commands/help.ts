// ヘルプ: キーボード ショートカットの一覧（FR-ETC-01。Ctrl+/）
import type { CommandDef } from './registry';

export const helpCommands: CommandDef[] = [
  {
    id: 'help.shortcuts',
    labelKey: 'ui.command.shortcuts',
    shortcut: 'showShortcuts',
    menu: { menu: 'help', group: 0, order: 0 },
    run: (store) => {
      if (!store.isDialogOpen('shortcuts')) store.openDialog('shortcuts');
    },
  },
];
