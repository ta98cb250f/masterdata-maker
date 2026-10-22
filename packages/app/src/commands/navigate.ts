// 移動と選択（FR-SEL-01〜05、R-1）。キー操作は core の SHORTCUTS の割り当てに従う
import type { Direction, GridSize, IsEmpty, Selection, ShortcutId } from '@masterdata-maker/core';
import {
  extendCell,
  extendToDataEdge,
  extendToSheetEnd,
  extendToSheetStart,
  moveCell,
  moveToDataEdge,
  moveToRowEnd,
  moveToRowStart,
  moveToSheetEnd,
  moveToSheetStart,
  selectAll,
  selectCols,
  selectRows,
} from '@masterdata-maker/core';
import { openSheetList } from '../components/focusRegions';
import type { AppStore } from '../store/AppStore';
import { emptyCellTest, gridReady } from './helpers';
import type { CommandDef } from './registry';

type Move = (sel: Selection, size: GridSize, isEmpty: IsEmpty) => Selection;

function selectionCommand(id: string, shortcut: ShortcutId, move: Move, labelKey = `sheet.shortcut.${shortcut}`): CommandDef {
  return {
    id,
    labelKey,
    shortcut,
    enabled: gridReady,
    run(store: AppStore) {
      const sheet = store.sheet();
      const sel = store.selection();
      if (sheet === null || sel === null) return;
      store.setSelection(move(sel, sheet.size, emptyCellTest(store)), { reveal: true });
    },
  };
}

const DIRECTIONS: [Direction, string][] = [
  ['up', 'Up'],
  ['down', 'Down'],
  ['left', 'Left'],
  ['right', 'Right'],
];

export const navigateCommands: CommandDef[] = [
  ...DIRECTIONS.flatMap(([dir, name]): CommandDef[] => [
    selectionCommand(`nav.move${name}`, `move${name}` as ShortcutId, (sel, size) => moveCell(sel, dir, size)),
    selectionCommand(`nav.moveEdge${name}`, `moveEdge${name}` as ShortcutId, (sel, size, isEmpty) => moveToDataEdge(sel, dir, size, isEmpty)),
    selectionCommand(`nav.extend${name}`, `extend${name}` as ShortcutId, (sel, size) => extendCell(sel, dir, size)),
    selectionCommand(`nav.extendEdge${name}`, `extendEdge${name}` as ShortcutId, (sel, size, isEmpty) =>
      extendToDataEdge(sel, dir, size, isEmpty),
    ),
  ]),
  selectionCommand('nav.moveRowStart', 'moveRowStart', (sel, size) => moveToRowStart(sel, size)),
  selectionCommand('nav.moveRowEnd', 'moveRowEnd', (sel, size) => moveToRowEnd(sel, size)),
  selectionCommand('nav.moveSheetStart', 'moveSheetStart', (_sel, size) => moveToSheetStart(size)),
  selectionCommand('nav.moveSheetEnd', 'moveSheetEnd', (_sel, size) => moveToSheetEnd(size)),
  selectionCommand('nav.extendSheetStart', 'extendSheetStart', (sel, size) => extendToSheetStart(sel, size)),
  selectionCommand('nav.extendSheetEnd', 'extendSheetEnd', (sel, size) => extendToSheetEnd(sel, size)),
  {
    ...selectionCommand('nav.selectAll', 'selectAll', (sel, size) => selectAll(sel, size)),
    labelKey: 'ui.command.selectAll',
    menu: { menu: 'edit', group: 30, order: 10 },
  },
  selectionCommand('nav.selectRow', 'selectRow', (sel, size) => selectRows(sel, size)),
  selectionCommand('nav.selectColumn', 'selectColumn', (sel, size) => selectCols(sel, size)),
  // セルを選んでいるときの Tab / Shift+Tab / Shift+Enter（範囲を選んでいれば範囲の中を巡回する）
  ...(['tab', 'shiftTab', 'shiftEnter'] as const).map(
    (key): CommandDef => ({
      id: `nav.${key}`,
      labelKey: `sheet.shortcut.${key}`,
      shortcut: key,
      enabled: gridReady,
      run: (store) => store.advanceSelection(key),
    }),
  ),
  {
    id: 'nav.nextSheet',
    labelKey: 'sheet.shortcut.nextSheet',
    shortcut: 'nextSheet',
    enabled: (store) => store.tabs().length > 1,
    run: (store) => store.moveActiveTable(1),
  },
  {
    id: 'nav.prevSheet',
    labelKey: 'sheet.shortcut.prevSheet',
    shortcut: 'prevSheet',
    enabled: (store) => store.tabs().length > 1,
    run: (store) => store.moveActiveTable(-1),
  },
  {
    // 全シートの一覧（シートタブの ≡ と同じ一覧）を開く
    id: 'nav.sheetList',
    labelKey: 'sheet.shortcut.showSheetList',
    shortcut: 'showSheetList',
    enabled: (store) => store.tabs().length > 0,
    run: (store) => {
      openSheetList(store);
    },
  },
];
