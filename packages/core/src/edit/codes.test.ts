import { describe, expect, it } from 'vitest';
import { registerMessages } from '../i18n/index';
import en from '../i18n/locales/en/edit.json';
import ja from '../i18n/locales/ja/edit.json';
import { EDIT_MESSAGE_CODES, EditCode } from './codes';
import type { InputContext } from './input';
import { parseCellInput } from './input';
import { formatEditFailure, formatInputError, formatInputHint } from './messages';

const locales: Record<string, Record<string, string>> = { ja, en };

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

describe('文言ファイル（edit.json）', () => {
  it.each(Object.keys(locales))('%s: 文言コードと文言のキーが一致し、キーは edit. で始まる', (lang) => {
    expect(Object.keys(locales[lang]).sort()).toEqual([...EDIT_MESSAGE_CODES].sort());
    for (const key of Object.keys(locales[lang])) expect(key.startsWith('edit.'), key).toBe(true);
  });

  it('日本語と英語で差し込みの名前が同じ。文言は空でない', () => {
    for (const code of EDIT_MESSAGE_CODES) {
      expect(placeholders(en[code as keyof typeof en]), code).toEqual(placeholders(ja[code as keyof typeof ja]));
      expect(ja[code as keyof typeof ja].length).toBeGreaterThan(0);
    }
  });

  it('文言コードは重複しない', () => {
    expect(new Set(EDIT_MESSAGE_CODES).size).toBe(EDIT_MESSAGE_CODES.length);
  });
});

describe('失敗の文言', () => {
  // index.ts への登録は親が行うので、テストではここで登録する
  registerMessages('ja', ja);
  registerMessages('en', en);
  const ctx: InputContext = { enums: [], timeZone: 'Asia/Tokyo' };

  it('§5.17 の 3 番: 「2 行目: abc は整数ではありません」', () => {
    const r = parseCellInput('abc', { type: 'int' }, ctx);
    if (r.ok) throw new Error('成功してしまった');
    expect(formatEditFailure({ ...r.error }, { row: 2 })).toBe('2 行目: abc は整数ではありません');
    expect(formatEditFailure({ ...r.error }, { row: 2 }, 'en')).toBe('Row 2: abc is not an integer');
    expect(formatEditFailure({ ...r.error }, { row: 2, column: 'HP' })).toBe('2 行目の HP: abc は整数ではありません');
  });

  it('FR-EDT-05: int 列に 12a →「整数を入力してください」', () => {
    const r = parseCellInput('12a', { type: 'int' }, ctx);
    if (r.ok) throw new Error('成功してしまった');
    expect(formatInputHint(r.error)).toBe('整数を入力してください');
    expect(formatInputError(r.error)).toBe('12a は整数ではありません');
  });

  it('リストの要素の失敗には位置を添える', () => {
    const r = parseCellInput('1, x', { type: 'list<int>' }, ctx);
    if (r.ok) throw new Error('成功してしまった');
    expect(formatInputError(r.error)).toBe('2 番目の要素: x は整数ではありません');
  });

  it('コマンドの失敗の文言', () => {
    expect(formatEditFailure({ code: EditCode.readonlyColumn, params: { column: 'id' } })).toBe('id 列は編集できません');
  });
});
