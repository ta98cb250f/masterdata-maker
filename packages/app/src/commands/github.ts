// GitHub 方式の操作（FR-GH-01〜05、P-67）: GitHub のリポジトリのフォルダを開く・ブランチを切り替える。
// 保存はコミットのダイアログ（dialogs/github.tsx）を通す
import type { SavePlan } from '@masterdata-maker/core';
import type { CommitResult, GitHubClient, GitHubLocation, GitHubWorkspace } from '../fs/github';
import { GitHubError, PullRequestError, githubSource, isGitHubSource, openWorkspace } from '../fs/github';
import { saveLastLocation } from '../fs/githubSettings';
import { errorMessage } from '../fs/text';
import type { AppStore } from '../store/AppStore';
import type { CommandDef } from './registry';

export const GITHUB_OPEN_DIALOG = 'github.open';
export const GITHUB_COMMIT_DIALOG = 'github.commit';
export const GITHUB_BRANCH_DIALOG = 'github.branch';

export interface GitHubCommitArgs {
  workspace: GitHubWorkspace;
  plan: SavePlan;
  /** コミットした結果（閉じたら null）。ダイアログを閉じるときに 1 回だけ呼ぶ */
  resolve(result: CommitResult | null): void;
}

/** API の失敗を画面の文言にする */
export function githubErrorText(store: AppStore, e: unknown): string {
  if (e instanceof GitHubError) return store.t(`ui.github.error.${e.kind}`, { message: e.message, status: e.status });
  if (e instanceof PullRequestError) return githubErrorText(store, e.cause);
  return errorMessage(e);
}

/**
 * 保存のときにコミットのダイアログを出す。ダイアログが答えずに消えたとき（プロジェクトを開き直したなど）は、
 * 取り消したことにする（保存が終わらないまま残らないように）
 */
export function commitRunner(store: AppStore) {
  return (workspace: GitHubWorkspace, plan: SavePlan): Promise<CommitResult | null> =>
    new Promise((resolve) => {
      let done = false;
      let key = -1;
      let unsubscribe = () => {};
      const once = (result: CommitResult | null) => {
        if (done) return;
        done = true;
        unsubscribe();
        // 次に開くときの既定を、コミットしたブランチにする（FR-GH-05）
        if (result !== null) saveLastLocation({ repo: workspace.repo, folder: workspace.folder, branch: result.branch });
        resolve(result);
      };
      key = store.openDialog(GITHUB_COMMIT_DIALOG, { workspace, plan, resolve: once } satisfies GitHubCommitArgs);
      unsubscribe = store.subscribe(() => {
        if (!store.getState().dialogs.some((d) => d.key === key)) once(null);
      });
    });
}

/**
 * リポジトリのフォルダを読み込んで開く。読み込めなければ例外（GitHubError）。
 * プロジェクトのフォルダでなければ false（store.open が知らせる）
 */
export async function openGitHubLocation(store: AppStore, client: GitHubClient, location: GitHubLocation): Promise<boolean> {
  const workspace = await openWorkspace(client, location);
  const ok = await store.open(githubSource(workspace, commitRunner(store)));
  if (ok) saveLastLocation(location);
  return ok;
}

/**
 * 今開いている GitHub のプロジェクトを、別のブランチで開き直す。読み込めなければ例外（GitHubError）。
 * 読み込んでいる間はダイアログを開いたままにして、編集や保存を受け付けない（呼び出し側）
 */
export async function switchBranch(store: AppStore, branch: string): Promise<boolean> {
  const source = store.getState().source;
  if (!isGitHubSource(source)) return false;
  const ws = source.github;
  return openGitHubLocation(store, ws.client, { repo: ws.repo, folder: ws.folder, branch });
}

export const githubCommands: CommandDef[] = [
  {
    id: 'file.openGitHub',
    labelKey: 'ui.command.openGitHub',
    menu: { menu: 'file', group: 0, order: 3 },
    run: (store) => store.confirmDiscard(() => void store.openDialog(GITHUB_OPEN_DIALOG)),
  },
  {
    id: 'github.switchBranch',
    labelKey: 'ui.command.switchBranch',
    menu: { menu: 'file', group: 5, order: 0 },
    enabled: (store) => isGitHubSource(store.getState().source) && !store.isSaving,
    run: (store) => void store.openDialog(GITHUB_BRANCH_DIALOG),
  },
];
