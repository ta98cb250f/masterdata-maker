// 段階6・7 のダイアログ（列の設定・列の挿入・テーブル・検索と置換・ショートカット一覧・共通設定・連番入力）
import { columnInsertDialog } from './columnInsert';
import { columnSettingsDialog } from './columnSettings';
import { commonSettingsDialog } from './commonSettings';
import { findReplaceDialog } from './findReplace';
import type { DialogDef } from './registry';
import { seriesDialog } from './series';
import { shortcutsDialog } from './shortcuts';
import { tableDeleteDialog, tableFormDialog } from './tableDialogs';

export const dialogPanelDialogs: readonly DialogDef[] = [
  columnSettingsDialog,
  columnInsertDialog,
  tableFormDialog,
  tableDeleteDialog,
  findReplaceDialog,
  shortcutsDialog,
  commonSettingsDialog,
  seriesDialog,
];
