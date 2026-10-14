// 検索と置換のダイアログ（FR-FND-01〜04。Ctrl+H）。Googleスプレッドシートと同じく、検索・置換後の文字列・検索範囲
// （すべてのテーブル／このテーブル／選択範囲）・大文字と小文字の区別・セル全体の一致・正規表現（RE2）・数式内も検索を選ぶ。
// 置換は型の変換規則と編集可否に従い（core の replaceCells）、置換できなかったセルを一覧で示す
import type { CellRange, EditFailure, TextMatcher } from '@sheetcraft/core';
import { createMatcher, formatInputError, formatMessage, replaceCells, selectCell } from '@sheetcraft/core';
import { useState } from 'react';
import { DialogFrame } from '../components/Dialog';
import type { FindHit, FindScope } from '../sheet/findHits';
import { computedHitFailures, findInSheet, nextHitIndex } from '../sheet/findHits';
import type { AppStore } from '../store/AppStore';
import { useT } from '../store/hooks';
import { Check, Field, submitOnEnter } from './formParts';
import type { DialogProps } from './registry';
import { defineDialog } from './registry';

export interface FindReplaceArgs {
  query?: string;
}

interface FindRequest {
  query: string;
  matchCase: boolean;
  entireCell: boolean;
  regex: boolean;
  searchFormulas: boolean;
  scope: FindScope;
}

interface SelectionScope {
  table: number;
  range: CellRange;
}

type Computed = { ok: true; hits: FindHit[]; matcher: TextMatcher; order: (uid: number) => number } | { ok: false; message: string };

/** 検索範囲の一致するセル。テーブルはシートタブの順（P-06） */
export function computeHits(store: AppStore, req: FindRequest, selection: SelectionScope | null): Computed {
  const calc = store.calc;
  const locale = store.getState().locale;
  if (calc === null) return { ok: false, message: '' };
  const m = createMatcher({ query: req.query, matchCase: req.matchCase, entireCell: req.entireCell, regex: req.regex, searchFormulas: req.searchFormulas });
  if (!m.ok) return { ok: false, message: formatMessage(m.error.code, m.error.params, locale) };
  const tabs = store.tabs().filter((tab) => !tab.broken);
  const index = new Map(tabs.map((tab, i) => [tab.uid, i]));
  let targets: { uid: number; range?: CellRange }[];
  if (req.scope === 'all') targets = tabs.map((tab) => ({ uid: tab.uid }));
  else if (req.scope === 'table') targets = store.getState().activeTable === null ? [] : [{ uid: store.getState().activeTable as number }];
  else targets = selection === null ? [] : [{ uid: selection.table, range: selection.range }];
  const hits: FindHit[] = [];
  for (const target of targets) {
    const sheet = store.sheet(target.uid);
    if (sheet !== null) hits.push(...findInSheet(calc, sheet, m.matcher, req.searchFormulas, target.range));
  }
  return { ok: true, hits, matcher: m.matcher, order: (uid) => index.get(uid) ?? -1 };
}

/** 置換できなかったセルの文言（テーブル / 列 / 主キー: 理由） */
export function replaceFailureText(store: AppStore, f: EditFailure): string {
  const locale = store.getState().locale;
  const message = formatInputError(f, locale);
  const table = f.table === undefined ? undefined : store.table(f.table);
  if (table === undefined) return message;
  const record = f.record === undefined ? undefined : table.records.find((r) => r.uid === f.record);
  const key = record === undefined ? undefined : store.calc?.recordKey(table, record);
  return store.t('ui.find.failureAt', { table: table.name, column: f.column ?? '', key: key ?? store.t('ui.formulaBar.noKey'), message });
}

function currentPos(store: AppStore): { table: number; row: number; col: number } | null {
  const active = store.getState().activeTable;
  const anchor = store.selection()?.anchor;
  return active === null || anchor === undefined ? null : { table: active, ...anchor };
}

function goTo(store: AppStore, hit: FindHit): void {
  if (store.getState().activeTable !== hit.table) store.setActiveTable(hit.table);
  const sheet = store.sheet(hit.table);
  if (sheet !== null) store.setSelection(selectCell({ row: hit.row, col: hit.col }, sheet.size), { reveal: true, table: hit.table });
}

function FindReplaceDialog({ store, args, close }: DialogProps<FindReplaceArgs>) {
  const t = useT();
  const [req, setReq] = useState<FindRequest>({
    query: args?.query ?? '',
    matchCase: false,
    entireCell: false,
    regex: false,
    searchFormulas: false,
    scope: 'all',
  });
  const [replacement, setReplacement] = useState('');
  const [message, setMessage] = useState('');
  const [failures, setFailures] = useState<string[]>([]);
  // 選択範囲は開いたときのものを使う（探すと選択が動くため）
  const [selection] = useState<SelectionScope | null>(() => {
    const active = store.getState().activeTable;
    const sel = store.selection();
    return active === null || sel === null ? null : { table: active, range: sel.ranges[0] };
  });
  const selectionLabel = (() => {
    if (selection === null) return t('ui.find.scope.selection');
    const r = selection.range;
    return t('ui.find.scope.selectionOf', { table: store.entry(selection.table)?.name ?? '', rows: r.bottom - r.top + 1, cols: r.right - r.left + 1 });
  })();

  const update = (patch: Partial<FindRequest>) => {
    setReq((r) => ({ ...r, ...patch }));
    setMessage('');
  };

  const findNext = (): void => {
    setFailures([]);
    const c = computeHits(store, req, selection);
    if (!c.ok) {
      setMessage(c.message);
      return;
    }
    if (c.hits.length === 0) {
      setMessage(t('ui.find.noResults'));
      return;
    }
    const i = nextHitIndex(c.hits, c.order, currentPos(store), 1);
    goTo(store, c.hits[i]);
    setMessage(t('ui.find.position', { index: i + 1, total: c.hits.length }));
  };

  const report = (replaced: number, failed: EditFailure[]): void => {
    setFailures(failed.map((f) => replaceFailureText(store, f)));
    setMessage(
      failed.length === 0 ? t('ui.find.replaced', { count: replaced }) : t('ui.find.replacedWithFailures', { count: replaced, failed: failed.length }),
    );
  };

  const replaceIn = (hits: FindHit[], c: Extract<Computed, { ok: true }>): { replaced: number; failed: EditFailure[] } => {
    const project = store.project;
    if (project === null) return { replaced: 0, failed: [] };
    const cells = hits.filter((h) => h.kind !== 'computed').map((h) => ({ table: h.table, record: h.record, column: h.column }));
    const r = replaceCells(project, { cells, matcher: c.matcher, replacement, searchFormulas: req.searchFormulas });
    if (r.tx !== null) store.apply({ ok: true, tx: r.tx });
    return { replaced: r.replaced, failed: [...computedHitFailures(hits), ...r.failures] };
  };

  const replaceOne = (): void => {
    const c = computeHits(store, req, selection);
    if (!c.ok) {
      setMessage(c.message);
      return;
    }
    const pos = currentPos(store);
    const here = pos === null ? undefined : c.hits.find((h) => h.table === pos.table && h.row === pos.row && h.col === pos.col);
    // 今のセルが一致していなければ、まず次の一致へ移る（Googleスプレッドシートと同じ）
    if (here === undefined) {
      findNext();
      return;
    }
    const { replaced, failed } = replaceIn([here], c);
    report(replaced, failed);
    const after = computeHits(store, req, selection);
    if (after.ok && after.hits.length > 0) goTo(store, after.hits[nextHitIndex(after.hits, after.order, currentPos(store), 1)]);
  };

  const replaceAll = (): void => {
    const c = computeHits(store, req, selection);
    if (!c.ok) {
      setMessage(c.message);
      return;
    }
    if (c.hits.length === 0) {
      setFailures([]);
      setMessage(t('ui.find.noResults'));
      return;
    }
    const { replaced, failed } = replaceIn(c.hits, c);
    report(replaced, failed);
  };

  const scopes: [FindScope, string][] = [
    ['all', t('ui.find.scope.all')],
    ['table', t('ui.find.scope.table')],
    ['selection', selectionLabel],
  ];

  return (
    <DialogFrame
      title={t('ui.find.title')}
      onClose={close}
      width={520}
      testId="find-replace-dialog"
      footer={
        <>
          <button type="button" className="sc-button" onClick={findNext} data-testid="find-next">
            {t('ui.find.find')}
          </button>
          <button type="button" className="sc-button" onClick={replaceOne} data-testid="find-replace-one">
            {t('ui.find.replace')}
          </button>
          <button type="button" className="sc-button" onClick={replaceAll} data-testid="find-replace-all">
            {t('ui.find.replaceAll')}
          </button>
          <button type="button" className="sc-button primary" onClick={close} data-testid="find-done">
            {t('ui.find.done')}
          </button>
        </>
      }
    >
      <div className="sc-form" onKeyDown={submitOnEnter(findNext)}>
        <Field label={t('ui.find.query')} htmlFor="find-query">
          <input id="find-query" className="sc-text" value={req.query} spellCheck={false} onChange={(e) => update({ query: e.target.value })} data-testid="find-query" />
        </Field>
        <Field label={t('ui.find.replacement')} htmlFor="find-replacement" hint={req.regex ? t('ui.find.hint.groups') : undefined}>
          <input
            id="find-replacement"
            className="sc-text"
            value={replacement}
            spellCheck={false}
            onChange={(e) => setReplacement(e.target.value)}
            data-testid="find-replacement"
          />
        </Field>
        <Field label={t('ui.find.scope')} htmlFor="find-scope">
          <select id="find-scope" className="sc-select" value={req.scope} onChange={(e) => update({ scope: e.target.value as FindScope })} data-testid="find-scope">
            {scopes.map(([value, label]) => (
              <option key={value} value={value} disabled={value === 'selection' && selection === null}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <div className="sc-field">
          <span className="sc-field-label" />
          <div>
            <div>
              <Check label={t('ui.find.matchCase')} checked={req.matchCase} onChange={(v) => update({ matchCase: v })} testId="find-match-case" />
            </div>
            <div>
              <Check label={t('ui.find.entireCell')} checked={req.entireCell} onChange={(v) => update({ entireCell: v })} testId="find-entire-cell" />
            </div>
            <div>
              <Check label={t('ui.find.regex')} checked={req.regex} onChange={(v) => update({ regex: v })} testId="find-regex" />
            </div>
            <div>
              <Check label={t('ui.find.searchFormulas')} checked={req.searchFormulas} onChange={(v) => update({ searchFormulas: v })} testId="find-search-formulas" />
            </div>
          </div>
        </div>
        <div className="sc-form-status" role="status" data-testid="find-message">
          {message}
        </div>
        {failures.length > 0 && (
          <div className="sc-form-note" data-testid="replace-failures">
            <div>{t('ui.find.failuresTitle', { count: failures.length })}</div>
            <ul className="sc-form-list">
              {failures.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </DialogFrame>
  );
}

export const findReplaceDialog = defineDialog<FindReplaceArgs>('find.replace', FindReplaceDialog);
