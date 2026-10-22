// タイトル: プロジェクトのフォルダ名と未保存の印。ダウンロード保存方式では、使えない機能を示す（NFR-05）。
// GitHub 方式では今のブランチを示し、押すとブランチを切り替える（FR-GH-02）
import { useEffect } from 'react';
import { isGitHubSource } from '../fs/github';
import { useAppState, useStore, useT } from '../store/hooks';
import '../styles/github.css';

export function TitleBar() {
  const store = useStore();
  const t = useT();
  useAppState((s) => s.revision);
  const source = useAppState((s) => s.source);
  const running = useAppState((s) => s.validation.running);
  const modified = store.isProjectModified();
  const name = source?.name ?? null;

  useEffect(() => {
    document.title = name === null ? t('ui.app.name') : `${modified ? '● ' : ''}${name} - ${t('ui.app.name')}`;
  }, [name, modified, t]);

  const showLimits = () =>
    store.openDialog('message', {
      titleKey: 'ui.mode.downloadTitle',
      messageKey: 'ui.mode.downloadMessage',
      items: [t('ui.mode.noRememberFolder'), t('ui.mode.noExternalChanges'), t('ui.mode.noDirectSave')],
    });

  return (
    <header className="sc-titlebar" data-region="title">
      <div className="sc-logo" aria-hidden="true">
        <span />
      </div>
      <div className="sc-title">
        <span className="sc-title-name" data-testid="project-name">
          {name ?? t('ui.app.name')}
        </span>
        {modified && (
          <span className="sc-title-modified" title={t('ui.title.modified')} data-testid="project-modified">
            {t('ui.title.modifiedShort')}
          </span>
        )}
        {running && <span className="sc-title-checking">{t('ui.title.validating')}</span>}
      </div>
      {isGitHubSource(source) ? (
        <button
          type="button"
          className="sc-branch-badge"
          title={t('ui.github.branchBadgeTitle', { branch: source.github.branch })}
          onClick={() => void store.run('github.switchBranch')}
          data-testid="branch-badge"
        >
          {t('ui.github.branchBadge', { branch: source.github.branch })}
        </button>
      ) : source !== null && !source.capabilities.directSave && (
        <button type="button" className="sc-mode-badge" onClick={showLimits} data-testid="mode-badge">
          {t(source.kind === 'sample' ? 'ui.mode.sample' : 'ui.mode.download')}
        </button>
      )}
    </header>
  );
}
