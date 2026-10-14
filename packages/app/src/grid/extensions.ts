// グリッドの拡張点。機能ごとのファイルで GridExtension を作り、grid/extensions/index.ts の一覧に 1 行足して登録する。
// - contextMenu: 右クリック（セル・行番号・列ヘッダー・シートタブの 4 か所。FR-CTX-01）で出すメニューの項目
// - decorateCell: セルの装飾（枠・印・添える文字など）
// - overlay: 選択範囲の上に重ねる要素（フィルハンドルなど）
// - pointerDown: グリッドのマウス操作を先に受け取る（フィルハンドルのドラッグなど）
import type { Cell, CellResult, Selection, Severity, Table, TableRecord } from '@sheetcraft/core';
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import type { CellDisplay } from '../sheet/display';
import type { SheetColumn, SheetModel } from '../sheet/model';
import type { AppStore } from '../store/AppStore';
import type { MenuEntry } from '../store/types';
import type { GridGeometry, GridHit, ScrollPos } from './layout';

export type ContextMenuArea = 'cell' | 'rowHeader' | 'columnHeader' | 'sheetTab';

/** 右クリックした場所 */
export interface ContextMenuRequest {
  area: ContextMenuArea;
  /** テーブルの uid（シートタブなら、そのタブのテーブル。読み込みエラーのテーブルのこともある） */
  table: number;
  /** 表示上の行（cell・rowHeader） */
  row?: number;
  /** 表示上の列（cell・columnHeader） */
  col?: number;
  /** その行のレコードの uid */
  record?: number;
  /** その列の列名 */
  column?: string;
  /** クライアント座標（メニューを出す位置） */
  clientX: number;
  clientY: number;
}

/** セルを描くときに渡す情報 */
export interface CellRenderContext {
  store: AppStore;
  table: Table;
  sheet: SheetModel;
  row: number;
  col: number;
  record: TableRecord;
  column: SheetColumn;
  /** ファイル上のセル（値・式・色・メモ） */
  cell: Cell | undefined;
  /** 計算した実効値 */
  result: CellResult;
  display: CellDisplay;
  /** 検査の結果（そのセルの重い方の重大度） */
  issue: Severity | undefined;
}

export interface CellDecoration {
  className?: string;
  style?: CSSProperties;
  /** マウスを重ねたときの説明 */
  title?: string;
  /** セルの中に足す要素（文字の後ろに置く） */
  children?: ReactNode;
}

/** 選択範囲の上に重ねる要素に渡す情報（座標は layout.ts の本体座標。geometry.rangeRects などで求める） */
export interface GridOverlayProps {
  store: AppStore;
  sheet: SheetModel;
  geometry: GridGeometry;
  selection: Selection;
  scroll: ScrollPos;
  editing: boolean;
  /** 固定列のペインに描くか（固定列のペインと本体の 2 回描かれる） */
  pane: 'frozen' | 'body';
}

/** グリッドの上でのマウス操作（pointerdown）に渡す情報 */
export interface GridPointerEvent {
  store: AppStore;
  sheet: SheetModel;
  geometry: GridGeometry;
  hit: GridHit;
  /** スクロールする容器の左上からの座標 */
  x: number;
  y: number;
  scroll: ScrollPos;
  event: PointerEvent;
  /** スクロールする容器（ポインタのキャプチャなどに使う） */
  scroller: HTMLElement;
}

export interface GridExtension {
  id: string;
  /** 右クリックのメニューの項目。null なら出さない。複数の拡張が返した項目は区切り線でつなぐ */
  contextMenu?(request: ContextMenuRequest, store: AppStore): MenuEntry[] | null;
  /** セルの装飾。描くたびに見えているセルの数だけ呼ばれるので、軽くする */
  decorateCell?(ctx: CellRenderContext): CellDecoration | null;
  /** 選択範囲の上に重ねる要素 */
  overlay?: ComponentType<GridOverlayProps>;
  /** true を返せば、グリッドの既定の処理（選択など）をしない */
  pointerDown?(e: GridPointerEvent): boolean;
}

/** 右クリックのメニューを開く。どの拡張も項目を返さなければ false（ブラウザのメニューを出す） */
export function dispatchContextMenu(store: AppStore, extensions: readonly GridExtension[], request: ContextMenuRequest): boolean {
  const items: MenuEntry[] = [];
  for (const ext of extensions) {
    const entries = ext.contextMenu?.(request, store);
    if (entries === null || entries === undefined || entries.length === 0) continue;
    if (items.length > 0) items.push({ kind: 'separator' });
    items.push(...entries);
  }
  if (items.length === 0) return false;
  store.openContextMenu(request.clientX, request.clientY, items);
  return true;
}
