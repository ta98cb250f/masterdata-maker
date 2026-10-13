// 文言の多言語化（FR-ETC-02）。文言ファイルは「キー → `{name}` 形式の差し込みを含む文」の平らな JSON
import enIo from './locales/en/io.json';
import jaIo from './locales/ja/io.json';

export type Locale = 'ja' | 'en';
export type Messages = Readonly<Record<string, string>>;
export type MessageParams = Readonly<Record<string, string | number>>;

export const DEFAULT_LOCALE: Locale = 'ja';

const catalogs = new Map<string, Record<string, string>>();

/** 文言を登録する。同じキーは後から登録したものが優先される */
export function registerMessages(locale: string, messages: Messages): void {
  let catalog = catalogs.get(locale);
  if (catalog === undefined) {
    catalog = {};
    catalogs.set(locale, catalog);
  }
  Object.assign(catalog, messages);
}

// 文言ファイルを足すときは、ここに import と 1 行を加える
const BUNDLES: readonly [Locale, Messages][] = [
  ['ja', jaIo],
  ['en', enIo],
];
for (const [locale, messages] of BUNDLES) registerMessages(locale, messages);

export function hasMessage(code: string, locale: string = DEFAULT_LOCALE): boolean {
  return catalogs.get(locale)?.[code] !== undefined;
}

/** 登録済みの文言のキー（テスト用） */
export function messageKeys(locale: string): string[] {
  return Object.keys(catalogs.get(locale) ?? {});
}

/**
 * コードと引数から文言を作る。指定の言語に無ければ既定の言語、それも無ければコードそのものを返す。
 * 引数が無い差し込み（`{name}`）はそのまま残す
 */
export function formatMessage(code: string, params?: MessageParams, locale: string = DEFAULT_LOCALE): string {
  const template = catalogs.get(locale)?.[code] ?? catalogs.get(DEFAULT_LOCALE)?.[code] ?? code;
  if (params === undefined) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}
