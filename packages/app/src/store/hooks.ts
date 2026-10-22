// AppStore を React から購読する
import type { MessageParams } from '@masterdata-maker/core';
import { formatMessage } from '@masterdata-maker/core';
import { createContext, useCallback, useContext, useRef, useSyncExternalStore } from 'react';
import type { Translate } from '../i18n';
import type { AppStore } from './AppStore';
import type { AppState } from './types';

export const StoreContext = createContext<AppStore | null>(null);

export function useStore(): AppStore {
  const store = useContext(StoreContext);
  if (store === null) throw new Error('StoreContext is not provided');
  return store;
}

/**
 * 状態の一部を購読する。selector の結果が isEqual で前と同じなら再描画しない
 * （selector が毎回新しい配列などを返すときは isEqual を渡す）
 */
export function useAppState<T>(selector: (state: AppState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const store = useStore();
  const cache = useRef<{ state: AppState; selector: (state: AppState) => T; value: T } | null>(null);
  const getSnapshot = (): T => {
    const state = store.getState();
    const prev = cache.current;
    if (prev !== null && prev.state === state && prev.selector === selector) return prev.value;
    const value = selector(state);
    if (prev !== null && isEqual(prev.value, value)) {
      cache.current = { state, selector, value: prev.value };
      return prev.value;
    }
    cache.current = { state, selector, value };
    return value;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** 配列を要素ごとに比べる（useAppState の isEqual に使う） */
export function shallowArrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
}

/** オブジェクトをキーごとに比べる */
export function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  const ka = Object.keys(a) as (keyof T)[];
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.is(a[k], b[k]));
}

/** 文言を引く関数（言語が変わると作り直される） */
export function useT(): Translate {
  const locale = useAppState((s) => s.locale);
  return useCallback((key: string, params?: MessageParams) => formatMessage(key, params, locale), [locale]);
}
