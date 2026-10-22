// グリッド（FR-UI-04、FR-SEL-01〜05、FR-COL-06〜08）。描画は自前の DOM、仮想スクロールだけ @tanstack/virtual-core（C-1）。
// DOM の構成（スクロールする容器の中）:
//   キャンバス（中身全体の大きさ）
//     列ヘッダーの行（sticky top）: スクロールする列の見出し ＋ 左上の角と固定列の見出し（sticky left）
//     本体: スクロールする列のセル・選択範囲・入力欄 ＋ 左のペイン（sticky left）: 行番号・固定列のセル・選択範囲
import type { CellPos, Selection } from '@masterdata-maker/core';
import {
  autoScrollVelocity,
  extendTo,
  isSingleCell,
  rangeContains,
  resolveShortcut,
  selectAll,
  selectCell,
  selectColRange,
  selectRowRange,
  setColumnWidth,
  setColumnsHidden,
} from '@masterdata-maker/core';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toggleCheckboxes } from '../commands/edit';
import type { SheetModel } from '../sheet/model';
import type { AppStore } from '../store/AppStore';
import { useAppState, useStore, useT } from '../store/hooks';
import type { ClipboardMark } from '../store/types';
import { CellInput } from './CellInput';
import { pasteText } from './clipboard';
import type { ContextMenuRequest, GridExtension } from './extensions';
import { dispatchContextMenu } from './extensions';
import { GRID_EXTENSIONS } from './extensions/index';
import type { RenderCtx } from './GridCells';
import { ColumnHeader, GridRow } from './GridCells';
import type { GridHit, Rect, ScrollPos, ViewportSize } from './layout';
import { GridGeometry, MIN_COLUMN_WIDTH, ROW_HEIGHT } from './layout';
import { useVirtual } from './useVirtual';

type Drag =
  | { kind: 'cells' }
  | { kind: 'rows'; anchorRow: number }
  | { kind: 'cols'; anchorCol: number }
  | { kind: 'resize'; col: number; startX: number; startWidth: number };

const rowSize = (): number => ROW_HEIGHT;
const rowKey = (i: number): number => i;

const DECORATORS = GRID_EXTENSIONS.flatMap((e) => (e.decorateCell === undefined ? [] : [e.decorateCell.bind(e)]));
const HEADER_DECORATORS = GRID_EXTENSIONS.flatMap((e) => (e.decorateColumnHeader === undefined ? [] : [e.decorateColumnHeader.bind(e)]));
const OVERLAYS = GRID_EXTENSIONS.filter((e): e is GridExtension & Required<Pick<GridExtension, 'overlay'>> => e.overlay !== undefined);
const POINTER_HOOKS = GRID_EXTENSIONS.filter((e) => e.pointerDown !== undefined);

function rectStyle(r: Rect) {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

export function Grid({ tableUid }: { tableUid: number }) {
  const store = useStore();
  // 表の形は編集・並べ替えで変わる
  useAppState((s) => s.revision);
  useAppState((s) => s.views.get(tableUid)?.order);
  const sheet = store.sheet(tableUid);
  if (sheet === null) return null;
  return <GridView key={tableUid} store={store} sheet={sheet} />;
}

function GridView({ store, sheet }: { store: AppStore; sheet: SheetModel }) {
  const t = useT();
  const uid = sheet.table.uid;
  const revision = useAppState((s) => s.revision);
  const validationVersion = useAppState((s) => s.validation.version);
  const issues = useAppState((s) => s.validation.tables.get(sheet.table.name));
  const selection = useAppState((s) => s.views.get(uid)?.selection ?? null) ?? store.view(uid).selection;
  const editing = useAppState((s) => s.editing !== null);
  const clipboardMark = useAppState((s) => (s.clipboardMark?.table === uid ? s.clipboardMark : null));
  const reveal = useAppState((s) => (s.reveal?.table === uid ? s.reveal : null));
  const calc = store.calc;
  const project = store.project;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [initialScroll] = useState(() => store.scrollPosition(uid));
  const [resizeGuide, setResizeGuide] = useState<{ col: number; width: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const pointer = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
  const raf = useRef<{ id: number; last: number } | null>(null);

  // ---- 配置 ----
  const widthsKey = sheet.columns.map((c) => c.width).join(',');
  const geometry = useMemo(
    () => new GridGeometry({ widths: sheet.columns.map((c) => c.width), frozenCount: sheet.frozenCount, rowCount: sheet.size.rows }),
    // 列幅・固定列の数・行数が変わったときだけ作り直す
    [widthsKey, sheet.frozenCount, sheet.size.rows],
  );
  const colSize = useCallback((i: number) => geometry.cols.size(i), [geometry]);
  const colKey = useCallback((i: number) => `${i}:${geometry.cols.size(i)}`, [geometry]);
  const rowV = useVirtual({
    scrollerRef,
    horizontal: false,
    count: sheet.size.rows,
    estimateSize: rowSize,
    getItemKey: rowKey,
    paddingStart: geometry.headerHeight,
    overscan: 4,
    initialOffset: initialScroll.top,
  });
  const colV = useVirtual({
    scrollerRef,
    horizontal: true,
    count: geometry.colCount,
    estimateSize: colSize,
    getItemKey: colKey,
    paddingStart: geometry.rowHeaderWidth,
    overscan: 2,
    initialOffset: initialScroll.left,
  });

  const el = scrollerRef.current;
  const scroll: ScrollPos = { left: el?.scrollLeft ?? initialScroll.left, top: el?.scrollTop ?? initialScroll.top };
  const viewport: ViewportSize = { width: el?.clientWidth ?? 1200, height: el?.clientHeight ?? 800 };

  const colorItems = project?.common.colors.items;
  const colors = useMemo(() => new Map((colorItems ?? []).map((c) => [c.key, c.color])), [colorItems]);
  const ctx: RenderCtx | null = useMemo(() => {
    if (calc === null) return null;
    // 編集・検査の結果が変わったら作り直す（行の memo を外して描き直す）
    const version = `${revision}:${validationVersion}`;
    return { store, table: sheet.table, sheet, calc, geometry, timeZone: calc.timeZone, issues, colors, decorators: DECORATORS, headerDecorators: HEADER_DECORATORS, t, version };
  }, [store, sheet, calc, geometry, issues, colors, t, revision, validationVersion]);

  // ---- フォーカス・スクロールの位置 ----
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    scroller.scrollTop = initialScroll.top;
    scroller.scrollLeft = initialScroll.left;
  }, [initialScroll]);

  useEffect(() => {
    const focus = () => inputRef.current?.focus({ preventScroll: true });
    store.registerFocusHandler(focus);
    if (store.getState().dialogs.length === 0) focus();
    return () => store.registerFocusHandler(null);
  }, [store]);

  // キー操作で選択を動かしたら、動く端が見えるようにスクロールする
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (reveal === null || scroller === null) return;
    const next = geometry.revealScroll(reveal.pos, { left: scroller.scrollLeft, top: scroller.scrollTop }, { width: scroller.clientWidth, height: scroller.clientHeight });
    if (next.top !== scroller.scrollTop) scroller.scrollTop = next.top;
    if (next.left !== scroller.scrollLeft) scroller.scrollLeft = next.left;
  }, [reveal, geometry]);

  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current.id);
  }, []);

  // 行が無くなる・できると入力欄が入れ替わるので、フォーカスを失っていたら戻す
  const hasCells = sheet.size.rows > 0 && sheet.size.cols > 0;
  useEffect(() => {
    const active = document.activeElement;
    if ((active === null || active === document.body) && store.getState().dialogs.length === 0) inputRef.current?.focus({ preventScroll: true });
  }, [hasCells, store]);

  if (ctx === null) return null;

  // ---- マウス ----
  const viewportPoint = (e: { clientX: number; clientY: number }) => {
    const rect = scrollerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };
  const currentScroll = (): ScrollPos => ({ left: scrollerRef.current?.scrollLeft ?? 0, top: scrollerRef.current?.scrollTop ?? 0 });
  const currentViewport = (): ViewportSize => ({ width: scrollerRef.current?.clientWidth ?? 0, height: scrollerRef.current?.clientHeight ?? 0 });
  const sel = (): Selection => store.view(uid).selection;
  const size = sheet.size;

  const updateDrag = (x: number, y: number) => {
    const d = drag.current;
    if (d === null) return;
    const s = currentScroll();
    const vp = currentViewport();
    if (d.kind === 'resize') {
      const width = Math.max(MIN_COLUMN_WIDTH, Math.round(d.startWidth + (x - d.startX)));
      setResizeGuide({ col: d.col, width });
      return;
    }
    if (size.rows === 0 || size.cols === 0) return;
    const pos = geometry.clampedCellAt(x, y, s, vp);
    if (d.kind === 'cells') store.setSelection(extendTo(sel(), pos, size));
    else if (d.kind === 'rows') store.setSelection(selectRowRange(d.anchorRow, pos.row, size));
    else store.setSelection(selectColRange(d.anchorCol, pos.col, size));
  };

  // ドラッグで表示領域の外に出たら、自動でスクロールし続ける（FR-SEL-04）
  const tick = (now: number) => {
    const scroller = scrollerRef.current;
    const p = pointer.current;
    const d = drag.current;
    if (scroller === null || p === null || d === null || d.kind === 'resize') {
      raf.current = null;
      return;
    }
    const rect = scroller.getBoundingClientRect();
    const v = autoScrollVelocity(
      { x: p.clientX, y: p.clientY },
      {
        left: rect.left + geometry.rowHeaderWidth + (d.kind === 'cols' ? 0 : geometry.frozenWidth),
        top: rect.top + geometry.headerHeight,
        right: rect.left + scroller.clientWidth,
        bottom: rect.top + scroller.clientHeight,
      },
    );
    const vx = d.kind === 'rows' ? 0 : v.x;
    const vy = d.kind === 'cols' ? 0 : v.y;
    if (vx === 0 && vy === 0) {
      raf.current = null;
      return;
    }
    const last = raf.current?.last ?? now;
    const dt = Math.min(100, now - last) / 1000;
    scroller.scrollLeft += vx * dt;
    scroller.scrollTop += vy * dt;
    updateDrag(p.x, p.y);
    raf.current = { id: requestAnimationFrame(tick), last: now };
  };

  const startAutoScroll = () => {
    if (raf.current === null) raf.current = { id: requestAnimationFrame(tick), last: performance.now() };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.sc-input-wrap.editing') !== null) return;
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const { x, y } = viewportPoint(e);
    // スクロールバーの上は、ブラウザに任せる
    if (x >= scroller.clientWidth || y >= scroller.clientHeight) return;
    // 編集中なら、先に確定する（確定できなければ選択を変えない）
    if (store.getState().editing !== null && !store.commitEdit(null)) {
      e.preventDefault();
      return;
    }
    store.closeContextMenu();
    inputRef.current?.focus({ preventScroll: true });
    const s = currentScroll();
    const hit = geometry.hitTest(x, y, s);
    for (const ext of POINTER_HOOKS) {
      if (ext.pointerDown?.({ store, sheet, geometry, hit, x, y, scroll: s, event: e.nativeEvent, scroller }) === true) return;
    }
    const unhide = target.closest<HTMLElement>('[data-unhide]')?.dataset.unhide;
    if (unhide !== undefined && project !== null) {
      store.applyOrReport(setColumnsHidden(project, { table: uid, columns: unhide.split(','), hidden: false }));
      return;
    }
    if (size.cols === 0) return;
    const current = sel();
    let next: Drag | null = null;
    switch (hit.area) {
      case 'corner':
        store.setSelection(selectAll(current, size));
        break;
      case 'resize':
        next = { kind: 'resize', col: hit.col, startX: x, startWidth: geometry.cols.size(hit.col) };
        setResizeGuide({ col: hit.col, width: geometry.cols.size(hit.col) });
        break;
      case 'colHeader':
        if (e.shiftKey && current.kind === 'cols') {
          store.setSelection(extendTo(current, { row: Math.max(0, size.rows - 1), col: hit.col }, size));
          next = { kind: 'cols', anchorCol: current.anchor.col };
        } else {
          store.setSelection(selectColRange(hit.col, hit.col, size));
          next = { kind: 'cols', anchorCol: hit.col };
        }
        break;
      case 'rowHeader':
        if (e.shiftKey && current.kind === 'rows') {
          store.setSelection(extendTo(current, { row: hit.row, col: Math.max(0, size.cols - 1) }, size));
          next = { kind: 'rows', anchorRow: current.anchor.row };
        } else {
          store.setSelection(selectRowRange(hit.row, hit.row, size));
          next = { kind: 'rows', anchorRow: hit.row };
        }
        break;
      case 'cell': {
        const pos: CellPos = { row: hit.row, col: hit.col };
        if (e.shiftKey) store.setSelection(extendTo(current, pos, size));
        else store.setSelection(selectCell(pos, size));
        if (!e.shiftKey && target.closest('[data-checkbox]') !== null) {
          toggleCheckboxes(store);
          return;
        }
        if (!e.shiftKey && target.closest('[data-dropdown]') !== null) {
          store.beginEdit({ mode: 'edit' });
          return;
        }
        next = { kind: 'cells' };
        break;
      }
      case 'none':
        break;
    }
    if (next !== null) {
      drag.current = next;
      pointer.current = { x, y, clientX: e.clientX, clientY: e.clientY };
      scroller.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return;
    const { x, y } = viewportPoint(e);
    pointer.current = { x, y, clientX: e.clientX, clientY: e.clientY };
    updateDrag(x, y);
    startAutoScroll();
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>, apply: boolean) => {
    const d = drag.current;
    drag.current = null;
    pointer.current = null;
    if (raf.current !== null) {
      cancelAnimationFrame(raf.current.id);
      raf.current = null;
    }
    if (scrollerRef.current?.hasPointerCapture(e.pointerId) === true) scrollerRef.current.releasePointerCapture(e.pointerId);
    if (d?.kind !== 'resize') return;
    setResizeGuide(null);
    const { x } = viewportPoint(e);
    const width = Math.max(MIN_COLUMN_WIDTH, Math.round(d.startWidth + (x - d.startX)));
    if (!apply || project === null || width === d.startWidth) return;
    // 列全体を選んでいて、その中の列の境界を動かしたら、選んだ列をすべて同じ幅にする（Googleスプレッドシートと同じ）
    const current = sel();
    const range = current.ranges[0];
    const columns =
      (current.kind === 'cols' || current.kind === 'all') && d.col >= range.left && d.col <= range.right
        ? sheet.columns.slice(range.left, range.right + 1).map((c) => c.name)
        : [sheet.columns[d.col].name];
    store.applyOrReport(setColumnWidth(project, { table: uid, columns, width }));
  };

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    // フォーカスを入力欄から動かさない・文字を選択しない
    if ((e.target as HTMLElement).closest('.sc-input-wrap.editing') === null) e.preventDefault();
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const { x, y } = viewportPoint(e);
    const hit = geometry.hitTest(x, y, currentScroll());
    // フィルハンドルと範囲の枠のダブルクリックは、拡張（grid/extensions/fillHandle.tsx）が受け持つ
    if (hit.area === 'cell' && !(e.target as HTMLElement).closest('[data-checkbox], [data-fill-handle], [data-range-border]')) store.beginEdit({ mode: 'edit' });
  };

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.sc-input-wrap.editing') !== null) return;
    const { x, y } = viewportPoint(e);
    const hit: GridHit = geometry.hitTest(x, y, currentScroll());
    const current = sel();
    const base = { table: uid, clientX: e.clientX, clientY: e.clientY };
    let request: ContextMenuRequest | null = null;
    if (hit.area === 'cell') {
      // 選択範囲の外を右クリックしたら、そのセルを選ぶ（Googleスプレッドシートと同じ）
      if (!rangeContains(current.ranges[0], hit)) store.setSelection(selectCell(hit, size));
      request = { ...base, area: 'cell', row: hit.row, col: hit.col, record: sheet.rowUids[hit.row], column: sheet.columns[hit.col]?.name };
    } else if (hit.area === 'rowHeader') {
      if (!(current.kind === 'rows' || current.kind === 'all') || hit.row < current.ranges[0].top || hit.row > current.ranges[0].bottom) {
        store.setSelection(selectRowRange(hit.row, hit.row, size));
      }
      request = { ...base, area: 'rowHeader', row: hit.row, record: sheet.rowUids[hit.row] };
    } else if (hit.area === 'colHeader' || hit.area === 'resize') {
      const col = hit.col;
      if (!(current.kind === 'cols' || current.kind === 'all') || col < current.ranges[0].left || col > current.ranges[0].right) {
        store.setSelection(selectColRange(col, col, size));
      }
      request = { ...base, area: 'columnHeader', col, column: sheet.columns[col]?.name };
    }
    if (request !== null && dispatchContextMenu(store, GRID_EXTENSIONS, request)) e.preventDefault();
  };

  const onScroll = () => {
    const scroller = scrollerRef.current;
    if (scroller !== null) store.saveScrollPosition(uid, scroller.scrollTop, scroller.scrollLeft);
  };

  // ---- 描く範囲 ----
  const frozenCount = geometry.frozenCount;
  const rowItems = rowV.getVirtualItems();
  const colItems = colV.getVirtualItems();
  let c0 = Number.POSITIVE_INFINITY;
  let c1 = -1;
  for (const item of colItems) {
    if (item.index < frozenCount) continue;
    c0 = Math.min(c0, item.index);
    c1 = Math.max(c1, item.index);
  }
  if (c1 < 0) c0 = 0;
  const range = selection.ranges[0];
  const colSelected = selection.kind === 'cols' || selection.kind === 'all';
  const rowSelected = selection.kind === 'rows' || selection.kind === 'all';

  const headers = (from: number, to: number) => {
    const out = [];
    for (let c = from; c <= to; c++) {
      const hl = hasCells && c >= range.left && c <= range.right;
      out.push(<ColumnHeader key={c} ctx={ctx} col={c} highlighted={hl} selected={hl && colSelected} />);
    }
    return out;
  };

  const overlayProps = { store, sheet, geometry, selection, scroll, editing };

  return (
    <div className="sc-grid" data-testid="grid" data-table={sheet.table.name}>
      <div
        ref={scrollerRef}
        className="sc-grid-scroller"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, true)}
        onPointerCancel={(e) => endDrag(e, false)}
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onScroll={onScroll}
      >
        <div className="sc-grid-canvas" style={{ width: geometry.contentWidth, height: geometry.contentHeight }}>
          <div className="sc-head" style={{ height: geometry.headerHeight, width: geometry.contentWidth }}>
            {headers(c0, c1)}
            <div className="sc-head-frozen" style={{ width: geometry.rowHeaderWidth + geometry.frozenWidth, height: geometry.headerHeight }}>
              <div className="sc-corner" style={{ width: geometry.rowHeaderWidth, height: geometry.headerHeight }} title={t('ui.grid.selectAll')} />
              {headers(0, frozenCount - 1)}
            </div>
          </div>
          <div className="sc-body" style={{ height: geometry.bodyHeight, width: geometry.contentWidth }}>
            <div className="sc-pane-frozen" style={{ width: geometry.rowHeaderWidth + geometry.frozenWidth, height: geometry.bodyHeight }}>
              {frozenCount > 0 &&
                rowItems.map((item) => (
                  <GridRow key={sheet.rowUids[item.index]} ctx={ctx} row={item.index} uid={sheet.rowUids[item.index]} c0={0} c1={frozenCount - 1} />
                ))}
              {rowItems.map((item) => {
                const hl = hasCells && item.index >= range.top && item.index <= range.bottom;
                return (
                  <div
                    key={item.index}
                    className={`sc-rowhead${hl ? ' hl' : ''}${hl && rowSelected ? ' selected' : ''}`}
                    style={{ top: geometry.rowY(item.index), height: geometry.rowHeight, width: geometry.rowHeaderWidth }}
                  >
                    {item.index + 1}
                  </div>
                );
              })}
              {hasCells && <SelectionLayer pane="frozen" geometry={geometry} selection={selection} mark={clipboardMark} />}
              {OVERLAYS.map((ext) => (
                <ext.overlay key={ext.id} {...overlayProps} pane="frozen" />
              ))}
            </div>
            {rowItems.map((item) => (
              <GridRow key={sheet.rowUids[item.index]} ctx={ctx} row={item.index} uid={sheet.rowUids[item.index]} c0={c0} c1={c1} />
            ))}
            {hasCells && <SelectionLayer pane="body" geometry={geometry} selection={selection} mark={clipboardMark} />}
            {OVERLAYS.map((ext) => (
              <ext.overlay key={ext.id} {...overlayProps} pane="body" />
            ))}
            {hasCells && <CellInput store={store} sheet={sheet} geometry={geometry} scroll={scroll} viewport={viewport} inputRef={inputRef} />}
          </div>
          {resizeGuide !== null && (
            <div
              className="sc-resize-guide"
              style={{ left: geometry.colCanvasX(resizeGuide.col, scroll.left) + resizeGuide.width - 1, top: scroll.top, height: viewport.height }}
            />
          )}
        </div>
        {!hasCells && <EmptySheetInput inputRef={inputRef} />}
      </div>
      {size.rows === 0 && <div className="sc-grid-empty">{t('ui.grid.noRows')}</div>}
    </div>
  );
}

/** 行や列が無いテーブルでも、キー操作（Ctrl+S・シートの切り替えなど）と貼り付け（末尾に行を足す）を受け付ける入力欄 */
function EmptySheetInput({ inputRef }: { inputRef: RefObject<HTMLTextAreaElement | null> }) {
  const store = useStore();
  return (
    <textarea
      ref={inputRef}
      className="sc-input idle"
      style={{ position: 'absolute', left: 0, top: 0 }}
      aria-label={store.t('ui.grid.input')}
      data-region-focus=""
      data-testid="cell-input"
      onKeyDown={(e) => {
        const id = resolveShortcut(e.nativeEvent, store.platform, 'grid');
        const def = id === null ? undefined : store.commands.byShortcut(id);
        if (def?.native !== undefined) {
          def.native.before?.(store);
          return;
        }
        if (def !== undefined) {
          e.preventDefault();
          void store.run(def.id);
        } else if (e.key.length === 1) e.preventDefault();
      }}
      onPaste={(e) => {
        e.preventDefault();
        const valuesOnly = store.pasteValuesPending;
        store.pasteValuesPending = false;
        pasteText(store, e.clipboardData.getData('text/plain'), valuesOnly);
      }}
    />
  );
}

interface SelectionLayerProps {
  pane: 'frozen' | 'body';
  geometry: GridGeometry;
  selection: Selection;
  mark: ClipboardMark | null;
}

/** 選択範囲（青い枠と半透明の塗り。FR-ANN-03）・現在のセル・コピーした範囲の点線の枠 */
function SelectionLayer({ pane, geometry, selection, mark }: SelectionLayerProps) {
  const range = selection.ranges[0];
  const rects = geometry.rangeRects(range);
  const rect = pane === 'frozen' ? rects.frozen : rects.body;
  // 固定列とスクロールする列にまたがるときは、境目の線を描かない
  const continues = pane === 'frozen' ? rects.body !== null : rects.frozen !== null;
  const anchorRects = geometry.rangeRects({ top: selection.anchor.row, left: selection.anchor.col, bottom: selection.anchor.row, right: selection.anchor.col });
  const anchorRect = pane === 'frozen' ? anchorRects.frozen : anchorRects.body;
  const markRects = mark === null ? null : geometry.rangeRects(mark.range);
  const markRect = markRects === null ? null : pane === 'frozen' ? markRects.frozen : markRects.body;
  return (
    <>
      {rect !== null && !isSingleCell(range) && (
        <div className={`sc-sel-range${continues ? (pane === 'frozen' ? ' open-right' : ' open-left') : ''}`} style={rectStyle(rect)} />
      )}
      {anchorRect !== null && <div className="sc-sel-active" style={rectStyle(anchorRect)} data-testid="active-cell" />}
      {markRect !== null && <div className={`sc-clip-mark${mark?.cut ? ' cut' : ''}`} style={rectStyle(markRect)} />}
    </>
  );
}
