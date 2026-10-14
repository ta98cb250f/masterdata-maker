// Ctrl+F の検索欄（FR-FND-01）の開閉と検索語。store ごとに 1 つ持ち、React からは useFindBar で購読する
import { useSyncExternalStore } from 'react';
import type { AppStore } from '../store/AppStore';

export interface FindBarState {
  open: boolean;
  query: string;
  /** 開くたびに増える（検索欄にフォーカスを置き直す合図） */
  focusSeq: number;
}

export class FindBarController {
  private state: FindBarState = { open: false, query: '', focusSeq: 0 };
  private readonly listeners = new Set<() => void>();

  getState = (): FindBarState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(patch: Partial<FindBarState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  /** 開いて検索欄にフォーカスを置く（開いていれば、フォーカスを置き直す） */
  open(query?: string): void {
    this.set({ open: true, query: query ?? this.state.query, focusSeq: this.state.focusSeq + 1 });
  }

  close(): void {
    if (this.state.open) this.set({ open: false });
  }

  setQuery(query: string): void {
    if (query !== this.state.query) this.set({ query });
  }
}

const controllers = new WeakMap<AppStore, FindBarController>();

export function findBar(store: AppStore): FindBarController {
  let c = controllers.get(store);
  if (c === undefined) {
    c = new FindBarController();
    controllers.set(store, c);
  }
  return c;
}

export function useFindBar(store: AppStore): FindBarState {
  const c = findBar(store);
  return useSyncExternalStore(c.subscribe, c.getState, c.getState);
}
