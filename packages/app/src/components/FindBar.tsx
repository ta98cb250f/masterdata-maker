// Ctrl+F の検索欄（FR-FND-01）。Googleスプレッドシートと同じく、グリッドの右上に小さく出す。
// 表示中のテーブルの表示中のセルを、大文字と小文字を区別せずに部分一致で探す（細かい条件は検索と置換のダイアログ。Ctrl+H）。
// 入力すると最初の一致を選び、Enter / ↓ で次、Shift+Enter / ↑ で前、Esc で閉じる
import type { KeyboardEvent } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createMatcher, defaultFindOptions, resolveShortcut, selectCell } from '@sheetcraft/core';
import type { FindHit } from '../sheet/findHits';
import { findInSheet, nextHitIndex } from '../sheet/findHits';
import type { AppStore } from '../store/AppStore';
import { useAppState, useStore, useT } from '../store/hooks';
import { ChevronDownIcon, ChevronUpIcon, MoreIcon } from './featureIcons';
import { findBar, useFindBar } from './findBarState';
import { CloseIcon } from './icons';
import '../styles/findBar.css';

/** 入力が止まってから探すまでの時間（大きなテーブルで打つたびに探さない） */
const DEBOUNCE_MS = 120;

function selectHit(store: AppStore, hit: FindHit): void {
  const sheet = store.sheet(hit.table);
  if (sheet === null) return;
  store.setSelection(selectCell({ row: hit.row, col: hit.col }, sheet.size), { reveal: true, table: hit.table });
}

export function FindBar() {
  const store = useStore();
  const t = useT();
  const bar = useFindBar(store);
  const revision = useAppState((s) => s.revision);
  const active = useAppState((s) => s.activeTable);
  const order = useAppState((s) => (s.activeTable === null ? null : (s.views.get(s.activeTable)?.order ?? null)));
  const inputRef = useRef<HTMLInputElement>(null);
  const [debounced, setDebounced] = useState(bar.query);
  const [current, setCurrent] = useState(-1);

  useLayoutEffect(() => {
    if (!bar.open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [bar.open, bar.focusSeq]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(bar.query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [bar.query]);

  const hits = useMemo(() => {
    const calc = store.calc;
    const sheet = store.sheet(active);
    if (!bar.open || debounced === '' || calc === null || sheet === null) return [];
    const m = createMatcher(defaultFindOptions(debounced));
    return m.ok ? findInSheet(calc, sheet, m.matcher, false) : [];
    // revision・order: 編集や並べ替えで一致し直す
  }, [store, bar.open, debounced, active, revision, order]);

  // 検索語を変えたら、今の位置から最初の一致を選ぶ（Googleスプレッドシートと同じく、打つたびに移る）
  const lastQuery = useRef<string | null>(null);
  useEffect(() => {
    if (!bar.open) {
      lastQuery.current = null;
      return;
    }
    if (lastQuery.current === debounced) {
      setCurrent((c) => Math.min(c, hits.length - 1));
      return;
    }
    lastQuery.current = debounced;
    const anchor = store.selection()?.anchor;
    const i = nextHitIndex(hits, () => 0, active === null || anchor === undefined ? null : { table: active, ...anchor }, 1, true);
    setCurrent(i);
    if (i >= 0) selectHit(store, hits[i]);
  }, [hits, debounced, bar.open, active, store]);

  if (!bar.open) return null;

  const move = (direction: 1 | -1) => {
    if (hits.length === 0) return;
    const anchor = store.selection()?.anchor;
    const pos = active === null || anchor === undefined ? null : { table: active, ...anchor };
    const i = nextHitIndex(hits, () => 0, pos, direction);
    setCurrent(i);
    selectHit(store, hits[i]);
  };

  const close = () => {
    findBar(store).close();
    store.focusGrid();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      // 打った直後でも、今の検索語で探す
      if (debounced !== bar.query) setDebounced(bar.query);
      else move(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    const id = resolveShortcut(e.nativeEvent, store.platform, 'grid');
    if (id === 'findReplace') {
      e.preventDefault();
      void store.run('find.replace', { query: bar.query });
    } else if (id === 'find') {
      e.preventDefault();
      inputRef.current?.select();
    } else if (id === 'save') {
      e.preventDefault();
      void store.run('file.save');
    }
  };

  const pending = debounced !== bar.query;
  const count = bar.query === '' ? '' : pending ? '…' : t('ui.findBar.count', { index: hits.length === 0 ? 0 : current + 1, total: hits.length });

  return (
    <div className="sc-findbar" role="search" data-testid="find-bar" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        className="sc-findbar-input"
        value={bar.query}
        placeholder={t('ui.findBar.placeholder')}
        aria-label={t('ui.findBar.placeholder')}
        spellCheck={false}
        data-testid="find-bar-input"
        onChange={(e) => findBar(store).setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="sc-findbar-count" data-testid="find-bar-count">
        {count}
      </span>
      <span className="sc-findbar-sep" />
      <button type="button" className="sc-icon-button" title={t('ui.findBar.prev')} aria-label={t('ui.findBar.prev')} disabled={hits.length === 0} onClick={() => move(-1)} data-testid="find-bar-prev">
        <ChevronUpIcon />
      </button>
      <button type="button" className="sc-icon-button" title={t('ui.findBar.next')} aria-label={t('ui.findBar.next')} disabled={hits.length === 0} onClick={() => move(1)} data-testid="find-bar-next">
        <ChevronDownIcon />
      </button>
      <button
        type="button"
        className="sc-icon-button"
        title={t('ui.findBar.more')}
        aria-label={t('ui.findBar.more')}
        onClick={() => void store.run('find.replace', { query: bar.query })}
        data-testid="find-bar-more"
      >
        <MoreIcon />
      </button>
      <button type="button" className="sc-icon-button" title={t('ui.findBar.close')} aria-label={t('ui.findBar.close')} onClick={close} data-testid="find-bar-close">
        <CloseIcon />
      </button>
    </div>
  );
}
