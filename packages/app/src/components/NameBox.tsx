// セル位置の表示（Googleスプレッドシートの名前ボックスにあたる。FR-UI-03）。
// ふだんは「テーブル / 列名 / 主キー」を表示し、クリック（または Enter・F2）で入力欄になる。位置を入れて Enter でそのセルへ移る
import type { KeyboardEvent } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { selectCell, selectColRange } from '@sheetcraft/core';
import type { LocationTarget } from '../sheet/location';
import { resolveLocation } from '../sheet/location';
import type { AppStore } from '../store/AppStore';
import { useStore, useT } from '../store/hooks';
import '../styles/nameBox.css';

/** 位置へ移る。移れなければ理由の文言を返す */
export function goToLocation(store: AppStore, target: LocationTarget): string | null {
  // 編集中のセルは先に確定する（確定できなければ動かない）
  if (store.getState().editing !== null && !store.commitEdit(null)) return store.t('ui.nameBox.cannotSwitch');
  if (store.getState().activeTable !== target.table) {
    store.setActiveTable(target.table);
    // 編集中のセルを確定できなければ切り替わらない
    if (store.getState().activeTable !== target.table) return store.t('ui.nameBox.cannotSwitch');
  }
  if (target.kind === 'table') return null;
  const sheet = store.sheet(target.table);
  if (sheet === null) return store.t('ui.nameBox.broken', { name: store.entry(target.table)?.name ?? '' });
  const col = sheet.colOf(target.column);
  if (col < 0) return store.t('ui.nameBox.hiddenColumn', { name: target.column });
  if (target.kind === 'column') {
    store.setSelection(selectColRange(col, col, sheet.size), { reveal: true, table: target.table });
    return null;
  }
  const row = sheet.rowOf(target.record);
  if (row < 0) return store.t('ui.nameBox.hiddenRow');
  store.setSelection(selectCell({ row, col }, sheet.size), { reveal: true, table: target.table });
  return null;
}

/** 入力した位置を解釈して移る。移れなければ理由の文言を返す */
export function goToLocationText(store: AppStore, text: string): string | null {
  const { project, calc, activeTable } = store.getState();
  if (project === null || calc === null) return null;
  const sheet = store.sheet();
  const anchor = store.selection()?.anchor;
  const activeColumn = sheet === null || anchor === undefined ? undefined : sheet.columns[anchor.col]?.name;
  const r = resolveLocation({ project, calc, activeTable, activeColumn }, text);
  if (!r.ok) return store.t(r.code, r.params);
  return goToLocation(store, r.target);
}

export function NameBox({ location }: { location: string }) {
  const store = useStore();
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);

  useLayoutEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const start = () => {
    if (store.getState().project === null) return;
    if (store.getState().editing !== null && !store.commitEdit(null)) return;
    setText(location);
    setError(null);
    setEditing(true);
  };

  const finish = () => {
    setEditing(false);
    setError(null);
    store.focusGrid();
  };

  const commit = () => {
    const message = goToLocationText(store, text);
    if (message !== null) {
      setError(message);
      inputRef.current?.select();
      return;
    }
    finish();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish();
    }
  };

  if (!editing) {
    return (
      <div
        className="sc-namebox sc-namebox-idle"
        title={`${location}\n${t('ui.nameBox.hint')}`}
        tabIndex={0}
        role="button"
        aria-label={t('ui.nameBox.label')}
        // F6 で数式バーの領域に入ったときは、ここにフォーカスを置く（Tab で数式の入力欄へ。NFR-40）
        data-region-focus=""
        data-testid="name-box"
        onClick={start}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'F2' || e.key === ' ') {
            e.preventDefault();
            start();
          }
        }}
      >
        {location}
      </div>
    );
  }
  return (
    <div className="sc-namebox sc-namebox-editing" data-testid="name-box">
      <input
        ref={inputRef}
        className={`sc-namebox-input${error !== null ? ' invalid' : ''}`}
        value={text}
        spellCheck={false}
        aria-label={t('ui.nameBox.label')}
        aria-invalid={error !== null}
        placeholder={t('ui.nameBox.placeholder')}
        data-testid="name-box-input"
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setEditing(false);
          setError(null);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
      />
      {error !== null && (
        <div className="sc-namebox-error" role="alert" data-testid="name-box-error">
          {error}
        </div>
      )}
    </div>
  );
}
