// キーボード ショートカット（FR-ETC-01、R-1）。
// Googleスプレッドシートの公式ヘルプ（https://support.google.com/docs/answer/181110）のキー割り当てに合わせる。
// 「未検証」と書いたものは、公式ヘルプの本文で確かめられなかったもの。

export type Platform = 'mac' | 'other';

/** grid: セルを選んでいるとき（編集していない） / edit: セルを編集しているとき */
export type ShortcutContext = 'grid' | 'edit';

export type ShortcutCategory = 'common' | 'navigate' | 'select' | 'edit' | 'notes' | 'rowsCols' | 'sheets' | 'focus';

export type ShortcutId =
  | 'copy'
  | 'cut'
  | 'paste'
  | 'pasteValues'
  | 'undo'
  | 'redo'
  | 'fillDown'
  | 'fillRight'
  | 'find'
  | 'findReplace'
  | 'selectAll'
  | 'selectRow'
  | 'selectColumn'
  | 'save'
  | 'showShortcuts'
  | 'contextMenu'
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'moveEdgeUp'
  | 'moveEdgeDown'
  | 'moveEdgeLeft'
  | 'moveEdgeRight'
  | 'moveRowStart'
  | 'moveRowEnd'
  | 'moveSheetStart'
  | 'moveSheetEnd'
  | 'extendUp'
  | 'extendDown'
  | 'extendLeft'
  | 'extendRight'
  | 'extendEdgeUp'
  | 'extendEdgeDown'
  | 'extendEdgeLeft'
  | 'extendEdgeRight'
  | 'extendSheetStart'
  | 'extendSheetEnd'
  | 'editCell'
  | 'enter'
  | 'shiftEnter'
  | 'tab'
  | 'shiftTab'
  | 'cancel'
  | 'clear'
  | 'newlineInCell'
  | 'insertNote'
  | 'insertRowsCols'
  | 'deleteRowsCols'
  | 'hideColumns'
  | 'nextSheet'
  | 'prevSheet'
  | 'showSheetList'
  | 'focusNextRegion'
  | 'focusPrevRegion'
  | 'focusPanel';

/** キーの組み合わせ */
export interface KeyChord {
  /** 正規化したキー名（KeyboardEvent.key。1 文字のキーは小文字、空白キーは 'Space'） */
  key: string;
  /** Windows などでは Ctrl、Mac では ⌘ */
  mod?: boolean;
  /** 本物の Ctrl キー（Mac で ⌘ ではなく Control を使うもの） */
  ctrl?: boolean;
  /** Alt（Mac では Option） */
  alt?: boolean;
  /** Shift。'any' は押していてもいなくてもよい（キー配列によって Shift が要る記号のキー用） */
  shift?: boolean | 'any';
}

export interface ShortcutDef {
  id: ShortcutId;
  category: ShortcutCategory;
  /** どの状態で有効か */
  contexts: readonly ShortcutContext[];
  /** Windows・ChromeOS・Linux のキー */
  win: readonly KeyChord[];
  /** Mac のキー */
  mac: readonly KeyChord[];
  /** 説明の文言コード（i18n の sheet.json） */
  descriptionKey: string;
}

const GRID: readonly ShortcutContext[] = ['grid'];
const BOTH: readonly ShortcutContext[] = ['grid', 'edit'];
const EDIT: readonly ShortcutContext[] = ['edit'];

function def(
  id: ShortcutId,
  category: ShortcutCategory,
  contexts: readonly ShortcutContext[],
  win: readonly KeyChord[],
  mac: readonly KeyChord[] = win,
): ShortcutDef {
  return { id, category, contexts, win, mac, descriptionKey: `sheet.shortcut.${id}` };
}

/** Ctrl（Mac では ⌘）+ key */
const mod = (key: string, extra: Omit<KeyChord, 'key' | 'mod'> = {}): KeyChord => ({ key, mod: true, ...extra });
const plain = (key: string, extra: Omit<KeyChord, 'key'> = {}): KeyChord => ({ key, ...extra });

const ARROWS = [
  ['Up', 'ArrowUp'],
  ['Down', 'ArrowDown'],
  ['Left', 'ArrowLeft'],
  ['Right', 'ArrowRight'],
] as const;

/** ショートカットの一覧（Ctrl+/ で表示する一覧の元） */
export const SHORTCUTS: readonly ShortcutDef[] = [
  // よく使う操作（公式ヘルプの「一般的な操作」）
  def('copy', 'common', GRID, [mod('c')]),
  def('cut', 'common', GRID, [mod('x')]),
  def('paste', 'common', GRID, [mod('v')]),
  // 値のみ貼り付け: 公式ヘルプの本文は未検証（解説サイトでは Ctrl+Shift+V / ⌘+Shift+V）
  def('pasteValues', 'common', GRID, [mod('v', { shift: true })]),
  def('undo', 'common', GRID, [mod('z')]),
  def('redo', 'common', GRID, [mod('y'), mod('z', { shift: true }), plain('F4')]),
  def('fillDown', 'common', GRID, [mod('d')]),
  def('fillRight', 'common', GRID, [mod('r')]),
  def('find', 'common', GRID, [mod('f')]),
  // Mac の検索と置換は ⌘+Shift+H（⌘+H はアプリを隠す操作のため）
  def('findReplace', 'common', GRID, [mod('h')], [mod('h', { shift: true })]),
  def('selectAll', 'common', GRID, [mod('a'), mod('Space', { shift: true })]),
  def('selectRow', 'common', GRID, [plain('Space', { shift: true })]),
  // 列の選択は Mac でも Control+Space（⌘+Space は Spotlight のため）
  def('selectColumn', 'common', GRID, [plain('Space', { ctrl: true })]),
  def('save', 'common', BOTH, [mod('s')]),
  def('showShortcuts', 'common', GRID, [mod('/')]),
  // 右クリックメニューをキーで開く（NFR-40。Shift+F10 と ContextMenu キーはブラウザの慣例。Googleスプレッドシートでは未検証）
  def('contextMenu', 'common', GRID, [plain('F10', { shift: true }), plain('ContextMenu')]),

  // 移動（Mac の Ctrl+矢印にあたる ⌘+矢印は未検証）
  ...ARROWS.map(([name, key]) => def(`move${name}` as ShortcutId, 'navigate', GRID, [plain(key)])),
  ...ARROWS.map(([name, key]) => def(`moveEdge${name}` as ShortcutId, 'navigate', GRID, [mod(key)])),
  // Mac では Fn+← / Fn+→ が Home / End のキーイベントになる
  def('moveRowStart', 'navigate', GRID, [plain('Home')]),
  def('moveRowEnd', 'navigate', GRID, [plain('End')]),
  def('moveSheetStart', 'navigate', GRID, [mod('Home')]),
  def('moveSheetEnd', 'navigate', GRID, [mod('End')]),

  // 範囲の選択（Ctrl+Shift+Home / End は未検証）
  ...ARROWS.map(([name, key]) => def(`extend${name}` as ShortcutId, 'select', GRID, [plain(key, { shift: true })])),
  ...ARROWS.map(([name, key]) => def(`extendEdge${name}` as ShortcutId, 'select', GRID, [mod(key, { shift: true })])),
  def('extendSheetStart', 'select', GRID, [mod('Home', { shift: true })]),
  def('extendSheetEnd', 'select', GRID, [mod('End', { shift: true })]),

  // 入力と編集（F2 での編集開始、セル内の改行は公式ヘルプの本文で未検証）
  def('editCell', 'edit', GRID, [plain('F2')]),
  def('enter', 'edit', BOTH, [plain('Enter')]),
  def('shiftEnter', 'edit', BOTH, [plain('Enter', { shift: true })]),
  def('tab', 'edit', BOTH, [plain('Tab')]),
  def('shiftTab', 'edit', BOTH, [plain('Tab', { shift: true })]),
  def('cancel', 'edit', BOTH, [plain('Escape')]),
  // Mac の delete キーは Backspace、Fn+delete は Delete のキーイベントになる
  def('clear', 'edit', GRID, [plain('Delete'), plain('Backspace')]),
  def('newlineInCell', 'edit', EDIT, [plain('Enter', { alt: true }), mod('Enter')]),

  // メモ
  def('insertNote', 'notes', GRID, [plain('F2', { shift: true })]),

  // 行と列（行を選んでいるときは行、列を選んでいるときは列が対象）
  def('insertRowsCols', 'rowsCols', GRID, [mod('=', { alt: true, shift: 'any' })]),
  def('deleteRowsCols', 'rowsCols', GRID, [mod('-', { alt: true })]),
  // 列を非表示: 未検証
  def('hideColumns', 'rowsCols', GRID, [mod('0', { alt: true })]),

  // シート（Mac は Option+↓ / Option+↑）
  def('nextSheet', 'sheets', GRID, [mod('PageDown', { shift: true })], [plain('ArrowDown', { alt: true })]),
  def('prevSheet', 'sheets', GRID, [mod('PageUp', { shift: true })], [plain('ArrowUp', { alt: true })]),
  // 全シートの一覧: 公式ヘルプの本文は未検証（解説サイトでは Alt+Shift+K / Option+Shift+K）
  def('showSheetList', 'sheets', GRID, [plain('k', { alt: true, shift: true })]),

  // フォーカスの移動（NFR-40）。グリッドでは Tab がセルの移動に使われるので、メニューバー・ツールバー・数式バー・グリッド・
  // パネル・シートタブの間は F6 / Shift+F6 で巡回する（Googleスプレッドシートの公式ヘルプでは確かめられなかった。
  // Excel・ブラウザの「次の領域へ」の慣例に合わせた判断）
  def('focusNextRegion', 'focus', BOTH, [plain('F6')]),
  def('focusPrevRegion', 'focus', BOTH, [plain('F6', { shift: true })]),
  // パネルへ移る: Googleスプレッドシートの「サイドパネルに移動」（Ctrl+Alt+. / Ctrl+Alt+,）。Mac の ⌘+Option は未検証
  def('focusPanel', 'focus', BOTH, [mod('.', { alt: true }), mod(',', { alt: true })]),
];

const SHORTCUT_BY_ID: ReadonlyMap<ShortcutId, ShortcutDef> = new Map(SHORTCUTS.map((s) => [s.id, s]));

export function getShortcut(id: ShortcutId): ShortcutDef | undefined {
  return SHORTCUT_BY_ID.get(id);
}

/** 分類の文言コード */
export function categoryDescriptionKey(category: ShortcutCategory): string {
  return `sheet.shortcutCategory.${category}`;
}

/** キーイベントのうち、判定に使う情報 */
export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const KEY_ALIASES: Readonly<Record<string, string>> = {
  ' ': 'Space',
  Spacebar: 'Space',
  Esc: 'Escape',
  Del: 'Delete',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
};

const CODE_KEYS: Readonly<Record<string, string>> = {
  Equal: '=',
  Minus: '-',
  Slash: '/',
  Period: '.',
  Comma: ',',
  Space: 'Space',
};

/** 物理キーの位置（KeyboardEvent.code）からキー名を求める */
function keyFromCode(code: string): string | null {
  if (code.length === 4 && code.startsWith('Key')) return code[3].toLowerCase();
  if (code.length === 6 && code.startsWith('Digit')) return code[5];
  return CODE_KEYS[code] ?? null;
}

/**
 * キー名を正規化する。Mac の Option などで ASCII 以外の文字（`≠` や `å`）になったときは、物理キーの位置から求める。
 * ASCII の文字はそのまま使う（キー配列が違っても、刻印どおりの文字で判定するため）
 */
export function normalizeKey(event: Pick<KeyEventLike, 'key' | 'code'>): string {
  const k = KEY_ALIASES[event.key] ?? event.key;
  if (k.length === 1) {
    const c = k.charCodeAt(0);
    if (c < 0x20 || c > 0x7e) return keyFromCode(event.code) ?? k;
    return k.toLowerCase();
  }
  if (k === 'Dead' || k === 'Unidentified') return keyFromCode(event.code) ?? k;
  return k;
}

function chordMatches(chord: KeyChord, key: string, event: KeyEventLike, platform: Platform): boolean {
  if (chord.key !== key) return false;
  if (platform === 'mac') {
    if (event.metaKey !== !!chord.mod) return false;
    if (event.ctrlKey !== !!chord.ctrl) return false;
  } else {
    if (event.metaKey) return false;
    if (event.ctrlKey !== (!!chord.mod || !!chord.ctrl)) return false;
  }
  if (event.altKey !== !!chord.alt) return false;
  if (chord.shift !== 'any' && event.shiftKey !== !!chord.shift) return false;
  return true;
}

/**
 * キーイベントから操作の識別子を求める。Mac では ⌘ を Windows の Ctrl として扱う。
 * 該当が無ければ null
 */
export function resolveShortcut(event: KeyEventLike, platform: Platform, context: ShortcutContext = 'grid'): ShortcutId | null {
  const key = normalizeKey(event);
  for (const s of SHORTCUTS) {
    if (!s.contexts.includes(context)) continue;
    const chords = platform === 'mac' ? s.mac : s.win;
    if (chords.some((c) => chordMatches(c, key, event, platform))) return s.id;
  }
  return null;
}

const KEY_LABELS: Readonly<Record<string, string>> = {
  Space: 'Space',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

const MAC_KEY_LABELS: Readonly<Record<string, string>> = {
  Home: 'Fn+←',
  End: 'Fn+→',
  PageUp: 'Fn+↑',
  PageDown: 'Fn+↓',
  Backspace: 'Delete',
  Delete: 'Fn+Delete',
};

/** 表示用のキーの表記（例: `Ctrl+Shift+V`、`⌘+Shift+V`） */
export function formatChord(chord: KeyChord, platform: Platform): string {
  const parts: string[] = [];
  if (platform === 'mac') {
    if (chord.ctrl) parts.push('Ctrl');
    if (chord.mod) parts.push('⌘');
    if (chord.alt) parts.push('Option');
  } else {
    if (chord.mod || chord.ctrl) parts.push('Ctrl');
    if (chord.alt) parts.push('Alt');
  }
  if (chord.shift === true) parts.push('Shift');
  const k = chord.key;
  const label =
    (platform === 'mac' ? MAC_KEY_LABELS[k] : undefined) ?? KEY_LABELS[k] ?? (k.length === 1 ? k.toUpperCase() : k);
  parts.push(label);
  return parts.join('+');
}

/** ショートカットの表示用の表記の一覧 */
export function shortcutLabels(shortcut: ShortcutDef, platform: Platform): string[] {
  return (platform === 'mac' ? shortcut.mac : shortcut.win).map((c) => formatChord(c, platform));
}
