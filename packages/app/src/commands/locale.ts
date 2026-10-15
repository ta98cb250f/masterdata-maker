// 言語の切り替え（FR-ETC-02）: ヘルプのメニューの「日本語」「English」
import type { Locale } from '@sheetcraft/core';
import { changeLocale } from '../store/locale';
import type { CommandDef } from './registry';

function localeCommand(locale: Locale, order: number): CommandDef {
  return {
    id: `help.locale.${locale}`,
    labelKey: `ui.locale.${locale}`,
    menu: { menu: 'help', group: 80, order },
    checked: (store) => store.getState().locale === locale,
    run: (store) => changeLocale(store, locale),
  };
}

export const localeCommands: CommandDef[] = [localeCommand('ja', 0), localeCommand('en', 1)];
