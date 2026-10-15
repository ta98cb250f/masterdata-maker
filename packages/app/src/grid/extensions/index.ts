// グリッドの拡張の一覧。拡張は機能ごとのファイル（grid/extensions/<機能>.ts(x)）に書き、ここに 1 行足して登録する
import type { GridExtension } from '../extensions';
import { gridFeatureExtensions } from './gridFeatures';
import { sheetTabMenuExtension } from './sheetTabs';

export const GRID_EXTENSIONS: readonly GridExtension[] = [...gridFeatureExtensions, sheetTabMenuExtension];
