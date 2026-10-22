// GitHub 方式（FR-GH-01〜05）。api.github.com への要求を page.route で偽の GitHub（src/fs/githubFake.ts）に回して試す
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { FakeGitHub } from '../src/fs/githubFake';
import { clickCell, colIndex } from './helpers';

const SAMPLE_DIR = join(import.meta.dirname, '../../../samples/basic-yaml');

async function sampleFiles(dir = SAMPLE_DIR, prefix = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(out, await sampleFiles(join(dir, entry.name), path));
    else out[path] = await readFile(join(dir, entry.name), 'utf8');
  }
  return out;
}

async function fakeGitHub(page: Page): Promise<FakeGitHub> {
  const files: Record<string, string> = { 'README.md': '# game\n' };
  for (const [path, text] of Object.entries(await sampleFiles())) files[`data/master/${path}`] = text;
  const gh = new FakeGitHub('acme', 'game', files);
  gh.branches.set('develop', gh.branches.get('main') as string);
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    // ブラウザからの直接の呼び出し（CORS）。プリフライトには許可を返す
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const r = gh.handle(req.method(), req.url(), await req.allHeaders(), req.postData());
    await route.fulfill({
      status: r.status,
      headers: { ...cors, 'Content-Type': r.raw === true ? 'application/octet-stream' : 'application/json' },
      body: r.raw === true ? (r.body as string) : JSON.stringify(r.body),
    });
  });
  return gh;
}

async function openFromGitHub(page: Page, options: { remember?: boolean } = {}): Promise<void> {
  await page.getByTestId('open-github').click();
  await page.getByTestId('github-token').fill('test-token');
  if (options.remember === true) await page.getByTestId('github-remember').check();
  await page.getByTestId('github-repo').fill('https://github.com/acme/game');
  await page.getByTestId('github-connect').click();
  await expect(page.getByTestId('github-connected')).toContainText('acme/game');
  await expect(page.getByTestId('github-branch')).toHaveValue('main');
  // フォルダの一覧から選ぶ
  await page.getByTestId('github-folder-item').filter({ hasText: 'data/' }).click();
  await page.getByTestId('github-folder-item').filter({ hasText: 'master/' }).click();
  await expect(page.getByTestId('github-folder')).toHaveValue('data/master');
  await expect(page.getByTestId('github-folder-status')).toHaveText('このフォルダはプロジェクトのフォルダです');
  await page.getByTestId('github-open').click();
  await expect(page.getByTestId('grid')).toBeVisible();
}

async function editHp(page: Page, value: string): Promise<void> {
  const hp = await colIndex(page, 'hp');
  await clickCell(page, 1, hp);
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
}

test.describe('GitHub 方式', () => {
  test('リポジトリのフォルダを開き、新しいブランチにコミットしてプルリクエストを作る', async ({ page }) => {
    const gh = await fakeGitHub(page);
    await page.goto('/');
    await openFromGitHub(page);
    await expect(page.getByTestId('project-name')).toHaveText('acme/game/data/master');
    await expect(page.getByTestId('branch-badge')).toHaveText('ブランチ: main');
    // ダウンロード保存方式の印は出さない
    await expect(page.getByTestId('mode-badge')).toHaveCount(0);

    const before = gh.branchFiles('main');
    await editHp(page, '4321');
    await page.keyboard.press('Control+s');
    const dialog = page.getByTestId('github-commit-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('github-commit-files')).toHaveText('data/master/tables/character.yaml');
    await expect(page.getByTestId('github-target-new')).toBeChecked();
    await page.getByTestId('github-branch-name').fill('masterdata/e2e');
    await page.getByTestId('github-message').fill('hp を調整');
    await expect(page.getByTestId('github-pull-title')).toHaveValue('hp を調整');
    await expect(page.getByTestId('github-base')).toHaveValue('main');
    await page.getByTestId('github-commit-ok').click();
    await expect(page.getByTestId('github-commit-done')).toBeVisible();
    await expect(page.getByTestId('github-pull-link')).toHaveText('https://github.com/acme/game/pull/1');
    await page.getByTestId('github-commit-close').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('project-modified')).toHaveCount(0);
    await expect(page.getByTestId('branch-badge')).toHaveText('ブランチ: masterdata/e2e');

    // main は変わらず、新しいブランチの 1 ファイルだけが変わる
    expect(gh.branchFiles('main')).toEqual(before);
    const after = gh.branchFiles('masterdata/e2e');
    expect(Object.keys(after).filter((k) => after[k] !== before[k])).toEqual(['data/master/tables/character.yaml']);
    expect(after['data/master/tables/character.yaml']).toContain('4321');
    expect(gh.pulls).toEqual([{ number: 1, head: 'masterdata/e2e', base: 'main', title: 'hp を調整', body: '' }]);

    // 続けて保存すると、既定は今のブランチへのコミットで、開いているプルリクエストを示す
    await editHp(page, '4322');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('github-target-current')).toBeChecked();
    await expect(page.getByTestId('github-existing-pull')).toContainText('#1');
    await page.getByTestId('github-commit-ok').click();
    await page.getByTestId('github-commit-close').click();
    expect(gh.branchFiles('masterdata/e2e')['data/master/tables/character.yaml']).toContain('4322');
    expect(gh.pulls).toHaveLength(1);
  });

  test('コミットのダイアログを閉じたら保存しない（未保存のまま）', async ({ page }) => {
    const gh = await fakeGitHub(page);
    await page.goto('/');
    await openFromGitHub(page);
    await editHp(page, '777');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('github-commit-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('github-commit-dialog')).toHaveCount(0);
    await expect(page.getByTestId('project-modified')).toBeVisible();
    expect(gh.branches.size).toBe(2);
  });

  test('他でブランチが進んでいたら、今のブランチへのコミットは失敗を示し、新しいブランチでやり直せる', async ({ page }) => {
    const gh = await fakeGitHub(page);
    await page.goto('/');
    await openFromGitHub(page);
    await editHp(page, '555');
    gh.pushExternal('main', { 'other.txt': 'x' });
    const external = gh.branches.get('main');
    await page.keyboard.press('Control+s');
    await page.getByTestId('github-target-current').check();
    await page.getByTestId('github-create-pull').uncheck();
    await page.getByTestId('github-commit-ok').click();
    await expect(page.getByTestId('github-error')).toContainText('他でブランチが更新された');
    expect(gh.branches.get('main')).toBe(external);
    await page.getByTestId('github-target-new').check();
    await page.getByTestId('github-branch-name').fill('retry');
    await page.getByTestId('github-commit-ok').click();
    await page.getByTestId('github-commit-close').click();
    await expect(page.getByTestId('project-modified')).toHaveCount(0);
    expect(gh.branchFiles('retry')['data/master/tables/character.yaml']).toContain('555');
  });

  test('ブランチを切り替えると、そのブランチの内容で開き直す。前回の場所とトークンを覚える', async ({ page }) => {
    const gh = await fakeGitHub(page);
    gh.pushExternal('develop', {
      'data/master/tables/character.yaml': gh.branchFiles('main')['data/master/tables/character.yaml'].replace(/hp: \d+/, 'hp: 9999'),
    });
    await page.goto('/');
    await openFromGitHub(page, { remember: true });
    await page.getByTestId('branch-badge').click();
    await page.getByTestId('github-switch-branch').selectOption('develop');
    await page.getByTestId('github-branch-ok').click();
    await expect(page.getByTestId('branch-badge')).toHaveText('ブランチ: develop');
    await expect(page.locator('.sc-cell', { hasText: '9999' }).first()).toBeVisible();

    // 開き直すと、トークン・リポジトリ・ブランチ・フォルダが入っている
    await page.reload();
    await page.getByTestId('open-github').click();
    await expect(page.getByTestId('github-token')).toHaveValue('test-token');
    await expect(page.getByTestId('github-repo')).toHaveValue('acme/game');
    await page.getByTestId('github-connect').click();
    await expect(page.getByTestId('github-branch')).toHaveValue('develop');
    await expect(page.getByTestId('github-folder')).toHaveValue('data/master');
    await page.getByTestId('github-change-repo').click();
    await page.getByTestId('github-forget-token').click();
    await expect(page.getByTestId('github-token')).toHaveValue('');
    expect(await page.evaluate(() => localStorage.getItem('masterdata-maker.github.token'))).toBeNull();
  });

  test('トークンが正しくなければ、接続できない理由を示す', async ({ page }) => {
    await fakeGitHub(page);
    await page.goto('/');
    await page.getByTestId('open-github').click();
    await page.getByTestId('github-token').fill('wrong');
    await page.getByTestId('github-repo').fill('acme/game');
    await page.getByTestId('github-connect').click();
    await expect(page.getByTestId('github-error')).toContainText('トークンが正しくないか');
  });
});
