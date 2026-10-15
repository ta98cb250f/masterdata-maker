// 問題パネル（FR-UI-06。下側）: 全テーブルのエラー・警告の一覧（重大度・テーブル・主キー・列・メッセージ。FR-VAL-08）。
// 行を押すと（または Enter）、そのテーブルに切り替えてセルを選ぶ。重大度で絞り込める。
// パネルを開くと一覧にフォーカスが入り（NFR-40）、↑↓・Home / End・PageUp / PageDown で行を選んで Enter で移る。Esc でグリッドへ戻る
import type { Diagnostic, Locale } from '@sheetcraft/core';
import { formatDiagnostic, selectCell, selectColRange, selectRowRange } from '@sheetcraft/core';
import type { KeyboardEvent } from 'react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ErrorCircleIcon, WarningIcon } from '../components/featureIcons';
import type { AppStore } from '../store/AppStore';
import { useAppState, useT } from '../store/hooks';
import type { ValidationState } from '../store/types';
import '../styles/problemsPanel.css';
import type { PanelDef, PanelProps } from './registry';

export interface ProblemRow {
  diagnostic: Diagnostic;
  /** テーブル名（共通設定・プロジェクト設定の診断は undefined） */
  table: string | undefined;
  /** 表に出す場所（テーブル名、無ければファイル名） */
  where: string;
  key: string;
  column: string;
  message: string;
}

/** 診断の一覧（共通設定、テーブルはシートタブの順） */
export function problemRows(validation: ValidationState, tableOrder: readonly string[], locale: Locale): ProblemRow[] {
  const rows: ProblemRow[] = [];
  const push = (d: Diagnostic) =>
    rows.push({
      diagnostic: d,
      table: d.table,
      where: d.table ?? d.file ?? '',
      key: d.recordKey ?? '',
      column: d.field ?? '',
      message: formatDiagnostic(d, locale),
    });
  for (const d of validation.common) push(d);
  const seen = new Set<string>();
  for (const name of [...tableOrder, ...validation.tables.keys()]) {
    if (seen.has(name)) continue;
    seen.add(name);
    for (const d of validation.tables.get(name)?.diagnostics ?? []) push(d);
  }
  return rows;
}

/** 診断の場所へ移る。移れなければ理由を知らせる */
export function revealDiagnostic(store: AppStore, d: Diagnostic): void {
  if (d.table === undefined) return;
  if (store.getState().editing !== null && !store.commitEdit(null)) return;
  const tab = store.tabs().find((x) => x.name === d.table);
  if (tab === undefined) return;
  store.setActiveTable(tab.uid);
  if (store.getState().activeTable !== tab.uid) return;
  const sheet = store.sheet(tab.uid);
  if (sheet === null || sheet.size.cols === 0) {
    store.focusGrid();
    return;
  }
  const col = d.field === undefined ? -1 : sheet.colOf(d.field);
  if (d.recordUid !== undefined) {
    const row = sheet.rowOf(d.recordUid);
    if (row < 0) {
      store.showStatus(store.t('ui.problems.rowHidden'), 'error');
      return;
    }
    if (col < 0) {
      store.setSelection(selectRowRange(row, row, sheet.size), { reveal: true, table: tab.uid });
      if (d.field !== undefined) store.showStatus(store.t('ui.problems.columnHidden', { column: d.field }), 'error');
    } else {
      store.setSelection(selectCell({ row, col }, sheet.size), { reveal: true, table: tab.uid });
    }
  } else if (col >= 0) {
    store.setSelection(selectColRange(col, col, sheet.size), { reveal: true, table: tab.uid });
  }
  store.focusGrid();
}

const ROW_HEIGHT = 24;
const OVERSCAN = 6;

function ProblemsPanel({ store }: PanelProps) {
  const t = useT();
  const validation = useAppState((s) => s.validation);
  const locale = useAppState((s) => s.locale);
  useAppState((s) => s.revision);
  const [showErrors, setShowErrors] = useState(true);
  const [showWarnings, setShowWarnings] = useState(true);
  const [active, setActive] = useState(-1);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(200);
  const listRef = useRef<HTMLDivElement>(null);
  const tableOrder = store.tabs().map((x) => x.name);
  const orderKey = tableOrder.join('\u0000');

  const all = useMemo(() => problemRows(validation, orderKey === '' ? [] : orderKey.split('\u0000'), locale), [validation, orderKey, locale]);
  const errors = all.filter((r) => r.diagnostic.severity === 'error').length;
  const warnings = all.length - errors;
  const rows = useMemo(
    () => all.filter((r) => (r.diagnostic.severity === 'error' ? showErrors : showWarnings)),
    [all, showErrors, showWarnings],
  );

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el === null) return;
    setHeight(el.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 一覧にフォーカスがあるのに行を選んでいなければ（開いた直後で検査の結果がまだ無かったときなど）、先頭の行を選ぶ
  useLayoutEffect(() => {
    if (active < 0 && rows.length > 0 && listRef.current !== null && document.activeElement === listRef.current) setActive(0);
  }, [active, rows.length]);

  const open = (i: number) => {
    const row = rows[i];
    if (row === undefined) return;
    setActive(i);
    revealDiagnostic(store, row.diagnostic);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const page = Math.max(1, Math.floor((listRef.current?.clientHeight ?? ROW_HEIGHT) / ROW_HEIGHT) - 1);
    const go = (i: number) => {
      const next = Math.max(0, Math.min(rows.length - 1, i));
      setActive(next);
      const el = listRef.current;
      if (el === null) return;
      const top = next * ROW_HEIGHT;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight - ROW_HEIGHT) el.scrollTop = top + 2 * ROW_HEIGHT - el.clientHeight;
    };
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      go(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      go(active - 1);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      go(e.key === 'Home' ? 0 : rows.length - 1);
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      go(Math.max(0, active) + (e.key === 'PageDown' ? page : -page));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0) open(active);
    }
  };

  const first = Math.max(0, Math.floor(scroll / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scroll + height) / ROW_HEIGHT) + OVERSCAN);
  const visible = rows.slice(first, last);

  return (
    <div className="sc-problems" data-testid="problems-panel">
      <div className="sc-problems-toolbar">
        <button
          type="button"
          className={`sc-problems-filter error${showErrors ? ' on' : ''}`}
          aria-pressed={showErrors}
          onClick={() => setShowErrors(!showErrors)}
          data-testid="problems-filter-error"
        >
          <ErrorCircleIcon /> {t('ui.problems.errors', { count: errors })}
        </button>
        <button
          type="button"
          className={`sc-problems-filter warning${showWarnings ? ' on' : ''}`}
          aria-pressed={showWarnings}
          onClick={() => setShowWarnings(!showWarnings)}
          data-testid="problems-filter-warning"
        >
          <WarningIcon /> {t('ui.problems.warnings', { count: warnings })}
        </button>
        {validation.running && <span className="sc-problems-running">{t('ui.title.validating')}</span>}
      </div>
      <div className="sc-problems-head" aria-hidden="true">
        <span className="sev" />
        <span className="table">{t('ui.problems.col.table')}</span>
        <span className="key">{t('ui.problems.col.key')}</span>
        <span className="column">{t('ui.problems.col.column')}</span>
        <span className="message">{t('ui.problems.col.message')}</span>
      </div>
      <div
        ref={listRef}
        className="sc-problems-list"
        role="listbox"
        tabIndex={0}
        aria-label={t('ui.problems.title')}
        onKeyDown={onKeyDown}
        // キーで入ってきたら先頭の行を選んでおき、すぐ Enter で移れるようにする
        onFocus={() => {
          if (active < 0 && rows.length > 0) setActive(0);
        }}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
        aria-activedescendant={active >= 0 && active < rows.length ? `problem-${active}` : undefined}
        data-region-focus=""
        data-testid="problems-list"
      >
        {rows.length === 0 && <div className="sc-problems-empty">{t(all.length === 0 ? 'ui.problems.none' : 'ui.problems.filtered')}</div>}
        <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
          {visible.map((row, k) => {
            const i = first + k;
            const sev = row.diagnostic.severity;
            return (
              <div
                key={i}
                id={`problem-${i}`}
                role="option"
                aria-selected={i === active}
                className={`sc-problems-row ${sev}${i === active ? ' active' : ''}`}
                style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                onClick={() => open(i)}
                title={row.message}
                data-testid="problem-row"
              >
                <span className="sev">{sev === 'error' ? <ErrorCircleIcon /> : <WarningIcon />}</span>
                <span className="table">{row.where}</span>
                <span className="key">{row.key}</span>
                <span className="column">{row.column}</span>
                <span className="message">{row.message}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const problemsPanel: PanelDef = {
  id: 'problems',
  titleKey: 'ui.problems.title',
  position: 'bottom',
  component: ProblemsPanel,
  size: 220,
  menu: { group: 50, order: 0 },
};
