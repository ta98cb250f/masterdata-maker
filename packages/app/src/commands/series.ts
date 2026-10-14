// 連番入力（FR-FIL-05）: 開始値と増分を入れて選択範囲を埋める
import { gridReady } from './helpers';
import type { CommandDef } from './registry';

export const seriesCommands: CommandDef[] = [
  {
    id: 'fill.series',
    labelKey: 'ui.command.fillSeries',
    menu: { menu: 'edit', group: 20, order: 20 },
    enabled: gridReady,
    run: (store) => {
      store.openDialog('fill.series');
    },
  },
];
