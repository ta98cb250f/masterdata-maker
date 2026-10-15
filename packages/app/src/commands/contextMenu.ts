// 右クリックメニューをキーで開く（Shift+F10 / ContextMenu キー。NFR-40）。
// 行全体を選んでいれば行番号の、列全体なら列ヘッダーの、それ以外は現在のセルのメニューを、現在のセルの近くに出す
import type { ContextMenuRequest } from '../grid/extensions';
import { dispatchContextMenu } from '../grid/extensions';
import { GRID_EXTENSIONS } from '../grid/extensions/index';
import { activeCellOrGridRect } from '../grid/domAnchors';
import type { AppStore } from '../store/AppStore';
import { gridReady } from './helpers';
import type { CommandDef } from './registry';

export function openContextMenuByKey(store: AppStore): void {
  const uid = store.getState().activeTable;
  const sheet = store.sheet(uid);
  if (uid === null || sheet === null || sheet.size.cols === 0) return;
  const show = () => {
    const sel = store.view(uid).selection;
    const rect = activeCellOrGridRect();
    if (rect === null) return;
    const { row, col } = sel.anchor;
    const base = { table: uid, clientX: rect.left + 8, clientY: rect.bottom };
    let request: ContextMenuRequest;
    if (sel.kind === 'rows') request = { ...base, area: 'rowHeader', row, record: sheet.rowUids[row] };
    else if (sel.kind === 'cols') request = { ...base, area: 'columnHeader', col, column: sheet.columns[col]?.name };
    else request = { ...base, area: 'cell', row, col, record: sheet.rowUids[row], column: sheet.columns[col]?.name };
    dispatchContextMenu(store, GRID_EXTENSIONS, request);
  };
  // 現在のセルが見えるようにスクロールしてから、その位置に出す
  const sel = store.view(uid).selection;
  store.setSelection(sel, { reveal: true });
  if (typeof requestAnimationFrame === 'undefined') show();
  else requestAnimationFrame(show);
}

export const contextMenuCommands: CommandDef[] = [
  {
    id: 'grid.contextMenu',
    labelKey: 'ui.ctx.open',
    shortcut: 'contextMenu',
    enabled: gridReady,
    run: openContextMenuByKey,
  },
];
