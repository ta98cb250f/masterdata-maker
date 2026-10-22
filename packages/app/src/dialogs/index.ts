// ダイアログの一覧。ダイアログは機能ごとのファイルに書き、ここに 1 行足して登録する
import { backupRestoreDialog } from './backup';
import { columnResizeDialog } from './columnResize';
import { confirmDialog, messageDialog } from './common';
import { dialogPanelDialogs } from './dialogsPanels';
import { exportDialog } from './export';
import { externalChangesDialog } from './externalChanges';
import { githubDialogs } from './github';
import { gridFeatureDialogs } from './gridFeatures';
import type { DialogDef } from './registry';

export const DIALOGS: readonly DialogDef[] = [messageDialog, confirmDialog, ...gridFeatureDialogs, exportDialog, externalChangesDialog, backupRestoreDialog, ...dialogPanelDialogs, columnResizeDialog, ...githubDialogs];
