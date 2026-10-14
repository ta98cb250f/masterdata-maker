// セル・列ヘッダー・行番号の描画。行ごとに memo にし、選択が変わっただけではセルを描き直さない
import type { Calculator, Table, TableRecord } from '@sheetcraft/core';
import { RichCell, cellValue, isEmptyValue } from '@sheetcraft/core';
import type { CSSProperties, ReactNode } from 'react';
import { memo } from 'react';
import { KeyIcon, LockIcon, NoExportIcon } from '../components/icons';
import type { Translate } from '../i18n';
import { cellDisplay } from '../sheet/display';
import type { SheetModel } from '../sheet/model';
import type { AppStore } from '../store/AppStore';
import type { TableIssues } from '../store/types';
import type { CellDecoration, CellRenderContext, ColumnHeaderRenderContext, GridExtension } from './extensions';
import type { GridGeometry } from './layout';

/** 描画で共有する情報。中身が変わったときだけ作り直す（行の memo の判定に使う） */
export interface RenderCtx {
  store: AppStore;
  table: Table;
  sheet: SheetModel;
  calc: Calculator;
  geometry: GridGeometry;
  timeZone: string;
  issues: TableIssues | undefined;
  /** セル色のプリセット（キー → 色コード） */
  colors: ReadonlyMap<string, string>;
  decorators: readonly NonNullable<GridExtension['decorateCell']>[];
  /** 列ヘッダーの装飾 */
  headerDecorators: readonly NonNullable<GridExtension['decorateColumnHeader']>[];
  t: Translate;
  /** 編集・検査の版（変わったら描き直す） */
  version: string;
}

const ENUM_TYPES = new Set(['enum', 'list<enum>']);

function renderCell(ctx: RenderCtx, row: number, col: number, record: TableRecord): ReactNode {
  const { geometry, sheet } = ctx;
  const column = sheet.columns[col];
  if (column === undefined) return null;
  const field = column.field;
  const cell = record.cells.get(column.name);
  const result = ctx.calc.getCell(ctx.table, record.uid, column.name);
  const display = cellDisplay(result, field, ctx.timeZone);
  const issue = ctx.issues?.cells.get(record.uid)?.get(column.name);
  let className = 'sc-cell';
  if (display.align !== 'left') className += ` align-${display.align}`;
  if (display.error) className += ' sc-error-value';
  if (issue === 'error') className += ' sc-issue-error';
  else if (issue === 'warning') className += ' sc-issue-warning';
  if (result.source === 'formula') className += ' sc-src-formula';
  else if (result.source === 'override') className += ' sc-src-override';
  else if (result.source === 'default') className += ' sc-src-default';
  if (!column.editable) className += ' sc-readonly';
  if (!column.exported) className += ' sc-noexport';
  const style: CSSProperties = { left: geometry.rowHeaderWidth + geometry.cols.start(col), width: column.width };
  let title: string | undefined;
  const rich = cell instanceof RichCell ? cell : undefined;
  const color = rich?.color === undefined ? undefined : ctx.colors.get(rich.color);
  if (color !== undefined) style.background = color;
  // メモの中身は、マウスを重ねたときの吹き出しで出す（grid/extensions/notes.tsx）
  const comment = rich?.comment !== undefined && rich.comment !== '' ? rich.comment : undefined;
  // 値が優先されて使われていないセル単位式も、印は出す（値を消すと式が使われる）
  const hasOverride = rich?.override !== undefined && rich.override !== '' && !isEmptyValue(cellValue(cell));

  let extra: ReactNode[] | null = null;
  if (ctx.decorators.length > 0) {
    const info: CellRenderContext = { store: ctx.store, table: ctx.table, sheet, row, col, record, column, cell, result, display, issue };
    for (const decorate of ctx.decorators) {
      const d: CellDecoration | null = decorate(info);
      if (d === null) continue;
      if (d.className !== undefined) className += ` ${d.className}`;
      if (d.style !== undefined) Object.assign(style, d.style);
      if (d.title !== undefined) title = title === undefined ? d.title : `${title}\n${d.title}`;
      if (d.children !== undefined) (extra ??= []).push(d.children);
    }
  }

  return (
    <div key={col} className={className} style={style} title={title}>
      {display.checkbox !== null ? <span className={`sc-checkbox${display.checkbox ? ' checked' : ''}`} data-checkbox="1" /> : display.text}
      {extra}
      {ENUM_TYPES.has(field.type) && column.editable && <span className="sc-dropdown" data-dropdown="1" />}
      {comment !== undefined && <span className="sc-mark-note" />}
      {(result.source === 'override' || hasOverride) && <span className="sc-mark-override" />}
    </div>
  );
}

export interface RowProps {
  ctx: RenderCtx;
  row: number;
  uid: number;
  /** 描く列の範囲（両端を含む）。c1 < c0 なら描かない */
  c0: number;
  c1: number;
}

function rowEqual(a: RowProps, b: RowProps): boolean {
  return a.ctx === b.ctx && a.row === b.row && a.uid === b.uid && a.c0 === b.c0 && a.c1 === b.c1;
}

/** 1 行分のセル */
export const GridRow = memo(function GridRow({ ctx, row, c0, c1 }: RowProps) {
  const record = ctx.sheet.recordAt(row);
  if (record === undefined || c1 < c0) return null;
  const cells: ReactNode[] = [];
  for (let c = c0; c <= c1; c++) cells.push(renderCell(ctx, row, c, record));
  return (
    <div className="sc-row" style={{ top: ctx.geometry.rowY(row), height: ctx.geometry.rowHeight }} data-row={row}>
      {cells}
    </div>
  );
}, rowEqual);

export interface ColumnHeaderProps {
  ctx: RenderCtx;
  col: number;
  /** 選択範囲の列か */
  highlighted: boolean;
  /** 列全体を選んでいるか */
  selected: boolean;
}

/** 列ヘッダー（FR-UI-04）: 表示名・列名・型・式の有無の印。出力対象外・編集できない列の印（FR-ANN-04） */
export const ColumnHeader = memo(function ColumnHeader({ ctx, col, highlighted, selected }: ColumnHeaderProps) {
  const { geometry, sheet, t } = ctx;
  const column = sheet.columns[col];
  if (column === undefined) return null;
  const field = column.field;
  const left = geometry.rowHeaderWidth + geometry.cols.start(col);
  let className = 'sc-colhead';
  if (highlighted) className += ' hl';
  if (selected) className += ' selected';
  if (!column.exported) className += ' sc-noexport';
  if (!column.editable) className += ' sc-readonly';
  const tips = [field.description, !column.editable ? t('ui.grid.readonly') : undefined, !column.exported ? t('ui.grid.noExport') : undefined, column.formula ? `=${field.formula}` : undefined];
  const isLast = col === sheet.columns.length - 1;
  const style: CSSProperties = { left, width: column.width };
  let title = tips.filter((x) => x !== undefined).join('\n') || undefined;
  let extra: ReactNode[] | null = null;
  if (ctx.headerDecorators.length > 0) {
    const info: ColumnHeaderRenderContext = { store: ctx.store, table: ctx.table, sheet, col, column };
    for (const decorate of ctx.headerDecorators) {
      const d: CellDecoration | null = decorate(info);
      if (d === null) continue;
      if (d.className !== undefined) className += ` ${d.className}`;
      if (d.style !== undefined) Object.assign(style, d.style);
      if (d.title !== undefined) title = title === undefined ? d.title : `${title}\n${d.title}`;
      if (d.children !== undefined) (extra ??= []).push(d.children);
    }
  }
  return (
    <div className={className} style={style} title={title} data-col={col}>
      <div className="sc-colhead-title">{field.display_name ?? field.name}</div>
      <div className="sc-colhead-sub">
        {column.primary && (
          <span className="sc-colhead-icon" aria-label={t('ui.grid.primary')}>
            <KeyIcon />
          </span>
        )}
        {!column.editable && (
          <span className="sc-colhead-icon" aria-label={t('ui.grid.readonly')}>
            <LockIcon />
          </span>
        )}
        {!column.exported && (
          <span className="sc-colhead-icon" aria-label={t('ui.grid.noExport')}>
            <NoExportIcon />
          </span>
        )}
        <span className="sc-colhead-name">{field.name}</span>
        <span className="sc-colhead-type">{field.type}</span>
        {column.formula && <span className="sc-fx">fx</span>}
      </div>
      {column.hiddenBefore.length > 0 && (
        <span className="sc-hidden-mark left" data-unhide={column.hiddenBefore.join(',')} title={t('ui.grid.showHidden', { columns: column.hiddenBefore.join(', ') })} />
      )}
      {isLast && sheet.hiddenAfter.length > 0 && (
        <span className="sc-hidden-mark right" data-unhide={sheet.hiddenAfter.join(',')} title={t('ui.grid.showHidden', { columns: sheet.hiddenAfter.join(', ') })} />
      )}
      {extra}
    </div>
  );
});
