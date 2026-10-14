// グリッドの追加操作（段階 6）の操作: 列の固定・非表示、並べ替えとフィルタ、セル色とメモ、参照先への移動、行の複製、
// 行・列の移動（メニューとキー）、キーで開く右クリックメニュー
import { annotationCommands } from './annotations';
import { columnViewCommands } from './columnView';
import { contextMenuCommands } from './contextMenu';
import { moveRowsColsCommands } from './moveRowsCols';
import { referenceCommands } from './reference';
import type { CommandDef } from './registry';
import { rowDuplicateCommands } from './rowDuplicate';
import { sortFilterCommands } from './sortFilter';

export const gridFeatureCommands: readonly CommandDef[] = [
  ...columnViewCommands,
  ...sortFilterCommands,
  ...annotationCommands,
  ...referenceCommands,
  ...rowDuplicateCommands,
  ...moveRowsColsCommands,
  ...contextMenuCommands,
];
