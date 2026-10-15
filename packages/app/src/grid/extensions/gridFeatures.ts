// グリッドの追加操作（段階 6）の拡張。並びは pointerDown を受け取る順（先に true を返したものが処理する）
import type { GridExtension } from '../extensions';
import { contextMenuExtension } from './contextMenus';
import { fillHandleExtension } from './fillHandle';
import { notesExtension } from './notes';
import { referencesExtension } from './references';
import { reorderExtension } from './reorder';
import { sortFilterHeaderExtension } from './sortFilterHeader';

export const gridFeatureExtensions: readonly GridExtension[] = [
  fillHandleExtension,
  sortFilterHeaderExtension,
  referencesExtension,
  reorderExtension,
  notesExtension,
  contextMenuExtension,
];
