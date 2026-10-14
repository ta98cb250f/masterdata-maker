// シートタブの右クリックメニュー（FR-CTX-01）: 名前を変更／複製／削除。読み込みエラーのテーブルでは出さない（P-40）
import type { GridExtension } from '../extensions';

export const sheetTabMenuExtension: GridExtension = {
  id: 'sheetTabMenu',
  contextMenu(request, store) {
    if (request.area !== 'sheetTab' || store.table(request.table) === undefined) return null;
    const args = { table: request.table };
    return [
      { kind: 'command', command: 'table.rename', args, labelKey: 'ui.sheetTab.rename' },
      { kind: 'command', command: 'table.duplicate', args, labelKey: 'ui.sheetTab.duplicate' },
      { kind: 'command', command: 'table.delete', args, labelKey: 'ui.sheetTab.delete' },
    ];
  },
};
