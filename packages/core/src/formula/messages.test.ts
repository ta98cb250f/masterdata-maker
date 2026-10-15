// 文言ファイル（i18n/locales/{ja,en}/formula.json）とメッセージコードの対応。
// ソースの中のコードは formulaError の引数の型（FormulaMessageCode）で型検査が保証する
import { describe, expect, test } from 'vitest';
import en from '../i18n/locales/en/formula.json';
import ja from '../i18n/locales/ja/formula.json';
import { FORMULA_MESSAGE_CODES } from './errors';

const locales: Record<string, Record<string, string>> = { ja, en };

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

describe('文言ファイル', () => {
  test.each(Object.keys(locales))('%s: メッセージコードと文言のキーが一致する', (lang) => {
    expect(Object.keys(locales[lang]).sort()).toEqual([...FORMULA_MESSAGE_CODES].sort());
  });

  test('日本語と英語で差し込みの名前が同じ', () => {
    for (const code of FORMULA_MESSAGE_CODES) {
      expect(placeholders(locales.en[code]), code).toEqual(placeholders(locales.ja[code]));
    }
  });

  test('文言は空でない', () => {
    for (const lang of Object.keys(locales)) {
      for (const code of FORMULA_MESSAGE_CODES) expect(locales[lang][code].length, `${lang} ${code}`).toBeGreaterThan(0);
    }
  });
});
