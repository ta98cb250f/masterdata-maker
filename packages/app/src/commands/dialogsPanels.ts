// 段階6・7 のダイアログとパネルの操作（列の設定・挿入・削除、テーブルの管理、検索と置換、ショートカット一覧、共通設定、連番入力）
import { columnCommands } from './columns';
import { findCommands } from './find';
import { helpCommands } from './help';
import type { CommandDef } from './registry';
import { seriesCommands } from './series';
import { settingsCommands } from './settings';
import { tableCommands } from './tables';

export const dialogPanelCommands: readonly CommandDef[] = [...columnCommands, ...tableCommands, ...findCommands, ...helpCommands, ...settingsCommands, ...seriesCommands];
