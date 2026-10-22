// セル色とメモ（FR-ANN-01〜02）。セル色はプリセットから選んで範囲にまとめて当てる。メモは現在のセルの近くの小さな編集欄で書く
import { RichCell, setCellColor, setCellComment } from '@masterdata-maker/core';
import { FillColorIcon } from '../components/gridIcons';
import type { AnchorRect } from '../grid/domAnchors';
import { activeCellOrGridRect } from '../grid/domAnchors';
import type { AppStore } from '../store/AppStore';
import { gridReady, selectionTarget } from './helpers';
import type { CommandDef } from './registry';

/** セル色の操作の引数: 色のキー（null で解除）か、プリセットの一覧を開く位置 */
export type CellColorArgs = string | null | { at: { x: number; y: number } };

/** 選択範囲のセルにセル色を当てる（1 回の操作。FR-HIS-03） */
export function applyCellColor(store: AppStore, color: string | null): void {
  const t = selectionTarget(store);
  const project = store.project;
  if (t === null || project === null) return;
  const cells = t.records.flatMap((record) => t.columns.map((column) => ({ record, column })));
  store.applyOrReport(setCellColor(project, { table: t.table.uid, cells, color }));
}

function toolbarButtonRect(): AnchorRect | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector<HTMLElement>('[data-testid="toolbar-cell.color"]');
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/** 現在のセルのメモ */
export function anchorComment(store: AppStore): string | undefined {
  const t = selectionTarget(store);
  if (t === null) return undefined;
  const record = t.sheet.recordAt(t.sel.anchor.row);
  const column = t.sheet.columns[t.sel.anchor.col];
  const cell = column === undefined ? undefined : record?.cells.get(column.name);
  return cell instanceof RichCell && cell.comment !== undefined && cell.comment !== '' ? cell.comment : undefined;
}

/** 範囲のうちメモのあるセル */
function commentedCells(store: AppStore): { record: number; column: string }[] {
  const t = selectionTarget(store);
  if (t === null) return [];
  const records = new Map(t.records.map((uid, i) => [uid, t.sheet.recordAt(t.range.top + i)]));
  return t.records.flatMap((uid) =>
    t.columns.flatMap((column) => {
      const cell = records.get(uid)?.cells.get(column);
      return cell instanceof RichCell && cell.comment !== undefined ? [{ record: uid, column }] : [];
    }),
  );
}

/** メモの編集欄を開く（Shift+F2。FR-ANN-02） */
export function openNoteEditor(store: AppStore): void {
  const t = selectionTarget(store);
  if (t === null) return;
  const record = t.sheet.recordAt(t.sel.anchor.row);
  const column = t.sheet.columns[t.sel.anchor.col];
  const anchor = activeCellOrGridRect();
  if (record === undefined || column === undefined || anchor === null) return;
  store.openDialog('cellNote', { table: t.table.uid, record: record.uid, column: column.name, anchor });
}

export const annotationCommands: CommandDef[] = [
  {
    id: 'cell.color',
    labelKey: 'ui.cellColor.command',
    toolbar: { group: 20, order: 0, icon: FillColorIcon },
    enabled: gridReady,
    run: (store, args) => {
      const a = args as CellColorArgs | undefined;
      if (a === null || typeof a === 'string') {
        applyCellColor(store, a);
        return;
      }
      const at = a?.at;
      const anchor: AnchorRect | null = at !== undefined ? { left: at.x, top: at.y, right: at.x, bottom: at.y } : (toolbarButtonRect() ?? activeCellOrGridRect());
      if (anchor !== null) store.openDialog('cellColor', { anchor });
    },
  },
  {
    // args に { remove: true } を渡すと、範囲のメモを消す
    id: 'cell.comment',
    labelKey: 'ui.note.insert',
    label: (store) => store.t(anchorComment(store) === undefined ? 'ui.note.insert' : 'ui.note.edit'),
    shortcut: 'insertNote',
    menu: { menu: 'insert', group: 10, order: 0 },
    enabled: gridReady,
    run: (store, args) => {
      if ((args as { remove?: boolean } | undefined)?.remove !== true) {
        openNoteEditor(store);
        return;
      }
      const project = store.project;
      const uid = store.getState().activeTable;
      const cells = commentedCells(store);
      if (project !== null && uid !== null && cells.length > 0) store.applyOrReport(setCellComment(project, { table: uid, cells, comment: null }));
    },
  },
];
