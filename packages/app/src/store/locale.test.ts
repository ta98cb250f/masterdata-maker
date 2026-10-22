import { describe, expect, it } from 'vitest';
import { formatMessage, hasMessage } from '@masterdata-maker/core';
import { UI_BUNDLES } from '../i18n';
import { AppStore } from './AppStore';
import type { LocaleStorage } from './locale';
import { LOCALE_STORAGE_KEY, changeLocale, loadSavedLocale, saveLocale } from './locale';
import { allCommands } from '../commands';

class MemoryStorage implements LocaleStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const broken: LocaleStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('言語の切り替え（FR-ETC-02）', () => {
  it('選んだ言語を覚え、次に開いたときに使う。知らない値や使えない保存先は無視する', () => {
    const storage = new MemoryStorage();
    expect(loadSavedLocale(storage)).toBeUndefined();
    const store = new AppStore({ commands: allCommands(), platform: 'other' });
    changeLocale(store, 'en', storage);
    expect(store.getState().locale).toBe('en');
    expect(store.t('ui.menu.file')).toBe('File');
    expect(storage.data.get(LOCALE_STORAGE_KEY)).toBe('en');
    expect(loadSavedLocale(storage)).toBe('en');
    storage.setItem(LOCALE_STORAGE_KEY, 'fr');
    expect(loadSavedLocale(storage)).toBeUndefined();
    expect(loadSavedLocale(broken)).toBeUndefined();
    expect(() => saveLocale('ja', broken)).not.toThrow();
    expect(loadSavedLocale(null)).toBeUndefined();
  });

  it('ヘルプのメニューに日本語と English があり、今の言語に印が付く', () => {
    const store = new AppStore({ commands: allCommands(), platform: 'other' });
    const items = store.commands.menuGroups('help').flat().map((d) => d.id);
    expect(items).toContain('help.locale.ja');
    expect(items).toContain('help.locale.en');
    expect(store.commands.get('help.locale.ja')?.checked?.(store)).toBe(true);
    void store.run('help.locale.en');
    expect(store.commands.get('help.locale.en')?.checked?.(store)).toBe(true);
    expect(store.commandLabel('help.locale.ja')).toBe('日本語 (Japanese)');
  });

  it('この段階で足した文言は、日本語と英語の両方にある', () => {
    for (const feature of ['worker', 'export', 'external', 'backup', 'locale']) {
      const ja = UI_BUNDLES.get('ja')?.get(feature) ?? {};
      const en = UI_BUNDLES.get('en')?.get(feature) ?? {};
      expect(Object.keys(ja).length, feature).toBeGreaterThan(0);
      expect(Object.keys(en).sort(), feature).toEqual(Object.keys(ja).sort());
      for (const key of Object.keys(ja)) {
        expect(hasMessage(key, 'en'), key).toBe(true);
        // 英語の文言に日本語が残っていない（言語の名前は、その言語で書くので除く）
        if (!key.startsWith('ui.locale.')) expect(formatMessage(key, {}, 'en'), key).not.toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/u);
      }
    }
  });
});
