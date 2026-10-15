// 列ヘッダーの並べ替えとフィルタの印（FR-SRT-01、03）。Googleスプレッドシートのフィルタと同じく、列ヘッダーに絞り込みのボタンを出す
// （絞り込んでいる列では常に、それ以外はマウスを重ねたとき）。押すとその列のフィルタの小さな画面を開く
import { FilterIcon } from '../../components/gridIcons';
import { openFilter } from '../../commands/sortFilter';
import { useAppState, useT } from '../../store/hooks';
import '../../styles/sortFilter.css';
import type { GridExtension } from '../extensions';

function HeaderMarks({ uid, column }: { uid: number; column: string }) {
  const t = useT();
  const direction = useAppState((s) => s.views.get(uid)?.sort.find((x) => x.column === column)?.direction ?? null);
  const filtered = useAppState((s) => s.views.get(uid)?.filters.some((f) => f.column === column) ?? false);
  return (
    <>
      {direction !== null && (
        <span className="sc-sort-mark" title={t(direction === 'asc' ? 'ui.sort.sortedAsc' : 'ui.sort.sortedDesc')} data-testid={`sort-mark-${column}`}>
          {direction === 'asc' ? '↑' : '↓'}
        </span>
      )}
      <span
        className={`sc-filter-button${filtered ? ' active' : ''}`}
        role="button"
        title={t(filtered ? 'ui.filter.filtered' : 'ui.filter.open')}
        data-filter-button={column}
        data-testid={`filter-button-${column}`}
      >
        <FilterIcon size={12} />
      </span>
    </>
  );
}

export const sortFilterHeaderExtension: GridExtension = {
  id: 'sortFilterHeader',
  decorateColumnHeader(ctx) {
    return { children: <HeaderMarks key="sortFilter" uid={ctx.table.uid} column={ctx.column.name} /> };
  },
  pointerDown(e) {
    const target = e.event.target instanceof Element ? e.event.target : null;
    const button = target?.closest<HTMLElement>('[data-filter-button]');
    const column = button?.dataset.filterButton;
    if (column === undefined) return false;
    e.event.preventDefault();
    openFilter(e.store, { table: e.sheet.table.uid, column });
    return true;
  },
};
