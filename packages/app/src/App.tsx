// 画面の構成（FR-UI-01〜05）: タイトル・メニューバー・ツールバー・数式バー・グリッド（と右・下のパネル）・シートタブ
import type { ShortcutId } from '@masterdata-maker/core';
import { resolveShortcut } from '@masterdata-maker/core';
import { useEffect } from 'react';
import { BrokenTableView } from './components/BrokenTableView';
import { FindBar } from './components/FindBar';
import { useRegionShortcuts } from './components/focusRegions';
import { FormulaBar } from './components/FormulaBar';
import { ContextMenuHost, DialogHost, PanelHost } from './components/Hosts';
import { MenuBar } from './components/MenuBar';
import { SheetTabs } from './components/SheetTabs';
import { StartScreen } from './components/StartScreen';
import { TitleBar } from './components/TitleBar';
import { Toolbar } from './components/Toolbar';
import { Grid } from './grid/Grid';
import { useAppState, useStore } from './store/hooks';

function MainArea() {
  const store = useStore();
  useAppState((s) => s.revision);
  const active = useAppState((s) => s.activeTable);
  const entry = active === null ? undefined : store.entry(active);
  if (entry === undefined) return <div className="sc-grid-area" data-region="main" />;
  return (
    <div className="sc-grid-area" data-region="main">
      {entry.kind === 'broken' ? <BrokenTableView key={entry.uid} table={entry} /> : <Grid key={entry.uid} tableUid={entry.uid} />}
      <FindBar />
    </div>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/**
 * ボタン・一覧など（グリッドの外）にフォーカスがあるときも効く操作。ほかのキー（矢印・Tab・Enter・Space など）は
 * フォーカスのある部品に任せる（NFR-40。グリッドへ回すと、パネルやシートタブをキーで操作できない）
 */
const GLOBAL_SHORTCUTS: ReadonlySet<ShortcutId> = new Set<ShortcutId>(['undo', 'redo', 'find', 'findReplace', 'showShortcuts', 'nextSheet', 'prevSheet', 'showSheetList']);

export function App() {
  const store = useStore();
  const phase = useAppState((s) => s.phase);
  const hasProject = useAppState((s) => s.project !== null);

  useRegionShortcuts(store);

  useEffect(() => {
    // Ctrl+S はどこにフォーカスがあっても保存する。どこにもフォーカスが無いとき（ページの地の上など）のキー操作はグリッドに渡す。
    // ボタン・一覧などの上では、どこでも効く操作（GLOBAL_SHORTCUTS）だけを行い、Esc でグリッドへ戻る
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || store.getState().dialogs.length > 0) return;
      const id = resolveShortcut(e, store.platform, isEditableTarget(e.target) ? 'edit' : 'grid');
      if (id === 'save') {
        e.preventDefault();
        void store.run('file.save');
        return;
      }
      if (isEditableTarget(e.target)) return;
      const onControl = e.target instanceof HTMLElement && e.target !== document.body && e.target !== document.documentElement;
      if (onControl && (id === null || !GLOBAL_SHORTCUTS.has(id))) {
        if (id === 'cancel') {
          e.preventDefault();
          store.focusGrid();
        }
        return;
      }
      if (id === null) return;
      const def = store.commands.byShortcut(id);
      if (def === undefined || def.native !== undefined || !store.isEnabled(def.id)) return;
      e.preventDefault();
      if (!onControl) store.focusGrid();
      void store.run(def.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  useEffect(() => {
    // 未保存のままページを閉じる・再読み込みするときは確かめる（FR-FIO-05）
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!store.isProjectModified()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [store]);

  return (
    <div className="sc-app">
      <TitleBar />
      <MenuBar />
      <Toolbar />
      {hasProject && phase !== 'start' ? (
        <>
          <FormulaBar />
          <div className="sc-main">
            <div className="sc-main-column">
              <MainArea />
              <PanelHost position="bottom" />
            </div>
            <PanelHost position="right" />
          </div>
          <SheetTabs />
        </>
      ) : (
        <StartScreen />
      )}
      <ContextMenuHost />
      <DialogHost />
    </div>
  );
}
