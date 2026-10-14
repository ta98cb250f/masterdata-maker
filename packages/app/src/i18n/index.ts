// 画面の文言（FR-ETC-02）。文言ファイルは i18n/locales/<言語>/<機能>.json に置く（キーは `ui.` で始める）。
// ファイルを足すだけで登録される（後の段階で機能ごとにファイルを分けて足せるように）
import type { Locale, MessageParams, Messages } from '@sheetcraft/core';
import { formatMessage, registerMessages } from '@sheetcraft/core';

const files = import.meta.glob<Messages>('./locales/*/*.json', { eager: true, import: 'default' });

/** 言語 → 機能 → 文言（テストで使う） */
export const UI_BUNDLES: ReadonlyMap<string, ReadonlyMap<string, Messages>> = (() => {
  const map = new Map<string, Map<string, Messages>>();
  for (const [path, messages] of Object.entries(files)) {
    const m = /\.\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (m === null) continue;
    let byFeature = map.get(m[1]);
    if (byFeature === undefined) {
      byFeature = new Map();
      map.set(m[1], byFeature);
    }
    byFeature.set(m[2], messages);
  }
  return map;
})();

let registered = false;

/** 画面の文言を core の文言の表に登録する（何度呼んでもよい） */
export function registerUiMessages(): void {
  if (registered) return;
  registered = true;
  for (const [locale, byFeature] of UI_BUNDLES) {
    for (const messages of byFeature.values()) registerMessages(locale, messages);
  }
}

registerUiMessages();

export const SUPPORTED_LOCALES: readonly Locale[] = ['ja', 'en'];

/** 文言を引く */
export function translate(locale: Locale, key: string, params?: MessageParams): string {
  return formatMessage(key, params, locale);
}

export type Translate = (key: string, params?: MessageParams) => string;
