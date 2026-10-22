// 入口。文言を登録し、store を作って画面を描く。`?sample=basic` / `?sample=large` でサンプルを開く（P-45、NFR-10 の確認用）
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { allCommands } from './commands';
import { loadLastFolderName, openSample } from './commands/file';
import { generateLargeProjectFiles } from './fs/largeSample';
import { isSampleName } from './fs/sample';
import { registerUiMessages } from './i18n';
import { PANELS } from './panels';
import { AppStore } from './store/AppStore';
import { installBackup } from './store/backup';
import { installExternalChanges } from './store/externalChanges';
import { StoreContext } from './store/hooks';
import { installLocale, loadSavedLocale } from './store/locale';
import { createValidatorFactory } from './store/workerValidator';
import './styles.css';

registerUiMessages();

const store = new AppStore({
  commands: allCommands(),
  panelPositions: new Map(PANELS.map((p) => [p.id, p.position])),
  // 検査は Web Worker で行う（FR-VAL-10）。メインスレッドを止めないので、編集から検査までの待ち時間を短くする（FR-VAL-09）
  validator: createValidatorFactory(),
  validationDelay: 20,
  // 選んだ言語はブラウザに覚えている（FR-ETC-02）
  locale: loadSavedLocale(),
});
installLocale(store);
// 外部での変更の検知（FR-FIO-07）と、未保存の変更の退避と復元（FR-FIO-06）
installExternalChanges(store);
installBackup(store);

// 開発・画面テスト用に、外から store を触れるようにする。性能の確認用のプロジェクトの生成（NFR-11）も呼べるようにする
(globalThis as { masterdataMaker?: AppStore }).masterdataMaker = store;
(globalThis as { masterdataMakerSamples?: unknown }).masterdataMakerSamples = { generateLargeProjectFiles };

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
