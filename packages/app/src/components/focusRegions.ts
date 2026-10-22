// 画面の領域の間のフォーカスの移動（NFR-40）。グリッドでは Tab がセルの移動に使われるので、領域の間は F6 / Shift+F6 で巡回し、
// Ctrl+Alt+. / Ctrl+Alt+,（Googleスプレッドシートの「サイドパネルに移動」）で開いているパネルへ移る。
// 領域は要素に data-region を付けて示す（巡回の順は画面の上から下・左から右の REGION_ORDER）。領域に入ったときにフォーカスを
// 置く要素には data-region-focus を付ける（無ければ data-region-fallback、それも無ければ最初のボタンなど）
import { resolveShortcut } from '@masterdata-maker/core';
import { useEffect } from 'react';
import type { AppStore } from '../store/AppStore';

export type FocusRegion = 'title' | 'menubar' | 'toolbar' | 'formulaBar' | 'main' | 'panelBottom' | 'panelRight' | 'sheetTabs';

/** 巡回の順（main はグリッド・読み込みエラーの表示・開始画面） */
export const REGION_ORDER: readonly FocusRegion[] = ['title', 'menubar', 'toolbar', 'formulaBar', 'main', 'panelBottom', 'panelRight', 'sheetTabs'];

const PANEL_REGIONS: readonly FocusRegion[] = ['panelBottom', 'panelRight'];

/** パネルの置き場の領域 */
export function panelRegion(position: 'right' | 'bottom'): FocusRegion {
  return position === 'right' ? 'panelRight' : 'panelBottom';
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function regionElement(region: FocusRegion): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.querySelector<HTMLElement>(`[data-region="${region}"]`);
}

/** 要素がどの領域の中にあるか */
export function regionOf(node: EventTarget | null): FocusRegion | null {
  if (typeof Element === 'undefined' || !(node instanceof Element)) return null;
  const el = node.closest<HTMLElement>('[data-region]');
  return (el?.dataset.region as FocusRegion | undefined) ?? null;
}

function focusTarget(el: HTMLElement): HTMLElement | null {
  return el.querySelector<HTMLElement>('[data-region-focus]') ?? el.querySelector<HTMLElement>('[data-region-fallback]') ?? el.querySelector<HTMLElement>(FOCUSABLE);
}

/** 領域にフォーカスを置く。領域が無い（閉じたパネルなど）・フォーカスを置ける要素が無ければ false */
export function focusRegion(region: FocusRegion): boolean {
  const el = regionElement(region);
  const target = el === null ? null : focusTarget(el);
  if (target === null) return false;
  target.focus({ preventScroll: true });
  return document.activeElement === target;
}

/** 編集中なら確定する（確定できなければ領域を離れない） */
function leaveEditing(store: AppStore): boolean {
  return store.getState().editing === null || store.commitEdit(null);
}

/** 次（dir = 1）・前（-1）の領域へ移る（F6 / Shift+F6） */
export function cycleRegion(store: AppStore, dir: 1 | -1): boolean {
  if (!leaveEditing(store)) return false;
  const current = regionOf(document.activeElement) ?? 'main';
  const start = REGION_ORDER.indexOf(current);
  const n = REGION_ORDER.length;
  for (let k = 1; k <= n; k++) {
    if (focusRegion(REGION_ORDER[(((start + dir * k) % n) + n) % n])) return true;
  }
  return false;
}

/** 開いているパネルへ移る。パネルの中にいれば、もう 1 つの開いているパネルへ（Ctrl+Alt+. / Ctrl+Alt+,） */
export function focusOpenPanel(store: AppStore): boolean {
  const panels = store.getState().panels;
  const open = PANEL_REGIONS.filter((r) => (r === 'panelBottom' ? panels.bottom : panels.right) !== null);
  if (open.length === 0) {
    store.showStatus(store.t('ui.focus.noPanel'));
    return false;
  }
  if (!leaveEditing(store)) return false;
  const i = open.indexOf(regionOf(document.activeElement) as FocusRegion);
  return focusRegion(open[(i + 1) % open.length]);
}

// ---- パネルを開いた後のフォーカス ----

const pendingFocus = new WeakMap<AppStore, FocusRegion>();

/** 次に描いたときに、その領域へフォーカスを移す（パネルを開く操作から。描く前は領域の要素が無いため） */
export function requestRegionFocus(store: AppStore, region: FocusRegion): void {
  pendingFocus.set(store, region);
}

/** 領域を描いた後に呼ぶ。フォーカスを移す求めがあれば移す */
export function takeRegionFocus(store: AppStore, region: FocusRegion): void {
  if (pendingFocus.get(store) !== region) return;
  pendingFocus.delete(store);
  focusRegion(region);
}

// ---- 全シートの一覧（Alt+Shift+K） ----

const sheetListOpeners = new WeakMap<AppStore, () => void>();

/** シートタブが、全シートの一覧を開く関数を登録する */
export function registerSheetListOpener(store: AppStore, open: (() => void) | null): void {
  if (open === null) sheetListOpeners.delete(store);
  else sheetListOpeners.set(store, open);
}

export function openSheetList(store: AppStore): boolean {
  const open = sheetListOpeners.get(store);
  open?.();
  return open !== undefined;
}

// ---- キー操作 ----

/** ボタンの並び（メニューバー・ツールバー・シートタブ）の中を ← → と Home / End で動く。動いたら true */
export function moveAmongButtons(
  e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; preventDefault(): void },
  container: HTMLElement | null,
): boolean {
  if (container === null || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  const items = [...container.querySelectorAll<HTMLElement>('button:not([disabled]), [role="button"][tabindex]')];
  if (items.length === 0) return false;
  const i = items.indexOf(document.activeElement as HTMLElement);
  let next: HTMLElement | undefined;
  if (e.key === 'Home') next = items[0];
  else if (e.key === 'End') next = items[items.length - 1];
  else if (e.key === 'ArrowRight') next = items[(i + 1) % items.length];
  else if (e.key === 'ArrowLeft') next = items[(i - 1 + items.length) % items.length];
  if (next === undefined) return false;
  e.preventDefault();
  next.focus();
  return true;
}

/**
 * F6 / Shift+F6 / Ctrl+Alt+. を、どこにフォーカスがあっても（入力欄で編集中でも）受け付ける。
 * ダイアログ・メニュー・小さな画面が開いている間は、それぞれのキー操作に任せる
 */
export function useRegionShortcuts(store: AppStore): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      const state = store.getState();
      if (state.dialogs.length > 0 || state.contextMenu !== null) return;
      const active = document.activeElement;
      if (active instanceof Element && active.closest('.sc-menu') !== null) return;
      const id = resolveShortcut(e, store.platform, 'edit');
      if (id !== 'focusNextRegion' && id !== 'focusPrevRegion' && id !== 'focusPanel') return;
      e.preventDefault();
      e.stopPropagation();
      if (id === 'focusPanel') focusOpenPanel(store);
      else cycleRegion(store, id === 'focusNextRegion' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [store]);
}
