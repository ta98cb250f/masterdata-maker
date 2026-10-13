import { describe, expect, it } from 'vitest';
import en from '../i18n/locales/en/sheet.json';
import ja from '../i18n/locales/ja/sheet.json';
import {
  SHORTCUTS,
  categoryDescriptionKey,
  formatChord,
  getShortcut,
  normalizeKey,
  resolveShortcut,
  shortcutLabels,
} from './shortcuts';
import type { KeyEventLike, Platform, ShortcutContext, ShortcutId } from './shortcuts';

type Mods = Partial<Pick<KeyEventLike, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>>;

function ev(key: string, mods: Mods = {}, code = ''): KeyEventLike {
  return { key, code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods };
}

const win = (e: KeyEventLike, ctx: ShortcutContext = 'grid') => resolveShortcut(e, 'other', ctx);
const mac = (e: KeyEventLike, ctx: ShortcutContext = 'grid') => resolveShortcut(e, 'mac', ctx);

describe('Windows のキー', () => {
  const cases: [KeyEventLike, ShortcutId][] = [
    [ev('c', { ctrlKey: true }), 'copy'],
    [ev('x', { ctrlKey: true }), 'cut'],
    [ev('v', { ctrlKey: true }), 'paste'],
    [ev('V', { ctrlKey: true, shiftKey: true }), 'pasteValues'],
    [ev('z', { ctrlKey: true }), 'undo'],
    [ev('y', { ctrlKey: true }), 'redo'],
    [ev('Z', { ctrlKey: true, shiftKey: true }), 'redo'],
    [ev('F4'), 'redo'],
    [ev('d', { ctrlKey: true }), 'fillDown'],
    [ev('r', { ctrlKey: true }), 'fillRight'],
    [ev('f', { ctrlKey: true }), 'find'],
    [ev('h', { ctrlKey: true }), 'findReplace'],
    [ev('a', { ctrlKey: true }), 'selectAll'],
    [ev(' ', { ctrlKey: true, shiftKey: true }, 'Space'), 'selectAll'],
    [ev('s', { ctrlKey: true }), 'save'],
    [ev('/', { ctrlKey: true }), 'showShortcuts'],
    [ev('Home', { ctrlKey: true }), 'moveSheetStart'],
    [ev('End', { ctrlKey: true }), 'moveSheetEnd'],
    [ev('Home'), 'moveRowStart'],
    [ev('End'), 'moveRowEnd'],
    [ev('ArrowDown'), 'moveDown'],
    [ev('ArrowUp', { ctrlKey: true }), 'moveEdgeUp'],
    [ev('ArrowLeft', { shiftKey: true }), 'extendLeft'],
    [ev('ArrowRight', { ctrlKey: true, shiftKey: true }), 'extendEdgeRight'],
    [ev('End', { ctrlKey: true, shiftKey: true }), 'extendSheetEnd'],
    [ev(' ', { shiftKey: true }, 'Space'), 'selectRow'],
    [ev(' ', { ctrlKey: true }, 'Space'), 'selectColumn'],
    [ev('F2'), 'editCell'],
    [ev('Enter'), 'enter'],
    [ev('Enter', { shiftKey: true }), 'shiftEnter'],
    [ev('Tab'), 'tab'],
    [ev('Tab', { shiftKey: true }), 'shiftTab'],
    [ev('Escape'), 'cancel'],
    [ev('Delete'), 'clear'],
    [ev('Backspace'), 'clear'],
    [ev('F2', { shiftKey: true }), 'insertNote'],
    [ev('=', { ctrlKey: true, altKey: true }), 'insertRowsCols'],
    [ev('-', { ctrlKey: true, altKey: true }), 'deleteRowsCols'],
    [ev('PageDown', { ctrlKey: true, shiftKey: true }), 'nextSheet'],
  ];
  it.each(cases)('%o → %s', (e, id) => {
    expect(win(e)).toBe(id);
  });

  it('JIS 配列で Shift が要る = でも行・列の挿入になる', () => {
    expect(win(ev('=', { ctrlKey: true, altKey: true, shiftKey: true }, 'Minus'))).toBe('insertRowsCols');
  });

  it('Windows キー（meta）付きや、割り当てのないキーは null', () => {
    expect(win(ev('c', { metaKey: true }))).toBeNull();
    expect(win(ev('q', { ctrlKey: true }))).toBeNull();
    expect(win(ev('a'))).toBeNull();
    expect(win(ev('Enter', { ctrlKey: true }))).toBeNull();
  });
});

describe('Mac のキー（⌘ を Ctrl として扱う）', () => {
  it('⌘ の組み合わせ', () => {
    expect(mac(ev('c', { metaKey: true }))).toBe('copy');
    expect(mac(ev('v', { metaKey: true, shiftKey: true }))).toBe('pasteValues');
    expect(mac(ev('z', { metaKey: true, shiftKey: true }))).toBe('redo');
    expect(mac(ev('y', { metaKey: true }))).toBe('redo');
    expect(mac(ev('d', { metaKey: true }))).toBe('fillDown');
    expect(mac(ev('/', { metaKey: true }))).toBe('showShortcuts');
    expect(mac(ev('ArrowDown', { metaKey: true }))).toBe('moveEdgeDown');
    expect(mac(ev('ArrowDown', { metaKey: true, shiftKey: true }))).toBe('extendEdgeDown');
    // ⌘+Fn+← は Home のキーイベント
    expect(mac(ev('Home', { metaKey: true }))).toBe('moveSheetStart');
  });

  it('Mac の Ctrl は ⌘ の代わりにならない', () => {
    expect(mac(ev('c', { ctrlKey: true }))).toBeNull();
  });

  it('列の選択は Control+Space、検索と置換は ⌘+Shift+H', () => {
    expect(mac(ev(' ', { ctrlKey: true }, 'Space'))).toBe('selectColumn');
    expect(mac(ev(' ', { metaKey: true }, 'Space'))).toBeNull();
    expect(mac(ev('h', { metaKey: true, shiftKey: true }))).toBe('findReplace');
    expect(mac(ev('h', { metaKey: true }))).toBeNull();
  });

  it('Option で文字が変わっても物理キーで判定する（⌘+Option+= など）', () => {
    expect(mac(ev('≠', { metaKey: true, altKey: true }, 'Equal'))).toBe('insertRowsCols');
    expect(mac(ev('–', { metaKey: true, altKey: true }, 'Minus'))).toBe('deleteRowsCols');
    expect(mac(ev('º', { metaKey: true, altKey: true }, 'Digit0'))).toBe('hideColumns');
    expect(mac(ev('ArrowDown', { altKey: true }))).toBe('nextSheet');
  });
});

describe('編集中のキー', () => {
  it('セル内の改行は編集中だけ', () => {
    expect(win(ev('Enter', { altKey: true }), 'edit')).toBe('newlineInCell');
    expect(win(ev('Enter', { ctrlKey: true }), 'edit')).toBe('newlineInCell');
    expect(mac(ev('Enter', { altKey: true }), 'edit')).toBe('newlineInCell');
    expect(mac(ev('Enter', { metaKey: true }), 'edit')).toBe('newlineInCell');
    expect(win(ev('Enter', { altKey: true }), 'grid')).toBeNull();
  });

  it('編集中は Enter / Tab / Esc / 保存は有効、コピーや矢印は文字の編集に任せる', () => {
    expect(win(ev('Enter'), 'edit')).toBe('enter');
    expect(win(ev('Tab', { shiftKey: true }), 'edit')).toBe('shiftTab');
    expect(win(ev('Escape'), 'edit')).toBe('cancel');
    expect(win(ev('s', { ctrlKey: true }), 'edit')).toBe('save');
    expect(win(ev('c', { ctrlKey: true }), 'edit')).toBeNull();
    expect(win(ev('ArrowLeft'), 'edit')).toBeNull();
    expect(win(ev('Delete'), 'edit')).toBeNull();
  });
});

describe('キー名の正規化', () => {
  it('空白キー・古いブラウザのキー名・Dead キー', () => {
    expect(normalizeKey({ key: ' ', code: 'Space' })).toBe('Space');
    expect(normalizeKey({ key: 'Esc', code: 'Escape' })).toBe('Escape');
    expect(normalizeKey({ key: 'Down', code: 'ArrowDown' })).toBe('ArrowDown');
    expect(normalizeKey({ key: 'Dead', code: 'KeyE' })).toBe('e');
    expect(normalizeKey({ key: 'A', code: 'KeyA' })).toBe('a');
    // ASCII の文字は刻印どおり（AZERTY の Q の位置が KeyA でも 'q'）
    expect(normalizeKey({ key: 'q', code: 'KeyA' })).toBe('q');
  });
});

describe('一覧', () => {
  const ids = SHORTCUTS.map((s) => s.id);

  it('要件書に出てくる操作がそろっている', () => {
    const required: ShortcutId[] = [
      'copy', 'cut', 'paste', 'pasteValues', 'undo', 'redo', 'fillDown', 'fillRight', 'find', 'findReplace',
      'selectAll', 'save', 'showShortcuts', 'moveSheetStart', 'moveSheetEnd', 'moveEdgeUp', 'moveEdgeDown',
      'moveEdgeLeft', 'moveEdgeRight', 'extendUp', 'extendDown', 'extendLeft', 'extendRight', 'extendEdgeUp',
      'extendEdgeDown', 'extendEdgeLeft', 'extendEdgeRight', 'selectRow', 'selectColumn', 'editCell', 'enter',
      'shiftEnter', 'tab', 'shiftTab', 'cancel', 'clear', 'newlineInCell', 'insertNote', 'insertRowsCols',
      'deleteRowsCols',
    ];
    for (const id of required) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getShortcut('copy')?.category).toBe('common');
  });

  it('同じ環境・状態で同じキーが 2 つの操作に割り当てられていない', () => {
    for (const platform of ['mac', 'other'] as Platform[]) {
      for (const ctx of ['grid', 'edit'] as ShortcutContext[]) {
        const seen = new Map<string, string>();
        for (const s of SHORTCUTS) {
          if (!s.contexts.includes(ctx)) continue;
          for (const c of platform === 'mac' ? s.mac : s.win) {
            const shifts = c.shift === 'any' ? [true, false] : [!!c.shift];
            for (const sh of shifts) {
              const sig = JSON.stringify([c.key, !!c.mod, !!c.ctrl, !!c.alt, sh]);
              expect(seen.get(sig) ?? s.id, `${platform}/${ctx} ${sig}`).toBe(s.id);
              seen.set(sig, s.id);
            }
          }
        }
      }
    }
  });

  it('説明と分類の文言が日本語と英語の両方にある', () => {
    const jaKeys = new Set(Object.keys(ja));
    const enKeys = new Set(Object.keys(en));
    for (const s of SHORTCUTS) {
      expect(jaKeys.has(s.descriptionKey), s.descriptionKey).toBe(true);
      expect(enKeys.has(s.descriptionKey), s.descriptionKey).toBe(true);
      expect(jaKeys.has(categoryDescriptionKey(s.category))).toBe(true);
      expect(enKeys.has(categoryDescriptionKey(s.category))).toBe(true);
    }
    expect([...jaKeys].sort()).toEqual([...enKeys].sort());
    for (const k of jaKeys) expect(k.startsWith('sheet.')).toBe(true);
  });

  it('表示用の表記', () => {
    expect(shortcutLabels(getShortcut('pasteValues')!, 'other')).toEqual(['Ctrl+Shift+V']);
    expect(shortcutLabels(getShortcut('pasteValues')!, 'mac')).toEqual(['⌘+Shift+V']);
    expect(shortcutLabels(getShortcut('redo')!, 'other')).toEqual(['Ctrl+Y', 'Ctrl+Shift+Z', 'F4']);
    expect(shortcutLabels(getShortcut('insertRowsCols')!, 'mac')).toEqual(['⌘+Option+=']);
    expect(shortcutLabels(getShortcut('selectColumn')!, 'mac')).toEqual(['Ctrl+Space']);
    expect(shortcutLabels(getShortcut('moveSheetStart')!, 'mac')).toEqual(['⌘+Fn+←']);
    expect(shortcutLabels(getShortcut('extendEdgeDown')!, 'other')).toEqual(['Ctrl+Shift+↓']);
    expect(formatChord({ key: 'Escape' }, 'other')).toBe('Esc');
  });
});
