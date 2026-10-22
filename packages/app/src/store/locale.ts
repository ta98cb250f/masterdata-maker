// 言語の切り替え（FR-ETC-02）。選んだ言語はブラウザに覚える（localStorage。使えない環境では覚えないだけ）
import type { Locale } from '@masterdata-maker/core';
import { SUPPORTED_LOCALES } from '../i18n';
import type { AppStore } from './AppStore';

export const LOCALE_STORAGE_KEY = 'masterdata-maker.locale';

export interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): LocaleStorage | null {
  try {
    return (globalThis as { localStorage?: LocaleStorage }).localStorage ?? null;
  } catch {
    // プライベートブラウズなどで localStorage に触れると投げる環境がある
    return null;
  }
}

function isLocale(value: string | null): value is Locale {
  return value !== null && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** 覚えている言語。覚えていなければ undefined（既定の日本語になる） */
export function loadSavedLocale(storage: LocaleStorage | null = defaultStorage()): Locale | undefined {
  try {
    const value = storage?.getItem(LOCALE_STORAGE_KEY) ?? null;
    return isLocale(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function saveLocale(locale: Locale, storage: LocaleStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // 覚えられなくても、今の画面の言語は変わる
  }
}

/** 言語を変えて覚える */
export function changeLocale(store: AppStore, locale: Locale, storage: LocaleStorage | null = defaultStorage()): void {
  store.setLocale(locale);
  saveLocale(locale, storage);
}

/** 画面の言語に合わせて html の lang を変える。戻り値で購読をやめる */
export function installLocale(store: AppStore): () => void {
  const apply = () => {
    if (typeof document !== 'undefined') document.documentElement.lang = store.getState().locale;
  };
  let last = store.getState().locale;
  apply();
  return store.subscribe(() => {
    const locale = store.getState().locale;
    if (locale === last) return;
    last = locale;
    apply();
  });
}
