import { describe, expect, it } from 'vitest';
import { IoCode } from '../io/codes';
import { formatMessage, hasMessage, messageKeys, registerMessages } from './index';
import enIo from './locales/en/io.json';
import jaIo from './locales/ja/io.json';

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort();
}

describe('formatMessage', () => {
  it('引数を差し込む。指定の言語に無ければ日本語、それも無ければコード', () => {
    expect(formatMessage(IoCode.missingKey, { key: 'table' })).toBe('table がありません');
    expect(formatMessage(IoCode.missingKey, { key: 'table' }, 'en')).toBe('table is missing');
    registerMessages('ja', { 'test.onlyJa': '{a} と {b}' });
    expect(formatMessage('test.onlyJa', { a: 1, b: 'x' }, 'en')).toBe('1 と x');
    expect(formatMessage('test.onlyJa', { a: 1 })).toBe('1 と {b}');
    expect(formatMessage('test.unknown')).toBe('test.unknown');
    expect(hasMessage(IoCode.bomRemoved, 'en')).toBe(true);
  });
});

describe('io の文言ファイル', () => {
  const codes = Object.values(IoCode);

  it('すべての診断コードに日本語と英語の文言がある', () => {
    for (const code of codes) {
      expect(hasMessage(code, 'ja'), code).toBe(true);
      expect(hasMessage(code, 'en'), code).toBe(true);
    }
    expect(messageKeys('ja')).toEqual(expect.arrayContaining(codes));
  });

  it('文言ファイルのキーは io. で始まり、日本語と英語で同じキー・同じ差し込み', () => {
    const ja = jaIo as Record<string, string>;
    const en = enIo as Record<string, string>;
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(ja).sort()).toEqual([...codes].sort());
    for (const key of Object.keys(ja)) {
      expect(key.startsWith('io.')).toBe(true);
      expect(placeholders(ja[key]), key).toEqual(placeholders(en[key]));
    }
  });
});
