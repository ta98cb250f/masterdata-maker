// calc・validate・export・cli の文言ファイルと、formula・sheet の文言の登録
import { describe, expect, it } from 'vitest';
import { ExportCode } from '../export/codes';
import { ValidateCode } from '../validate/codes';
import { formatMessage, hasMessage } from './index';
import enCalc from './locales/en/calc.json';
import enCli from './locales/en/cli.json';
import enExport from './locales/en/export.json';
import enValidate from './locales/en/validate.json';
import jaCalc from './locales/ja/calc.json';
import jaCli from './locales/ja/cli.json';
import jaExport from './locales/ja/export.json';
import jaValidate from './locales/ja/validate.json';

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort();
}

const BUNDLES: [string, Record<string, string>, Record<string, string>, readonly string[] | null][] = [
  ['calc', jaCalc, enCalc, ['calc.tooDeep']],
  ['validate', jaValidate, enValidate, Object.values(ValidateCode)],
  ['export', jaExport, enExport, Object.values(ExportCode)],
  ['cli', jaCli, enCli, null],
];

describe('文言ファイル', () => {
  for (const [name, ja, en, codes] of BUNDLES) {
    it(`${name}: 日本語と英語で同じキー・同じ差し込み。キーは ${name}. で始まる`, () => {
      expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort());
      if (codes !== null) expect(Object.keys(ja).sort()).toEqual([...codes].sort());
      for (const key of Object.keys(ja)) {
        expect(key.startsWith(`${name}.`), key).toBe(true);
        expect(placeholders(en[key]), key).toEqual(placeholders(ja[key]));
        expect(ja[key].length, key).toBeGreaterThan(0);
        expect(hasMessage(key, 'ja') && hasMessage(key, 'en'), key).toBe(true);
      }
    });
  }

  it('formula と sheet の文言も登録されている', () => {
    expect(formatMessage('formula.divByZero')).toBe('0 で割ることはできません');
    expect(formatMessage('formula.divByZero', undefined, 'en')).toBe('Division by zero');
    expect(hasMessage('sheet.find.error.emptyQuery', 'ja')).toBe(true);
    expect(hasMessage('sheet.find.error.emptyQuery', 'en')).toBe(true);
  });
});
