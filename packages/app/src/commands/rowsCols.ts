// 行・列の挿入と削除のキー操作（core の SHORTCUTS の insertRowsCols: Ctrl+Alt+= / ⌘+Option+=、deleteRowsCols: Ctrl+Alt+- / ⌘+Option+-）。
// Googleスプレッドシートと同じく、行を選んでいれば行（挿入は上に、選んだ行数だけ）、列を選んでいれば列（挿入は左に。列の挿入のダイアログ）を対象にする。
// セル範囲（と全体）を選んでいるときは、Googleスプレッドシートが挿入・削除の種類の一覧を出すのに合わせて、行か列かを選ぶ一覧を現在のセルの近くに出す。
// 型付きテーブル（D-1）にはセルだけをずらす操作が無いので、一覧は行と列の 2 つにする。どの操作も既存の row.* / column.* を呼ぶ
import { activeCellOrGridRect } from '../grid/domAnchors';
import type { AppStore } from '../store/AppStore';
import type { MenuEntry } from '../store/types';
import { gridReady } from './helpers';
import type { CommandDef } from './registry';

/** 選択の形に応じて、行の操作か列の操作を呼ぶ。どちらとも決まらなければ、両方を並べた一覧を出す */
function runForSelection(store: AppStore, rowCommand: string, columnCommand: string): void {
  const uid = store.getState().activeTable;
  const sel = store.selection(uid);
  if (uid === null || sel === null) return;
  if (sel.kind === 'rows') {
    void store.run(rowCommand);
    return;
  }
  if (sel.kind === 'cols') {
    void store.run(columnCommand);
    return;
  }
  const items: MenuEntry[] = [
    { kind: 'command', command: rowCommand },
    { kind: 'command', command: columnCommand },
  ];
  const show = () => {
    const rect = activeCellOrGridRect();
    store.openContextMenu(rect === null ? 0 : rect.left + 8, rect === null ? 0 : rect.bottom, items);
  };
  // 現在のセルが見えるようにスクロールしてから、その位置に出す
  store.setSelection(sel, { reveal: true });
  if (typeof requestAnimationFrame === 'undefined') show();
  else requestAnimationFrame(show);
}

export const rowsColsCommands: CommandDef[] = [
  {
    id: 'rowsCols.insert',
    labelKey: 'ui.command.insertRowsCols',
    shortcut: 'insertRowsCols',
    enabled: gridReady,
    run: (store) => runForSelection(store, 'row.insertAbove', 'column.insertLeft'),
  },
  {
    id: 'rowsCols.delete',
    labelKey: 'ui.command.deleteRowsCols',
    shortcut: 'deleteRowsCols',
    enabled: gridReady,
    run: (store) => runForSelection(store, 'row.delete', 'column.delete'),
  },
];
