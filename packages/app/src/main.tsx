// 入口。文言を登録し、store を作って画面を描く。`?sample=basic` / `?sample=large` でサンプルを開く（P-45、NFR-10 の確認用）
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { allCommands } from './commands';
import { loadLastFolderName, openSample } from './commands/file';
import { isSampleName } from './fs/sample';
import { registerUiMessages } from './i18n';
import { PANELS } from './panels';
import { AppStore } from './store/AppStore';
import { StoreContext } from './store/hooks';
import './styles.css';

registerUiMessages();

const store = new AppStore({
  commands: allCommands(),
  panelPositions: new Map(PANELS.map((p) => [p.id, p.position])),
});

// 開発・画面テスト用に、外から store を触れるようにする
(globalThis as { sheetcraft?: AppStore }).sheetcraft = store;

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <StoreContext value={store}>
      <App />
    </StoreContext>
  </StrictMode>,
);

void loadLastFolderName(store);
const sample = new URLSearchParams(location.search).get('sample');
if (isSampleName(sample)) void openSample(store, sample);
