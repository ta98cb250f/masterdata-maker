// 操作の一覧。操作は機能ごとのファイル（commands/<機能>.ts）に書き、ここに 1 行足して登録する
import { PANELS } from '../panels';
import { panelCommand } from '../panels/registry';
import { dialogPanelCommands } from './dialogsPanels';
import { editCommands } from './edit';
import { exportCommands } from './export';
import { fileCommands } from './file';
import { gridFeatureCommands } from './gridFeatures';
import { localeCommands } from './locale';
import { navigateCommands } from './navigate';
import type { CommandDef } from './registry';
import { rowCommands } from './rows';

export const COMMAND_MODULES: readonly (readonly CommandDef[])[] = [fileCommands, editCommands, navigateCommands, rowCommands, gridFeatureCommands, exportCommands, localeCommands, dialogPanelCommands];

/** 登録するすべての操作（パネルの開閉の操作 `panel.<id>` を含む） */
export function allCommands(): CommandDef[] {
  return [...COMMAND_MODULES.flat(), ...PANELS.filter((p) => p.menu !== undefined || p.shortcut !== undefined).map(panelCommand)];
}
