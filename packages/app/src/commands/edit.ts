// 編集の操作: 元に戻す・やり直す（FR-HIS-01）、コピー・切り取り・貼り付け（FR-CLP-01〜07）、
// 値の消去（FR-EDT-02）、編集の開始（FR-EDT-01）、下方向・右方向へのコピー（FR-FIL-04）
import { clearCells, enterInput, fillDown, fillRight, isFieldEditable } from '@sheetcraft/core';
import { pasteClipboard } from '../grid/clipboard';
import type { AppStore } from '../store/AppStore';
import { gridReady, hasSheet, selectionTarget } from './helpers';
import type { CommandDef } from './registry';

/** 見えない入力欄で copy / cut のイベントを起こす（メニューから呼ぶとき。許可の確認は出ない） */
function execClipboard(store: AppStore, kind: 'copy' | 'cut'): void {
  store.focusGrid();
  const ok = typeof document !== 'undefined' && document.execCommand(kind);
  if (!ok) store.showStatus(store.t('ui.clipboard.useShortcut'), 'error');
}

/** チェックボックスを切り替える（bool の列。Space・クリック。FR-EDT-03） */
export function toggleCheckboxes(store: AppStore): boolean {
  const t = selectionTarget(store);
  const project = store.project;
  if (t === null || project === null) return false;
  const anchorColumn = t.sheet.columns[t.sel.anchor.col];
  const anchorRecord = t.sheet.recordAt(t.sel.anchor.row);
  if (anchorColumn === undefined || anchorRecord === undefined || anchorColumn.field.type !== 'bool') return false;
  const current = t.calc.getCell(t.table, anchorRecord.uid, anchorColumn.name).raw === true;
  const columns = t.columns.filter((name) => {
    const field = t.sheet.columns[t.sheet.colOf(name)]?.field;
    return field !== undefined && field.type === 'bool' && isFieldEditable(field);
  });
  if (columns.length === 0) {
    store.showStatus(store.t('edit.error.readonlyColumn', { column: anchorColumn.field.display_name ?? anchorColumn.name }), 'error');
    return true;
  }
  const cells = t.records.flatMap((record) => columns.map((column) => ({ record, column })));
  store.applyOrReport(enterInput(project, { table: t.table.uid, cells, text: current ? 'FALSE' : 'TRUE' }));
  return true;
}

export const editCommands: CommandDef[] = [
  {
    id: 'edit.undo',
    labelKey: 'ui.command.undo',
    label: (store) => {
      const op = store.session?.undoLabel();
      return op === undefined ? store.t('ui.command.undo') : store.t('ui.command.undoOp', { op: store.t(op) });
    },
    shortcut: 'undo',
    menu: { menu: 'edit', group: 0, order: 0 },
    toolbar: { group: 0, order: 0, icon: 'undo' },
    enabled: (store) => store.session?.canUndo() ?? false,
    run: (store) => {
      store.undo();
    },
  },
  {
    id: 'edit.redo',
    labelKey: 'ui.command.redo',
    label: (store) => {
      const op = store.session?.redoLabel();
      return op === undefined ? store.t('ui.command.redo') : store.t('ui.command.redoOp', { op: store.t(op) });
    },
    shortcut: 'redo',
    menu: { menu: 'edit', group: 0, order: 1 },
    toolbar: { group: 0, order: 1, icon: 'redo' },
    enabled: (store) => store.session?.canRedo() ?? false,
    run: (store) => {
      store.redo();
    },
  },
  {
    id: 'edit.cut',
    labelKey: 'ui.command.cut',
    shortcut: 'cut',
    native: {},
    menu: { menu: 'edit', group: 10, order: 0 },
    enabled: gridReady,
    run: (store) => execClipboard(store, 'cut'),
  },
  {
    id: 'edit.copy',
    labelKey: 'ui.command.copy',
    shortcut: 'copy',
    native: {},
    menu: { menu: 'edit', group: 10, order: 1 },
    enabled: gridReady,
    run: (store) => execClipboard(store, 'copy'),
  },
  {
    // キー操作では paste のイベントで貼り付ける。メニューからは、本ツールの中でコピーした内容だけを貼り付けられる
    // （他のアプリのクリップボードを読むには許可の確認が要るため）
    id: 'edit.paste',
    labelKey: 'ui.command.paste',
    shortcut: 'paste',
    native: {},
    menu: { menu: 'edit', group: 10, order: 2 },
    enabled: gridReady,
    run: (store) => {
      if (store.clipboard === null) store.showStatus(store.t('ui.clipboard.useShortcut'), 'error');
      else pasteClipboard(store, store.clipboard.data, false);
    },
  },
  {
    id: 'edit.pasteValues',
    labelKey: 'ui.command.pasteValues',
    shortcut: 'pasteValues',
    native: {
      before: (store) => {
        store.pasteValuesPending = true;
      },
    },
    menu: { menu: 'edit', group: 10, order: 3 },
    enabled: gridReady,
    run: (store) => {
      if (store.clipboard === null) store.showStatus(store.t('ui.clipboard.useShortcut'), 'error');
      else pasteClipboard(store, store.clipboard.data, true);
    },
  },
  {
    id: 'edit.clear',
    labelKey: 'ui.command.clear',
    shortcut: 'clear',
    menu: { menu: 'edit', group: 20, order: 0 },
    enabled: gridReady,
    run: (store) => {
      const t = selectionTarget(store);
      const project = store.project;
      if (t === null || project === null) return;
      const cells = t.records.flatMap((record) => t.columns.map((column) => ({ record, column })));
      store.applyOrReport(clearCells(project, { table: t.table.uid, cells }));
    },
  },
  {
    id: 'edit.fillDown',
    labelKey: 'sheet.shortcut.fillDown',
    shortcut: 'fillDown',
    menu: { menu: 'edit', group: 20, order: 10 },
    enabled: gridReady,
    run: (store) => {
      const t = selectionTarget(store);
      const project = store.project;
      if (t === null || project === null) return;
      let rows = t.records;
      // 1 行だけなら、すぐ上の行をコピーする（Googleスプレッドシートと同じ）
      if (rows.length === 1) {
        const above = t.sheet.rowUids[t.range.top - 1];
        if (above === undefined) return;
        rows = [above, ...rows];
      }
      store.applyOrReport(fillDown(project, { table: t.table.uid, rows, columns: t.columns }));
    },
  },
  {
    id: 'edit.fillRight',
    labelKey: 'sheet.shortcut.fillRight',
    shortcut: 'fillRight',
    menu: { menu: 'edit', group: 20, order: 11 },
    enabled: gridReady,
    run: (store) => {
      const t = selectionTarget(store);
      const project = store.project;
      if (t === null || project === null) return;
      let columns = t.columns;
      if (columns.length === 1) {
        const left = t.sheet.columns[t.range.left - 1];
        if (left === undefined) return;
        columns = [left.name, ...columns];
      }
      store.applyOrReport(fillRight(project, { table: t.table.uid, rows: t.records, columns }));
    },
  },
  {
    id: 'edit.editCell',
    labelKey: 'sheet.shortcut.editCell',
    shortcut: 'editCell',
    enabled: gridReady,
    run: (store) => {
      store.beginEdit({ mode: 'edit' });
    },
  },
  {
    // セルを選んでいるときの Enter は、今の値を残して編集を始める（Googleスプレッドシートと同じ）
    id: 'edit.enter',
    labelKey: 'sheet.shortcut.enter',
    shortcut: 'enter',
    enabled: gridReady,
    run: (store) => {
      store.beginEdit({ mode: 'edit' });
    },
  },
  {
    id: 'edit.cancel',
    labelKey: 'sheet.shortcut.cancel',
    shortcut: 'cancel',
    enabled: hasSheet,
    run: (store) => {
      store.setClipboardMark(null);
    },
  },
  {
    id: 'edit.toggleCheckbox',
    labelKey: 'ui.command.toggleCheckbox',
    enabled: gridReady,
    run: (store) => {
      toggleCheckboxes(store);
    },
  },
];
