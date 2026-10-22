import { describe, expect, it } from 'vitest';
import { formatMessage, hasMessage } from '@masterdata-maker/core';
import { UI_BUNDLES, registerUiMessages } from './index';

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort();
}

const sources = import.meta.glob<string>('../**/*.{ts,tsx}', { eager: true, query: '?raw', import: 'default' });

describe('画面の文言（FR-ETC-02）', () => {
  it('日本語と英語で同じファイル・同じキー・同じ差し込み。キーは ui. で始まる', () => {
    const ja = UI_BUNDLES.get('ja');
    const en = UI_BUNDLES.get('en');
    expect(ja).toBeDefined();
    expect(en).toBeDefined();
    expect([...(en?.keys() ?? [])].sort()).toEqual([...(ja?.keys() ?? [])].sort());
    for (const [feature, messages] of ja ?? []) {
      const english = en?.get(feature) ?? {};
      expect(Object.keys(english).sort(), feature).toEqual(Object.keys(messages).sort());
      for (const [key, text] of Object.entries(messages)) {
        expect(key.startsWith('ui.'), key).toBe(true);
        expect(text.length, key).toBeGreaterThan(0);
        expect(placeholders(english[key]), key).toEqual(placeholders(text));
      }
    }
  });

  it('コードで使っている ui. の文言キーは、すべて文言ファイルにある', () => {
    registerUiMessages();
    const used = new Set<string>();
    for (const [path, text] of Object.entries(sources)) {
      if (path.endsWith('.test.ts')) continue;
      for (const m of text.matchAll(/'(ui\.[A-Za-z0-9_.]+)'/g)) used.add(m[1]);
    }
    for (const menu of ['file', 'edit', 'view', 'insert', 'data', 'help']) used.add(`ui.menu.${menu}`);
    expect(used.size).toBeGreaterThan(50);
    for (const key of used) {
      expect(hasMessage(key, 'ja'), key).toBe(true);
      expect(hasMessage(key, 'en'), key).toBe(true);
    }
    expect(formatMessage('ui.save.done', { count: 2 }, 'ja')).toBe('保存しました（2 ファイル）');
  });
});
