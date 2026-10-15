// 参照列（FR-ANN-05、FR-REF-01）: 参照列のセルに参照先の名前を添え（例: `[1, 3]` →「ファイア, ヒール」）、
// Ctrl+クリック（Mac は ⌘+クリック）で参照先のレコードへ移る
import { gotoReference } from '../../commands/reference';
import { refKeys, refNamesText, refTargetOf } from '../../sheet/references';
import '../../styles/references.css';
import type { GridExtension } from '../extensions';

export const referencesExtension: GridExtension = {
  id: 'references',
  decorateCell(ctx) {
    if (ctx.column.field.ref === undefined) return null;
    const calc = ctx.store.calc;
    if (calc === null) return null;
    const target = refTargetOf(calc, ctx.column.field);
    if (target === null) return null;
    const keys = refKeys(ctx.result);
    if (keys.length === 0) return null;
    const names = refNamesText(calc, target, keys, ctx.store.getState().revision);
    const title = ctx.store.t('ui.ref.hint', { table: target.table.display_name ?? target.table.name });
    if (names === '') return { title };
    return {
      className: 'sc-ref-cell',
      title: `${names}\n${title}`,
      children: (
        <span className="sc-ref-names" data-testid="ref-names">
          {names}
        </span>
      ),
    };
  },
  pointerDown(e) {
    if (e.hit.area !== 'cell' || !(e.event.ctrlKey || e.event.metaKey) || e.event.shiftKey) return false;
    const record = e.sheet.rowUids[e.hit.row];
    const column = e.sheet.columns[e.hit.col];
    if (record === undefined || column === undefined || column.field.ref === undefined) return false;
    e.event.preventDefault();
    gotoReference(e.store, { table: e.sheet.table.uid, record, column: column.name });
    return true;
  },
};
