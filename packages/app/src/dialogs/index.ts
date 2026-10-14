// ダイアログの一覧。ダイアログは機能ごとのファイルに書き、ここに 1 行足して登録する
import { confirmDialog, messageDialog } from './common';
import type { DialogDef } from './registry';

export const DIALOGS: readonly DialogDef[] = [messageDialog, confirmDialog];
