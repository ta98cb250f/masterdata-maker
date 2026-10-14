// パネルの一覧。パネルは機能ごとのファイルに書き、ここに 1 行足して登録する（例: 問題パネル、セル情報パネル）
import { cellInfoPanel } from './cellInfo';
import { problemsPanel } from './problems';
import type { PanelDef } from './registry';

export const PANELS: readonly PanelDef[] = [problemsPanel, cellInfoPanel];
