// 開いていないときの画面: フォルダを開く・前回のフォルダを開く（FR-FIO-01）・GitHub のリポジトリを開く（FR-GH-01）・サンプルを開く（P-45）。
// 直接保存方式が使えないブラウザでは、使えない機能を示す（NFR-05）
import { supportsDirectAccess } from '../fs/direct';
import { useAppState, useStore, useT } from '../store/hooks';

export function StartScreen() {
  const store = useStore();
  const t = useT();
  const phase = useAppState((s) => s.phase);
  const lastFolder = useAppState((s) => s.lastFolder);
  const errors = useAppState((s) => s.loadError);
  const direct = supportsDirectAccess();
  const loading = phase === 'loading';
  return (
    <div className="sc-start" data-testid="start-screen" data-region="main">
      <div className="sc-start-card">
        <h1>{t('ui.app.name')}</h1>
        <p className="sc-start-lead">{t('ui.start.lead')}</p>
        <div className="sc-start-actions">
          <button type="button" className="sc-button primary" disabled={loading} onClick={() => void store.run('file.open')} data-testid="open-folder">
            {t('ui.command.openFolder')}
          </button>
          {direct && lastFolder !== null && (
            <button type="button" className="sc-button" disabled={loading} onClick={() => void store.run('file.openLast')} data-testid="open-last">
              {t('ui.command.openLastFolderNamed', { name: lastFolder })}
            </button>
          )}
          <button type="button" className="sc-button" disabled={loading} onClick={() => void store.run('file.openGitHub')} data-testid="open-github">
            {t('ui.command.openGitHub')}
          </button>
          <button type="button" className="sc-button" disabled={loading} onClick={() => void store.run('file.openSample')} data-testid="open-sample">
            {t('ui.command.openSample')}
          </button>
        </div>
        {loading && <p className="sc-start-loading">{t('ui.start.loading')}</p>}
        {errors !== null && errors.length > 0 && (
          <div className="sc-start-errors" role="alert" data-testid="load-errors">
            <p>{t('ui.open.failedTitle')}</p>
            <ul>
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="sc-start-mode">
          {direct ? (
            <p>{t('ui.start.directMode')}</p>
          ) : (
            <>
              <p>{t('ui.mode.downloadMessage')}</p>
              <ul>
                <li>{t('ui.mode.noRememberFolder')}</li>
                <li>{t('ui.mode.noExternalChanges')}</li>
                <li>{t('ui.mode.noDirectSave')}</li>
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
