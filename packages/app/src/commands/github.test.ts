import { describe, expect, it } from 'vitest';
import type { GitHubWorkspace } from '../fs/github';
import { openTestStore } from '../store/testProject';
import { GITHUB_COMMIT_DIALOG, commitRunner } from './github';

describe('コミットのダイアログ（FR-GH-03）', () => {
  it('ダイアログが答えずに消えたら（プロジェクトを開き直したなど）、取り消したことにする', async () => {
    const { store } = await openTestStore();
    const ws = { repo: { owner: 'acme', repo: 'game' }, folder: '' } as unknown as GitHubWorkspace;
    const pending = commitRunner(store)(ws, { files: [], remove: [] });
    const dialog = store.getState().dialogs.find((d) => d.id === GITHUB_COMMIT_DIALOG);
    expect(dialog).toBeDefined();
    store.setState({ dialogs: [] });
    await expect(pending).resolves.toBeNull();
  });
});
