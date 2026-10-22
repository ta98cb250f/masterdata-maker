// GitHub 方式のダイアログ（FR-GH-01〜05、P-67）: リポジトリのフォルダを開く・コミットする（新しいブランチ・プルリクエスト）・ブランチを切り替える
import { useEffect, useRef, useState } from 'react';
import type { GitHubCommitArgs } from '../commands/github';
import { GITHUB_BRANCH_DIALOG, GITHUB_COMMIT_DIALOG, GITHUB_OPEN_DIALOG, githubErrorText, openGitHubLocation, switchBranch } from '../commands/github';
import { DialogFrame } from '../components/Dialog';
import type { CommitResult, PullRef, RepoRef } from '../fs/github';
import { GitHubClient, PullRequestError, defaultBranchName, isGitHubSource, isValidBranchName, normalizeRepoPath, parseRepo } from '../fs/github';
import { forgetToken, loadLastLocation, loadToken, saveToken } from '../fs/githubSettings';
import { useT } from '../store/hooks';
import { Check, Field } from './formParts';
import type { DialogProps } from './registry';
import { defineDialog } from './registry';
import '../styles/github.css';

/** fine-grained personal access token を作る画面 */
export const TOKEN_HELP_URL = 'https://github.com/settings/personal-access-tokens/new';

/** プロジェクト設定のファイル（フォルダの一覧で、プロジェクトのフォルダに印を付ける） */
const CONFIG_FILES = ['masterdata-maker.yaml', 'masterdata-maker.yml', 'masterdata-maker.json'];

interface Connected {
  client: GitHubClient;
  repo: RepoRef;
  fullName: string;
  defaultBranch: string;
  branches: string[];
  canPush: boolean | null;
}

interface FolderView {
  /** 表示しているフォルダ（ルートは空文字） */
  path: string;
  dirs: string[];
  isProject: boolean;
}

function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

// ---- リポジトリのフォルダを開く ----

function GitHubOpenDialog({ store, close }: DialogProps<undefined>) {
  const t = useT();
  const [saved] = useState(() => ({ token: loadToken(), last: loadLastLocation() }));
  const [token, setToken] = useState(saved.token?.token ?? '');
  const [remember, setRemember] = useState(saved.token?.remembered ?? false);
  const [repoText, setRepoText] = useState(saved.last?.repo ?? '');
  const [connected, setConnected] = useState<Connected | null>(null);
  const [branch, setBranch] = useState('');
  const [folder, setFolder] = useState('');
  const [view, setView] = useState<FolderView | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heads = useRef(new Map<string, string>());

  const connect = async () => {
    const repo = parseRepo(repoText);
    if (token.trim() === '') return setError(t('ui.github.tokenRequired'));
    if (repo === null) return setError(t('ui.github.repoInvalid'));
    setBusy(true);
    setError(null);
    const client = new GitHubClient(token.trim());
    try {
      const [info, branches] = await Promise.all([client.repository(repo), client.branches(repo)]);
      saveToken(token.trim(), remember);
      heads.current.clear();
      const sameRepo = saved.last !== null && saved.last.repo.toLowerCase() === `${repo.owner}/${repo.repo}`.toLowerCase();
      const lastBranch = sameRepo && saved.last !== null && branches.includes(saved.last.branch) ? saved.last.branch : null;
      setConnected({ client, repo, fullName: info.fullName, defaultBranch: info.defaultBranch, branches, canPush: info.canPush });
      setBranch(lastBranch ?? info.defaultBranch);
      setFolder(sameRepo && saved.last !== null ? saved.last.folder : '');
    } catch (e) {
      setError(githubErrorText(store, e));
    } finally {
      setBusy(false);
    }
  };

  // ブランチ・フォルダを変えたら、フォルダの中のフォルダを表示する（打っている間は少し待つ）
  useEffect(() => {
    if (connected === null || branch === '') return;
    const path = normalizeRepoPath(folder);
    if (path === null) {
      setView(null);
      setViewError(t('ui.github.folderInvalid'));
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      try {
        let tree = heads.current.get(branch);
        if (tree === undefined) {
          tree = (await connected.client.branchHead(connected.repo, branch)).tree;
          heads.current.set(branch, tree);
        }
        const sha = await connected.client.folderTree(connected.repo, tree, path);
        if (!live) return;
        if (sha === null) {
          setView(null);
          setViewError(t('ui.github.folderMissing', { folder: path, branch }));
          return;
        }
        const { entries } = await connected.client.tree(connected.repo, sha, false);
        if (!live) return;
        setView({
          path,
          dirs: entries.filter((e) => e.type === 'tree').map((e) => e.path).sort(),
          isProject: entries.some((e) => e.type === 'blob' && CONFIG_FILES.includes(e.path)),
        });
        setViewError(null);
      } catch (e) {
        if (live) setViewError(githubErrorText(store, e));
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [connected, branch, folder, store, t]);

  const open = async () => {
    if (connected === null) return;
    const path = normalizeRepoPath(folder);
    if (path === null) return setError(t('ui.github.folderInvalid'));
    setBusy(true);
    setError(null);
    try {
      // 開けたらダイアログは openLoaded が閉じる。プロジェクトのフォルダでなければ store.open が開始画面に知らせる
      const ok = await openGitHubLocation(store, connected.client, { repo: connected.repo, folder: path, branch });
      if (!ok) close();
    } catch (e) {
      setError(githubErrorText(store, e));
      setBusy(false);
    }
  };

  const forget = () => {
    forgetToken();
    setToken('');
    setRemember(false);
  };

  return (
    <DialogFrame
      title={t('ui.github.openTitle')}
      onClose={close}
      width={560}
      testId="github-open-dialog"
      footer={
        <>
          <button type="button" className="sc-button" onClick={close}>
            {t('ui.dialog.cancel')}
          </button>
          {connected === null ? (
            <button type="button" className="sc-button primary" onClick={() => void connect()} disabled={busy} data-testid="github-connect">
              {t('ui.github.connect')}
            </button>
          ) : (
            <button type="button" className="sc-button primary" onClick={() => void open()} disabled={busy || branch === ''} data-testid="github-open">
              {t('ui.github.open')}
            </button>
          )}
        </>
      }
    >
      <div className="sc-form">
        {connected === null ? (
          <>
            <p className="sc-form-info">{t('ui.github.lead')}</p>
            <Field label={t('ui.github.token')} htmlFor="github-token" hint={t('ui.github.tokenHint')}>
              <input
                id="github-token"
                className="sc-text"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={token}
                data-autofocus={token === '' ? '' : undefined}
                onChange={(e) => setToken(e.target.value)}
                data-testid="github-token"
              />
              <div className="sc-gh-links">
                <a href={TOKEN_HELP_URL} target="_blank" rel="noreferrer noopener">
                  {t('ui.github.tokenCreate')}
                </a>
                {saved.token !== null && (
                  <button type="button" className="sc-link-button" onClick={forget} data-testid="github-forget-token">
                    {t('ui.github.tokenForget')}
                  </button>
                )}
              </div>
            </Field>
            <Check label={t('ui.github.tokenRemember')} checked={remember} onChange={setRemember} testId="github-remember" />
            <p className="sc-field-hint sc-gh-indent">{t('ui.github.tokenRememberHint')}</p>
            <Field label={t('ui.github.repo')} htmlFor="github-repo" hint={t('ui.github.repoHint')}>
              <input
                id="github-repo"
                className="sc-text"
                value={repoText}
                spellCheck={false}
                data-autofocus={token === '' ? undefined : ''}
                placeholder="owner/repository"
                onChange={(e) => setRepoText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void connect();
                  }
                }}
                data-testid="github-repo"
              />
            </Field>
          </>
        ) : (
          <>
            <p className="sc-form-info" data-testid="github-connected">
              {t('ui.github.connected', { repo: connected.fullName })}{' '}
              <button type="button" className="sc-link-button" onClick={() => setConnected(null)} data-testid="github-change-repo">
                {t('ui.github.changeRepo')}
              </button>
            </p>
            {connected.canPush === false && <p className="sc-field-warning">{t('ui.github.noPush')}</p>}
            <Field label={t('ui.github.branch')} htmlFor="github-branch">
              <select id="github-branch" className="sc-select" value={branch} onChange={(e) => setBranch(e.target.value)} data-testid="github-branch">
                {connected.branches.map((b) => (
                  <option key={b} value={b}>
                    {b === connected.defaultBranch ? t('ui.github.defaultBranchOption', { branch: b }) : b}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('ui.github.folder')} htmlFor="github-folder" hint={t('ui.github.folderHint')}>
              <input
                id="github-folder"
                className="sc-text"
                value={folder}
                spellCheck={false}
                placeholder={t('ui.github.folderRoot')}
                onChange={(e) => setFolder(e.target.value)}
                data-testid="github-folder"
              />
            </Field>
            <div className="sc-gh-browser" data-testid="github-folders">
              {viewError !== null ? (
                <p className="sc-field-error">{viewError}</p>
              ) : view === null ? (
                <p className="sc-field-hint">{t('ui.github.loadingFolders')}</p>
              ) : (
                <>
                  <p className={view.isProject ? 'sc-gh-project' : 'sc-field-hint'} data-testid="github-folder-status">
                    {view.isProject ? t('ui.github.isProject') : t('ui.github.notProject')}
                  </p>
                  <ul className="sc-gh-dirs">
                    {view.path !== '' && (
                      <li>
                        <button type="button" className="sc-link-button" onClick={() => setFolder(parentOf(view.path))} data-testid="github-folder-up">
                          ..
                        </button>
                      </li>
                    )}
                    {view.dirs.map((d) => (
                      <li key={d}>
                        <button
                          type="button"
                          className="sc-link-button"
                          onClick={() => setFolder(view.path === '' ? d : `${view.path}/${d}`)}
                          data-testid="github-folder-item"
                        >
                          {d}/
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </>
        )}
        {busy && <p className="sc-field-hint">{t('ui.github.working')}</p>}
        {error !== null && (
          <div className="sc-field-error" role="alert" data-testid="github-error">
            {error}
          </div>
        )}
      </div>
    </DialogFrame>
  );
}

// ---- コミット（保存） ----

type CommitPhase = { kind: 'form' } | { kind: 'running' } | { kind: 'done'; result: CommitResult; pullError: string | null };

function GitHubCommitDialog({ store, args, close }: DialogProps<GitHubCommitArgs>) {
  const t = useT();
  const ws = args.workspace;
  // 開いたブランチのままなら新しいブランチへ、このセッションで作ったブランチなら続けてそこへコミットするのを既定にする
  const [newBranch, setNewBranch] = useState(ws.branch === ws.openedBranch);
  const [branchName, setBranchName] = useState(() => defaultBranchName());
  const [message, setMessage] = useState(() => t('ui.github.defaultMessage'));
  const [createPull, setCreatePull] = useState(true);
  const [pullTitle, setPullTitle] = useState<string | null>(null);
  const [pullBody, setPullBody] = useState('');
  const [base, setBase] = useState(ws.branch === ws.openedBranch ? ws.branch : ws.openedBranch);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [existingPull, setExistingPull] = useState<PullRef | null | undefined>(undefined);
  const [phase, setPhase] = useState<CommitPhase>({ kind: 'form' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    ws.client.branches(ws.repo).then(
      (list) => live && setBranches(list),
      () => live && setBranches([]),
    );
    if (ws.branch !== ws.defaultBranch) {
      ws.client.openPull(ws.repo, ws.branch).then(
        (pull) => live && setExistingPull(pull),
        () => live && setExistingPull(null),
      );
    } else setExistingPull(null);
    return () => {
      live = false;
    };
  }, [ws]);

  const target = newBranch ? branchName.trim() : ws.branch;
  const pullTarget = newBranch || existingPull === null;
  const branchError = !newBranch
    ? null
    : !isValidBranchName(target)
      ? t('ui.github.branchInvalid')
      : branches?.includes(target) === true
        ? t('ui.github.branchExists', { branch: target })
        : null;
  const baseError = createPull && pullTarget && base === target ? t('ui.github.baseSame') : null;
  const canSubmit = phase.kind === 'form' && branchError === null && baseError === null && message.trim() !== '';

  const cancel = () => {
    if (phase.kind === 'running') return;
    close();
    args.resolve(phase.kind === 'done' ? phase.result : null);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setPhase({ kind: 'running' });
    setError(null);
    const title = (pullTitle ?? message).trim() || message.trim();
    try {
      const result = await ws.commit(args.plan, {
        message: message.trim(),
        branch: target,
        newBranch,
        pull: createPull && pullTarget ? { title, body: pullBody, base } : undefined,
      });
      setPhase({ kind: 'done', result, pullError: null });
    } catch (e) {
      if (e instanceof PullRequestError) setPhase({ kind: 'done', result: e.result, pullError: githubErrorText(store, e.cause) });
      else {
        setPhase({ kind: 'form' });
        setError(githubErrorText(store, e));
      }
    }
  };

  const files = [
    ...args.plan.files.map((f) => ({ path: ws.repoPath(f.path), removed: false })),
    ...args.plan.remove.map((p) => ({ path: ws.repoPath(p), removed: true })),
  ];

  if (phase.kind === 'done') {
    const { result, pullError } = phase;
    return (
      <DialogFrame
        title={t('ui.github.doneTitle')}
        onClose={cancel}
        width={520}
        testId="github-commit-dialog"
        footer={
          <button type="button" className="sc-button primary" onClick={cancel} data-testid="github-commit-close">
            {t('ui.dialog.ok')}
          </button>
        }
      >
        <div className="sc-form" data-testid="github-commit-done">
          <p>
            {t('ui.github.doneCommit', { branch: result.branch })}{' '}
            <a href={result.commitUrl} target="_blank" rel="noreferrer noopener">
              {result.commit.slice(0, 7)}
            </a>
          </p>
          {result.pull !== null && (
            <p>
              {t(result.pullExisted ? 'ui.github.donePullExisting' : 'ui.github.donePull', { number: result.pull.number })}{' '}
              <a href={result.pull.url} target="_blank" rel="noreferrer noopener" data-testid="github-pull-link">
                {result.pull.url}
              </a>
            </p>
          )}
          {pullError !== null && (
            <p className="sc-field-error" role="alert" data-testid="github-pull-error">
              {t('ui.github.pullFailed', { message: pullError })}
            </p>
          )}
        </div>
      </DialogFrame>
    );
  }

  const running = phase.kind === 'running';
  return (
    <DialogFrame
      title={t('ui.github.commitTitle')}
      onClose={cancel}
      width={580}
      testId="github-commit-dialog"
      footer={
        <>
          <button type="button" className="sc-button" onClick={cancel} disabled={running}>
            {t('ui.dialog.cancel')}
          </button>
          <button type="button" className="sc-button primary" onClick={() => void submit()} disabled={!canSubmit} data-testid="github-commit-ok">
            {t(createPull && pullTarget ? 'ui.github.commitAndPull' : 'ui.github.commit')}
          </button>
        </>
      }
    >
      <div className="sc-form">
        <p className="sc-form-info">{t('ui.github.commitLead', { repo: `${ws.repo.owner}/${ws.repo.repo}`, branch: ws.branch })}</p>
        <ul className="sc-form-list sc-gh-files" data-testid="github-commit-files">
          {files.map((f) => (
            <li key={f.path}>
              {f.removed ? t('ui.github.fileRemoved', { path: f.path }) : f.path}
            </li>
          ))}
        </ul>
        <label className="sc-check">
          <input type="radio" name="github-target" checked={newBranch} onChange={() => setNewBranch(true)} disabled={running} data-testid="github-target-new" />
          <span>{t('ui.github.targetNew')}</span>
        </label>
        {newBranch && (
          <div className="sc-gh-indent">
            <input
              className={`sc-text${branchError !== null ? ' invalid' : ''}`}
              value={branchName}
              spellCheck={false}
              aria-label={t('ui.github.branchName')}
              onChange={(e) => setBranchName(e.target.value)}
              disabled={running}
              data-testid="github-branch-name"
            />
            {branchError !== null && <div className="sc-field-error">{branchError}</div>}
          </div>
        )}
        <label className="sc-check">
          <input type="radio" name="github-target" checked={!newBranch} onChange={() => setNewBranch(false)} disabled={running} data-testid="github-target-current" />
          <span>{t('ui.github.targetCurrent', { branch: ws.branch })}</span>
        </label>
        <Field label={t('ui.github.message')} htmlFor="github-message">
          <textarea
            id="github-message"
            className="sc-textarea"
            rows={2}
            value={message}
            data-autofocus=""
            onChange={(e) => setMessage(e.target.value)}
            disabled={running}
            data-testid="github-message"
          />
        </Field>
        {!pullTarget && existingPull !== undefined && existingPull !== null ? (
          <p className="sc-form-info" data-testid="github-existing-pull">
            {t('ui.github.existingPull', { number: existingPull.number })}{' '}
            <a href={existingPull.url} target="_blank" rel="noreferrer noopener">
              {existingPull.url}
            </a>
          </p>
        ) : (
          <>
            <Check label={t('ui.github.createPull')} checked={createPull} onChange={setCreatePull} disabled={running} testId="github-create-pull" />
            {createPull && (
              <div className="sc-gh-indent">
                <Field label={t('ui.github.pullBase')} htmlFor="github-base" error={baseError ?? undefined}>
                  <select id="github-base" className="sc-select" value={base} onChange={(e) => setBase(e.target.value)} disabled={running} data-testid="github-base">
                    {(branches ?? [base]).map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('ui.github.pullTitle')} htmlFor="github-pull-title">
                  <input
                    id="github-pull-title"
                    className="sc-text"
                    value={pullTitle ?? message}
                    onChange={(e) => setPullTitle(e.target.value)}
                    disabled={running}
                    data-testid="github-pull-title"
                  />
                </Field>
                <Field label={t('ui.github.pullBody')} htmlFor="github-pull-body">
                  <textarea
                    id="github-pull-body"
                    className="sc-textarea"
                    rows={3}
                    value={pullBody}
                    onChange={(e) => setPullBody(e.target.value)}
                    disabled={running}
                    data-testid="github-pull-body"
                  />
                </Field>
              </div>
            )}
          </>
        )}
        {running && <p className="sc-field-hint">{t('ui.github.committing')}</p>}
        {error !== null && (
          <div className="sc-field-error" role="alert" data-testid="github-error">
            {error}
          </div>
        )}
      </div>
    </DialogFrame>
  );
}

// ---- ブランチを切り替える ----

function GitHubBranchDialog({ store, close }: DialogProps<undefined>) {
  const t = useT();
  const source = store.getState().source;
  const ws = isGitHubSource(source) ? source.github : null;
  const [branches, setBranches] = useState<string[] | null>(null);
  const [branch, setBranch] = useState(ws?.branch ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ws === null) return;
    let live = true;
    ws.client.branches(ws.repo).then(
      (list) => live && setBranches(list),
      (e: unknown) => live && setError(githubErrorText(store, e)),
    );
    return () => {
      live = false;
    };
  }, [ws, store]);

  if (ws === null) return null;
  const submit = () => {
    close();
    if (branch === ws.branch) return;
    store.confirmDiscard(() => switchBranch(store, branch));
  };

  return (
    <DialogFrame
      title={t('ui.github.branchTitle')}
      onClose={close}
      width={440}
      testId="github-branch-dialog"
      footer={
        <>
          <button type="button" className="sc-button" onClick={close}>
            {t('ui.dialog.cancel')}
          </button>
          <button type="button" className="sc-button primary" onClick={submit} disabled={branches === null || branch === ''} data-testid="github-branch-ok">
            {t('ui.github.switch')}
          </button>
        </>
      }
    >
      <div className="sc-form">
        <p className="sc-form-info">{t('ui.github.branchLead', { repo: ws.name, branch: ws.branch })}</p>
        {branches === null && error === null ? (
          <p className="sc-field-hint">{t('ui.github.working')}</p>
        ) : (
          <Field label={t('ui.github.branch')} htmlFor="github-switch-branch">
            <select id="github-switch-branch" className="sc-select" value={branch} onChange={(e) => setBranch(e.target.value)} data-testid="github-switch-branch">
              {(branches ?? []).map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>
        )}
        {error !== null && (
          <div className="sc-field-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </DialogFrame>
  );
}

export const githubDialogs = [
  defineDialog<undefined>(GITHUB_OPEN_DIALOG, GitHubOpenDialog),
  defineDialog<GitHubCommitArgs>(GITHUB_COMMIT_DIALOG, GitHubCommitDialog),
  defineDialog<undefined>(GITHUB_BRANCH_DIALOG, GitHubBranchDialog),
];

