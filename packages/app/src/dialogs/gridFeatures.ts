// グリッドの追加操作（段階 6）の小さな画面: フィルタ・セル色の一覧・メモの編集欄
import { cellColorDialog } from './cellColor';
import { filterDialog } from './filter';
import { noteDialog } from './note';
import type { DialogDef } from './registry';

export const gridFeatureDialogs: readonly DialogDef[] = [filterDialog, cellColorDialog, noteDialog];
