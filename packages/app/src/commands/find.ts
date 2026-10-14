// 検索と置換（FR-FND-01〜04）: Ctrl+F で右上の小さな検索欄、Ctrl+H（Mac は ⌘+Shift+H）で検索と置換のダイアログ
import { findBar } from '../components/findBarState';
import type { CommandDef } from './registry';

export const findCommands: CommandDef[] = [
  {
    id: 'find.open',
    labelKey: 'ui.command.find',
    shortcut: 'find',
    menu: { menu: 'edit', group: 50, order: 0 },
    enabled: (store) => store.project !== null,
    run: (store) => {
      findBar(store).open();
    },
  },
  {
    id: 'find.replace',
    labelKey: 'ui.command.findReplace',
    shortcut: 'findReplace',
    menu: { menu: 'edit', group: 50, order: 1 },
    enabled: (store) => store.project !== null,
    run: (store, args) => {
      const bar = findBar(store);
      const query = (typeof args === 'object' && args !== null ? (args as { query?: string }).query : undefined) ?? bar.getState().query;
      bar.close();
      store.openDialog('find.replace', { query });
    },
  },
];
