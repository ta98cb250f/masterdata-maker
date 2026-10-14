// 画面の構成（FR-UI-01〜05）: タイトル・メニューバー・ツールバー・数式バー・グリッド（と右・下のパネル）・シートタブ
import { resolveShortcut } from '@sheetcraft/core';
import { useEffect } from 'react';
import { BrokenTableView } from './components/BrokenTableView';
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
  if (entry === undefined) return <div className="sc-grid-area" />;
  return (
    <div className="sc-grid-area">{entry.kind === 'broken' ? <BrokenTableView key={entry.uid} table={entry} /> : <Grid key={entry.uid} tableUid={entry.uid} />}</div>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

export function App() {
  const store = useStore();
  const phase = useAppState((s) => s.phase);
  const hasProject = useAppState((s) => s.project !== null);

  useEffect(() => {
    // Ctrl+S はどこにフォーカスがあっても保存する。入力欄の外（ボタンの上など）のキー操作はグリッドに渡す
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || store.getState().dialogs.length > 0) return;
      const id = resolveShortcut(e, store.platform, isEditableTarget(e.target) ? 'edit' : 'grid');
      if (id === 'save') {
        e.preventDefault();
        void store.run('file.save');
        return;
      }
      if (isEditableTarget(e.target) || id === null) return;
      const def = store.commands.byShortcut(id);
      if (def === undefined || def.native !== undefined || !store.isEnabled(def.id)) return;
      e.preventDefault();
      store.focusGrid();
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
