// 右クリックメニュー（FR-CTX-01）: セル・範囲、行番号、列ヘッダーの 3 か所（シートタブは別の拡張）。項目は要件書 §5.15 の表どおり。
// ほかの担当が登録する操作（列の設定・挿入・削除）は識別子で指し、まだ登録されていなければ自分の文言で無効の項目として出す
import { anchorComment } from '../../commands/annotations';
import { refCellOf, refKeyLabel } from '../../commands/reference';
import type { AppStore } from '../../store/AppStore';
import type { MenuEntry } from '../../store/types';
import type { ContextMenuRequest, GridExtension } from '../extensions';

/** 1 つのセルの参照先を、項目として並べる数の上限 */
const MAX_REF_ITEMS = 8;

const SEP: MenuEntry = { kind: 'separator' };

function command(command: string, extra: Omit<Extract<MenuEntry, { kind: 'command' }>, 'kind' | 'command'> = {}): MenuEntry {
  return { kind: 'command', command, ...extra };
}

/** ほかの担当の操作。登録されていなければ名前を自分の文言で出す（登録されていない項目は無効になる） */
function external(store: AppStore, id: string, fallbackLabelKey: string, args: unknown): MenuEntry {
  return store.commands.has(id) ? command(id, { args }) : command(id, { args, labelKey: fallbackLabelKey });
}

/**
 * セル色（FR-ANN-01）: 「なし」とプリセットの色をサブメニューに並べ、選んだ色を選択範囲に当てる。
 * 押した位置にパレットを開くより 1 手少なく、矢印キーでも選べる（ツールバーのボタンはパレットを開く）
 */
function cellColorMenu(store: AppStore): MenuEntry {
  const colors = store.project?.common.colors.items ?? [];
  return {
    kind: 'submenu',
    labelKey: 'ui.ctx.cellColor',
    testId: 'cell.color',
    items: [
      { kind: 'command', command: 'cell.color', args: null, labelKey: 'ui.cellColor.none', swatch: null, testId: 'cell.color-none' },
      ...colors.map((c): MenuEntry => ({ kind: 'command', command: 'cell.color', args: c.key, label: c.label ?? c.key, swatch: c.color, testId: `cell.color-${c.key}` })),
    ],
  };
}

function cellMenu(store: AppStore): MenuEntry[] {
  const items: MenuEntry[] = [
    command('edit.cut'),
    command('edit.copy'),
    command('edit.paste'),
    command('edit.pasteValues'),
    SEP,
    command('row.insertAbove'),
    command('row.insertBelow'),
    command('row.delete'),
    SEP,
    cellColorMenu(store),
    command('cell.comment'),
  ];
  if (anchorComment(store) !== undefined) items.push(command('cell.comment', { args: { remove: true }, labelKey: 'ui.note.delete' }));
  items.push(command('edit.clear'), SEP);
  // 参照先へ移動（FR-REF-01）。リストで参照先が複数あれば、参照先ごとに出す
  const ref = refCellOf(store);
  if (ref === null || ref.keys.length === 1) {
    items.push(command('cell.gotoRef'));
  } else {
    const goto = store.t('ui.ref.goto');
    ref.keys.slice(0, MAX_REF_ITEMS).forEach((_, index) => {
      items.push(command('cell.gotoRef', { args: { index }, label: `${goto}: ${refKeyLabel(store, ref, index)}` }));
    });
  }
  return items;
}

function rowHeaderMenu(): MenuEntry[] {
  return [command('row.insertAbove'), command('row.insertBelow'), command('row.duplicate'), command('row.delete')];
}

function columnHeaderMenu(store: AppStore, request: ContextMenuRequest): MenuEntry[] {
  const args = { table: request.table, column: request.column };
  const items: MenuEntry[] = [
    external(store, 'column.settings', 'ui.ctx.columnSettings', args),
    SEP,
    external(store, 'column.insertLeft', 'ui.ctx.insertColumnLeft', args),
    external(store, 'column.insertRight', 'ui.ctx.insertColumnRight', args),
    external(store, 'column.delete', 'ui.ctx.deleteColumn', args),
    SEP,
    command('column.freeze', { args }),
    command('column.unfreeze'),
    command('column.hide', { args }),
  ];
  if ((store.table(request.table)?.view.hidden_columns?.length ?? 0) > 0) items.push(command('column.showHidden'));
  items.push(SEP, command('sort.asc', { args }), command('sort.desc', { args }), command('filter.open', { args }));
  return items;
}

export const contextMenuExtension: GridExtension = {
  id: 'contextMenus',
  contextMenu(request, store) {
    if (store.table(request.table) === undefined) return null;
    switch (request.area) {
      case 'cell':
        return cellMenu(store);
      case 'rowHeader':
        return rowHeaderMenu();
      case 'columnHeader':
        return request.column === undefined ? null : columnHeaderMenu(store, request);
      default:
        return null;
    }
  },
};
