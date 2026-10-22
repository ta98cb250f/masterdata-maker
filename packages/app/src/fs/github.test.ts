import { describe, expect, it } from 'vitest';
import { EditSession, enterInput, loadProject } from '@masterdata-maker/core';
import type { SavePlan } from '@masterdata-maker/core';
import {
  GitHubClient,
  GitHubError,
  PullRequestError,
  defaultBranchName,
  githubSource,
  isValidBranchName,
  normalizeRepoPath,
  openWorkspace,
  parseRepo,
} from './github';
import { FakeGitHub } from './githubFake';
import { loadLastLocation, loadToken, saveLastLocation, saveToken, forgetToken } from './githubSettings';
import type { StorageLike } from './githubSettings';
import { basicSampleFiles } from './sample';

function repoFiles(): Record<string, string> {
  const files: Record<string, string> = { 'README.md': '# game\n' };
  for (const [path, text] of Object.entries(basicSampleFiles())) files[`data/master/${path}`] = text;
  return files;
}

function setup() {
  const gh = new FakeGitHub('acme', 'game', repoFiles());
  const client = new GitHubClient('test-token', gh.fetch);
  const location = { repo: { owner: 'acme', repo: 'game' }, folder: 'data/master', branch: 'main' };
  return { gh, client, location };
}

let editCount = 0;

/** 開いたプロジェクトの character の 1 行目の hp を書き換えて、保存の計画を作る */
async function editOneCell(fs: Parameters<typeof loadProject>[0]): Promise<{ plan: SavePlan; path: string }> {
  const loaded = await loadProject(fs);
  if (loaded.status !== 'ok') throw new Error(loaded.status);
  const session = new EditSession(loaded.project);
  const character = loaded.project.tables.find((t) => t.name === 'character');
  if (character === undefined || character.kind !== 'table') throw new Error('no table');
  const record = character.records[0];
  const hp = String(2000 + (editCount++ % 1000));
  const r = session.run(enterInput(loaded.project, { table: character.uid, cells: [{ record: record.uid, column: 'hp' }], text: hp }));
  if (!r.ok) throw new Error('edit failed');
  const plan = session.planSave();
  return { plan, path: plan.files[0].path };
}

describe('入力の解釈', () => {
  it('リポジトリは owner/repo と GitHub の URL を受け付ける', () => {
    expect(parseRepo('acme/game')).toEqual({ owner: 'acme', repo: 'game' });
    expect(parseRepo(' https://github.com/acme/game.git ')).toEqual({ owner: 'acme', repo: 'game' });
    expect(parseRepo('https://github.com/acme/game/tree/main/data')).toEqual({ owner: 'acme', repo: 'game' });
    expect(parseRepo('git@github.com:acme/game.git')).toEqual({ owner: 'acme', repo: 'game' });
    expect(parseRepo('acme')).toBeNull();
    expect(parseRepo('acme/game/extra')).toBeNull();
    expect(parseRepo('ac me/game')).toBeNull();
  });

  it('フォルダのパスを整え、.. は受け付けない', () => {
    expect(normalizeRepoPath('/data/master/')).toBe('data/master');
    expect(normalizeRepoPath('./data//master')).toBe('data/master');
    expect(normalizeRepoPath('')).toBe('');
    expect(normalizeRepoPath('data/../secret')).toBeNull();
  });

  it('ブランチ名の規則（git check-ref-format の主なもの）', () => {
    expect(isValidBranchName('masterdata/20261022-1200')).toBe(true);
    expect(isValidBranchName('feature/ガチャ調整')).toBe(true);
    for (const bad of ['', 'a b', 'a..b', 'a/', '/a', 'a.lock', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[', 'a\\b', '.a', 'a/.b', '-a', '@', 'a@{b']) {
      expect(isValidBranchName(bad), bad).toBe(false);
    }
    expect(isValidBranchName(defaultBranchName(new Date(2026, 9, 22, 9, 5)))).toBe(true);
    expect(defaultBranchName(new Date(2026, 9, 22, 9, 5))).toBe('masterdata/20261022-0905');
  });
});

describe('GitHub 方式の読み込み', () => {
  it('フォルダの中だけを ProjectFs にして、プロジェクトとして読み込める', async () => {
    const { client, location } = setup();
    const ws = await openWorkspace(client, location);
    expect(ws.name).toBe('acme/game/data/master');
    expect(await ws.fs.read('README.md')).toBeNull();
    const loaded = await loadProject(ws.fs);
    expect(loaded.status).toBe('ok');
    if (loaded.status === 'ok') expect(loaded.project.tables.length).toBeGreaterThan(0);
  });

  it('フォルダが無ければ notFound、トークンが違えば unauthorized', async () => {
    const { gh, client, location } = setup();
    await expect(openWorkspace(client, { ...location, folder: 'nothing' })).rejects.toMatchObject({ kind: 'notFound' });
    const bad = new GitHubClient('wrong', gh.fetch);
    await expect(openWorkspace(bad, location)).rejects.toBeInstanceOf(GitHubError);
    await expect(openWorkspace(bad, location)).rejects.toMatchObject({ kind: 'unauthorized', status: 401 });
  });

  it('BOM を残して読む', async () => {
    const gh = new FakeGitHub('acme', 'game', { 'a.yaml': '﻿name: x\n' });
    const ws = await openWorkspace(new GitHubClient('test-token', gh.fetch), { repo: { owner: 'acme', repo: 'game' }, folder: '', branch: 'main' });
    expect(await ws.fs.read('a.yaml')).toBe('﻿name: x\n');
    expect(await ws.fs.list('')).toEqual(['a.yaml']);
  });

  it('ネットワークの失敗は network の GitHubError にする', async () => {
    const client = new GitHubClient('t', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(client.repository({ owner: 'a', repo: 'b' })).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('GitHub 方式の保存（コミット）', () => {
  it('新しいブランチにコミットしてプルリクエストを作る。元のブランチは変わらない', async () => {
    const { gh, client, location } = setup();
    const ws = await openWorkspace(client, location);
    const { plan, path } = await editOneCell(ws.fs);
    const before = gh.branchFiles('main');
    const result = await ws.commit(plan, { message: 'update', branch: 'masterdata/x', newBranch: true, pull: { title: 'update', body: '', base: 'main' } });
    expect(result.branch).toBe('masterdata/x');
    expect(result.pull).toEqual({ number: 1, url: 'https://github.com/acme/game/pull/1' });
    expect(gh.pulls[0]).toMatchObject({ head: 'masterdata/x', base: 'main' });
    expect(gh.branchFiles('main')).toEqual(before);
    const after = gh.branchFiles('masterdata/x');
    expect(after[`data/master/${path}`]).toBe(plan.files[0].text);
    // 変えたファイルの外は同じ
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
    expect(changed).toEqual([`data/master/${path}`]);
    expect(ws.branch).toBe('masterdata/x');
    expect(ws.head.commit).toBe(gh.branches.get('masterdata/x'));
    // 書き込んだ内容は覚えていて、読み直さない
    expect(await ws.fs.read(path)).toBe(plan.files[0].text);
  });

  it('続けて今のブランチにコミットできる（早送り）', async () => {
    const { gh, client, location } = setup();
    const ws = await openWorkspace(client, location);
    const first = await editOneCell(ws.fs);
    await ws.commit(first.plan, { message: 'one', branch: 'work', newBranch: true });
    const second = await editOneCell(ws.fs);
    await ws.commit(second.plan, { message: 'two', branch: 'work', newBranch: false });
    const head = gh.commits.get(gh.branches.get('work') as string);
    expect(head?.message).toBe('two');
    expect(gh.commits.get(head?.parents[0] as string)?.message).toBe('one');
  });

  it('他でブランチが進んでいたら conflict で失敗し、上書きしない', async () => {
    const { gh, client, location } = setup();
    const ws = await openWorkspace(client, location);
    const { plan } = await editOneCell(ws.fs);
    gh.pushExternal('main', { 'other.txt': 'x' });
    const external = gh.branches.get('main');
    await expect(ws.commit(plan, { message: 'm', branch: 'main', newBranch: false })).rejects.toMatchObject({ kind: 'conflict' });
    expect(gh.branches.get('main')).toBe(external);
    // 失敗したら作業の場所は進めない
    expect(ws.branch).toBe('main');
  });

  it('同じ名前のブランチがあれば conflict', async () => {
    const { client, location } = setup();
    const ws = await openWorkspace(client, location);
    const { plan } = await editOneCell(ws.fs);
    await expect(ws.commit(plan, { message: 'm', branch: 'main', newBranch: true })).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('ファイルの削除もコミットに入る。読み込んだ版に無いファイルは消そうとしない', async () => {
    const { gh, client, location } = setup();
    const ws = await openWorkspace(client, location);
    const files = await ws.fs.list('tables');
    const target = `tables/${files[0]}`;
    await ws.commit({ files: [], remove: [target, 'tables/never-existed.yaml'] }, { message: 'rm', branch: 'rm', newBranch: true });
    expect(gh.branchFiles('rm')[`data/master/${target}`]).toBeUndefined();
    expect(await ws.fs.read(target)).toBeNull();
  });

  it('プルリクエストだけ失敗したら、コミットの結果を持つ PullRequestError', async () => {
    const { gh, client, location } = setup();
    const ws = await openWorkspace(client, location);
    const { plan } = await editOneCell(ws.fs);
    const err = await ws.commit(plan, { message: 'm', branch: 'b1', newBranch: true, pull: { title: 't', body: '', base: 'no-such-base' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PullRequestError);
    expect((err as PullRequestError).result.branch).toBe('b1');
    expect(gh.branches.has('b1')).toBe(true);
  });

  it('同じブランチのプルリクエストがすでに開いていれば、それを返す', async () => {
    const { gh, client, location } = setup();
    const ws = await openWorkspace(client, location);
    const first = await editOneCell(ws.fs);
    await ws.commit(first.plan, { message: 'one', branch: 'b', newBranch: true, pull: { title: 't', body: '', base: 'main' } });
    const second = await editOneCell(ws.fs);
    const r = await ws.commit(second.plan, { message: 'two', branch: 'b', newBranch: false, pull: { title: 't', body: '', base: 'main' } });
    expect(r.pullExisted).toBe(true);
    expect(r.pull?.number).toBe(1);
    expect(gh.pulls).toHaveLength(1);
  });

  it('書き込めないトークンは forbidden', async () => {
    const { gh, client, location } = setup();
    gh.canPush = false;
    const ws = await openWorkspace(client, location);
    const { plan } = await editOneCell(ws.fs);
    await expect(ws.commit(plan, { message: 'm', branch: 'x', newBranch: true })).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('ProjectSource の save: 取り消したら cancelled、コミットしたらすべて書けたことにする', async () => {
    const { client, location } = setup();
    const ws = await openWorkspace(client, location);
    const { plan } = await editOneCell(ws.fs);
    const cancelled = await githubSource(ws, async () => null).save(plan);
    expect(cancelled).toMatchObject({ cancelled: true, written: [] });
    const source = githubSource(ws, (w, p) => w.commit(p, { message: 'm', branch: 'saved', newBranch: true }));
    expect(source.kind).toBe('github');
    expect(source.backupName).toBe('github:acme/game/data/master@main');
    const outcome = await source.save(plan);
    expect(outcome.written).toHaveLength(plan.files.length);
    expect(outcome.committedTo).toBe('saved');
  });
});

describe('入力の記憶', () => {
  function memory(): StorageLike & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  }

  it('トークンは既定でセッションだけに置き、記憶を選べば端末に置く（もう一方からは消す）', () => {
    const stores = { session: memory(), local: memory() };
    saveToken('abc', false, stores);
    expect(stores.local.data.size).toBe(0);
    expect(loadToken(stores)).toEqual({ token: 'abc', remembered: false });
    saveToken('abc', true, stores);
    expect(stores.session.data.size).toBe(0);
    expect(loadToken(stores)).toEqual({ token: 'abc', remembered: true });
    forgetToken(stores);
    expect(loadToken(stores)).toBeNull();
  });

  it('ストレージが使えなくても例外にしない', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const stores = { session: broken, local: broken };
    expect(() => saveToken('x', true, stores)).not.toThrow();
    expect(loadToken(stores)).toBeNull();
    expect(loadLastLocation({ session: null, local: null })).toBeNull();
  });

  it('前回のリポジトリ・ブランチ・フォルダを覚える', () => {
    const stores = { session: memory(), local: memory() };
    saveLastLocation({ repo: { owner: 'acme', repo: 'game' }, branch: 'dev', folder: 'data' }, stores);
    expect(loadLastLocation(stores)).toEqual({ repo: 'acme/game', branch: 'dev', folder: 'data' });
  });
});
