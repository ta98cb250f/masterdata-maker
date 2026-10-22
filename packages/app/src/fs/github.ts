// GitHub 方式（FR-GH-01〜05、P-67）: GitHub の REST API でリポジトリの中のフォルダを読み込み、保存はコミットにする。
// サーバーを持たない（NFR-07）ので、ブラウザから api.github.com を直接呼ぶ（REST API は CORS に対応している）。
// 認証は利用者が入れた fine-grained personal access token。git のプロトコルはブラウザから使えないので clone はせず、
// Git Database API（tree・commit・ref）でコミットを作る。1 回の保存は 1 つのコミットで、すべてのファイルが入るか、1 つも入らない
import type { ProjectFs, SavePlan } from '@masterdata-maker/core';
import { normalizeDir } from '@masterdata-maker/core';
import { baseName, blobText, dirName, errorMessage } from './text';
import type { ProjectSource, SaveOutcome, SourceCapabilities } from './types';

export const GITHUB_API = 'https://api.github.com';

/** 前回のリポジトリは覚えるが、外部での変更の検知とフォルダへの直接書き込みは無い（保存はコミット） */
export const GITHUB_CAPABILITIES: SourceCapabilities = { rememberFolder: true, detectExternalChanges: false, directSave: false };

export interface RepoRef {
  owner: string;
  repo: string;
}

const NAME_RE = /^[A-Za-z0-9_.-]+$/;

/** 「owner/repo」または GitHub の URL（https://github.com/owner/repo、.git 付き、後ろにパスがあってもよい）から。読めなければ null */
export function parseRepo(text: string): RepoRef | null {
  let s = text.trim();
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i.exec(s);
  if (url !== null) s = url[1];
  else if (/^git@github\.com:/i.test(s)) s = s.slice('git@github.com:'.length);
  const parts = s.split('/').filter((p) => p !== '');
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!NAME_RE.test(owner) || !NAME_RE.test(repo) || repo === '.' || repo === '..') return null;
  // URL ではないのに 3 つ以上に分かれていたら、打ち間違いとみなす
  if (url === null && parts.length > 2) return null;
  return { owner, repo };
}

/** リポジトリの中のフォルダのパスを整える（前後の / と . を取る）。.. を含めば null */
export function normalizeRepoPath(text: string): string | null {
  const parts = text.trim().split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  return parts.join('/');
}

/** ブランチ名として git が受け付けるか（git check-ref-format の規則のうち、打ち間違いで起きやすいもの） */
export function isValidBranchName(name: string): boolean {
  if (name === '' || name === '@' || name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.startsWith('-')) return false;
  if (name.includes('..') || name.includes('//') || name.includes('@{') || name.endsWith('.lock')) return false;
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return false;
  return name.split('/').every((p) => p !== '' && !p.startsWith('.') && !p.endsWith('.lock'));
}

/** 新しいブランチの既定の名前（日時から） */
export function defaultBranchName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `masterdata/${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export type GitHubErrorKind = 'unauthorized' | 'forbidden' | 'notFound' | 'conflict' | 'rateLimited' | 'network' | 'other';

/** API の失敗。kind で画面の文言を選ぶ */
export class GitHubError extends Error {
  constructor(
    readonly kind: GitHubErrorKind,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

function errorKind(status: number, message: string, rateRemaining: string | null): GitHubErrorKind {
  if (status === 401) return 'unauthorized';
  if ((status === 403 || status === 429) && (rateRemaining === '0' || /rate limit/i.test(message))) return 'rateLimited';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 409 || status === 422) return 'conflict';
  return 'other';
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
}

export interface PullRef {
  number: number;
  url: string;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

function refPath(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/');
}

/** REST API の呼び出し（使うものだけ） */
export class GitHubClient {
  constructor(
    private readonly token: string,
    private readonly fetchFn: FetchFn = (input, init) => globalThis.fetch(input, init),
    private readonly base: string = GITHUB_API,
  ) {}

  private async send(method: string, path: string, body?: unknown, accept = 'application/vnd.github+json'): Promise<Response> {
    const headers: Record<string, string> = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
    if (this.token !== '') headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      // ブランチの先頭などを読み直すので、ブラウザのキャッシュは使わない
      res = await this.fetchFn(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch (e) {
      throw new GitHubError('network', 0, errorMessage(e));
    }
    if (!res.ok) {
      let message = res.statusText;
      try {
        const data = (await res.json()) as { message?: unknown; errors?: { message?: unknown }[] };
        if (typeof data.message === 'string') message = data.message;
        const details = (data.errors ?? []).map((e) => e.message).filter((m): m is string => typeof m === 'string');
        if (details.length > 0) message = `${message} (${details.join(', ')})`;
      } catch {
        // 本文が JSON でなければ statusText のまま
      }
      throw new GitHubError(errorKind(res.status, message, res.headers.get('x-ratelimit-remaining')), res.status, message);
    }
    return res;
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await (await this.send(method, path, body)).json()) as T;
  }

  private repoPath(ref: RepoRef): string {
    return `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  }

  /** リポジトリの既定のブランチと、push できるか（権限が分からなければ null） */
  async repository(ref: RepoRef): Promise<{ defaultBranch: string; canPush: boolean | null; fullName: string }> {
    const data = await this.json<{ default_branch: string; full_name: string; permissions?: { push?: boolean } }>('GET', this.repoPath(ref));
    return { defaultBranch: data.default_branch, canPush: data.permissions?.push ?? null, fullName: data.full_name };
  }

  /** ブランチの一覧（名前順。多すぎるリポジトリでは先頭の 1000 件まで） */
  async branches(ref: RepoRef): Promise<string[]> {
    const names: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const data = await this.json<{ name: string }[]>('GET', `${this.repoPath(ref)}/branches?per_page=100&page=${page}`);
      names.push(...data.map((b) => b.name));
      if (data.length < 100) break;
    }
    return names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /** ブランチの先頭のコミットと、そのツリー */
  async branchHead(ref: RepoRef, branch: string): Promise<{ commit: string; tree: string }> {
    const head = await this.json<{ object: { sha: string } }>('GET', `${this.repoPath(ref)}/git/ref/heads/${refPath(branch)}`);
    const commit = await this.json<{ tree: { sha: string } }>('GET', `${this.repoPath(ref)}/git/commits/${head.object.sha}`);
    return { commit: head.object.sha, tree: commit.tree.sha };
  }

  /** ツリーの中身。recursive なら下のフォルダもすべて（パスはこのツリーからの相対パス） */
  async tree(ref: RepoRef, sha: string, recursive: boolean): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const data = await this.json<{ tree: TreeEntry[]; truncated?: boolean }>(
      'GET',
      `${this.repoPath(ref)}/git/trees/${sha}${recursive ? '?recursive=1' : ''}`,
    );
    return { entries: data.tree, truncated: data.truncated === true };
  }

  /** ファイルの中身（UTF-8。BOM は残す） */
  async blobText(ref: RepoRef, sha: string): Promise<string> {
    const res = await this.send('GET', `${this.repoPath(ref)}/git/blobs/${sha}`, undefined, 'application/vnd.github.raw+json');
    return blobText(res);
  }

  /** ルートのツリーから、フォルダのツリーを辿る。無ければ null */
  async folderTree(ref: RepoRef, rootTree: string, folder: string): Promise<string | null> {
    let sha = rootTree;
    for (const part of folder === '' ? [] : folder.split('/')) {
      const { entries } = await this.tree(ref, sha, false);
      const next = entries.find((e) => e.type === 'tree' && e.path === part);
      if (next === undefined) return null;
      sha = next.sha;
    }
    return sha;
  }

  async createTree(ref: RepoRef, baseTree: string, entries: unknown[]): Promise<string> {
    return (await this.json<{ sha: string }>('POST', `${this.repoPath(ref)}/git/trees`, { base_tree: baseTree, tree: entries })).sha;
  }

  async createCommit(ref: RepoRef, message: string, tree: string, parent: string): Promise<string> {
    return (await this.json<{ sha: string }>('POST', `${this.repoPath(ref)}/git/commits`, { message, tree, parents: [parent] })).sha;
  }

  async createBranch(ref: RepoRef, branch: string, sha: string): Promise<void> {
    await this.json('POST', `${this.repoPath(ref)}/git/refs`, { ref: `refs/heads/${branch}`, sha });
  }

  /** ブランチを進める（早送りだけ。他で進んでいれば conflict で失敗する） */
  async updateBranch(ref: RepoRef, branch: string, sha: string): Promise<void> {
    await this.json('PATCH', `${this.repoPath(ref)}/git/refs/heads/${refPath(branch)}`, { sha, force: false });
  }

  async createPull(ref: RepoRef, request: { title: string; body: string; head: string; base: string }): Promise<PullRef> {
    const data = await this.json<{ number: number; html_url: string }>('POST', `${this.repoPath(ref)}/pulls`, request);
    return { number: data.number, url: data.html_url };
  }

  /** ブランチから開いているプルリクエスト（無ければ null） */
  async openPull(ref: RepoRef, head: string): Promise<PullRef | null> {
    const q = `head=${encodeURIComponent(`${ref.owner}:${head}`)}&state=open&per_page=1`;
    const data = await this.json<{ number: number; html_url: string }[]>('GET', `${this.repoPath(ref)}/pulls?${q}`);
    return data.length === 0 ? null : { number: data[0].number, url: data[0].html_url };
  }
}

/** 同時に送る読み込みの数の上限（GitHub の二次的な流量制限を避ける） */
const READ_CONCURRENCY = 6;

interface RepoFile {
  /** 読み込んだ版の blob。書き込んだファイルは null（中身は text に持つ） */
  sha: string | null;
  mode: string;
  text: string | null;
}

/** フォルダの中のファイル一式（パスはフォルダからの相対パス）。中身は読むときに取りに行き、覚えておく */
export class GitHubProjectFs implements ProjectFs {
  private readonly files = new Map<string, RepoFile>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly client: GitHubClient,
    private readonly ref: RepoRef,
    entries: readonly TreeEntry[],
  ) {
    // シンボリックリンク（120000）とサブモジュール（commit）は読まない
    for (const e of entries) if (e.type === 'blob' && e.mode !== '120000') this.files.set(e.path, { sha: e.sha, mode: e.mode, text: null });
  }

  async list(dir: string): Promise<string[]> {
    const prefix = normalizeDir(dir);
    const names: string[] = [];
    for (const path of this.files.keys()) if (dirName(path) === prefix) names.push(baseName(path));
    return names.sort();
  }

  async read(path: string): Promise<string | null> {
    const file = this.files.get(path);
    if (file === undefined) return null;
    if (file.text !== null) return file.text;
    const sha = file.sha as string;
    if (this.active >= READ_CONCURRENCY) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      const text = await this.client.blobText(this.ref, sha);
      if (this.files.get(path) === file) file.text = text;
      return text;
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  mode(path: string): string | null {
    return this.files.get(path)?.mode ?? null;
  }

  /** コミットした内容を覚える */
  applyCommitted(written: readonly { path: string; text: string }[], removed: readonly string[]): void {
    for (const f of written) this.files.set(f.path, { sha: null, mode: this.files.get(f.path)?.mode ?? '100644', text: f.text });
    for (const path of removed) this.files.delete(path);
  }
}

/** 開いている場所（リポジトリ・フォルダ・ブランチ）と、コミットの土台 */
export interface GitHubLocation {
  repo: RepoRef;
  /** リポジトリの中のフォルダ（ルートなら空文字） */
  folder: string;
  branch: string;
}

export interface CommitRequest {
  message: string;
  /** コミットするブランチ。newBranch なら新しく作る（今のコミットから） */
  branch: string;
  newBranch: boolean;
  /** プルリクエストを作る（base はマージ先のブランチ） */
  pull?: { title: string; body: string; base: string };
}

export interface CommitResult {
  branch: string;
  commit: string;
  commitUrl: string;
  /** 作った、またはすでに開いていたプルリクエスト */
  pull: PullRef | null;
  /** プルリクエストはすでに開いていた（作らなかった） */
  pullExisted: boolean;
}

/** GitHub の上の作業の場所。コミットしたら、そのブランチとコミットへ進む */
export class GitHubWorkspace {
  branch: string;
  head: { commit: string; tree: string };

  constructor(
    readonly client: GitHubClient,
    readonly repo: RepoRef,
    readonly folder: string,
    branch: string,
    head: { commit: string; tree: string },
    readonly fs: GitHubProjectFs,
    /** 開いたときのブランチ（プルリクエストのマージ先の既定） */
    readonly openedBranch: string,
    readonly defaultBranch: string,
  ) {
    this.branch = branch;
    this.head = head;
  }

  get name(): string {
    return `${this.repo.owner}/${this.repo.repo}${this.folder === '' ? '' : `/${this.folder}`}`;
  }

  repoPath(path: string): string {
    return this.folder === '' ? path : `${this.folder}/${path}`;
  }

  /** 保存の計画を 1 つのコミットにして、ブランチを進める（作る）。プルリクエストも作れる */
  async commit(plan: SavePlan, request: CommitRequest): Promise<CommitResult> {
    const entries: unknown[] = [];
    for (const file of plan.files) {
      entries.push({ path: this.repoPath(file.path), mode: this.fs.mode(file.path) ?? '100644', type: 'blob', content: file.text });
    }
    for (const path of plan.remove) {
      // 読み込んだ版に無いファイルを消そうとすると GitHub が失敗にするので、あるものだけを消す
      if (this.fs.mode(path) !== null) entries.push({ path: this.repoPath(path), mode: '100644', type: 'blob', sha: null });
    }
    const tree = await this.client.createTree(this.repo, this.head.tree, entries);
    const commit = await this.client.createCommit(this.repo, request.message, tree, this.head.commit);
    if (request.newBranch) await this.client.createBranch(this.repo, request.branch, commit);
    else await this.client.updateBranch(this.repo, request.branch, commit);
    // ここまで来たらコミットは入った。以降の失敗（プルリクエスト）は、コミットを取り消さずに知らせる
    this.branch = request.branch;
    this.head = { commit, tree };
    this.fs.applyCommitted(plan.files, plan.remove);
    const result: CommitResult = {
      branch: request.branch,
      commit,
      commitUrl: `https://github.com/${this.repo.owner}/${this.repo.repo}/commit/${commit}`,
      pull: null,
      pullExisted: false,
    };
    if (request.pull !== undefined) {
      try {
        result.pull = await this.client.createPull(this.repo, { ...request.pull, head: request.branch });
      } catch (e) {
        // 同じブランチからのプルリクエストがすでに開いていれば、それを示す
        const existing = e instanceof GitHubError && e.kind === 'conflict' ? await this.client.openPull(this.repo, request.branch).catch(() => null) : null;
        if (existing === null) throw new PullRequestError(result, e);
        result.pull = existing;
        result.pullExisted = true;
      }
    }
    return result;
  }
}

/** コミットはできたが、プルリクエストを作れなかった */
export class PullRequestError extends Error {
  constructor(
    readonly result: CommitResult,
    override readonly cause: unknown,
  ) {
    super(errorMessage(cause));
    this.name = 'PullRequestError';
  }
}

/** フォルダを読み込んで作業の場所を作る。フォルダが無ければ GitHubError（notFound） */
export async function openWorkspace(client: GitHubClient, location: GitHubLocation): Promise<GitHubWorkspace> {
  const [info, head] = await Promise.all([client.repository(location.repo), client.branchHead(location.repo, location.branch)]);
  const folderTree = await client.folderTree(location.repo, head.tree, location.folder);
  if (folderTree === null) throw new GitHubError('notFound', 404, `${location.folder} is not found on ${location.branch}`);
  const { entries, truncated } = await client.tree(location.repo, folderTree, true);
  if (truncated) throw new GitHubError('other', 0, 'The folder has too many files to read through the GitHub API. Choose a smaller folder.');
  const fs = new GitHubProjectFs(client, location.repo, entries);
  return new GitHubWorkspace(client, location.repo, location.folder, location.branch, head, fs, location.branch, info.defaultBranch);
}

/**
 * 保存の受け持ち（画面）。コミットのダイアログを出し、コミットした（取り消した）結果を返す。
 * 取り消したら null
 */
export type CommitRunner = (workspace: GitHubWorkspace, plan: SavePlan) => Promise<CommitResult | null>;

export function githubSource(workspace: GitHubWorkspace, runCommit: CommitRunner): ProjectSource & { github: GitHubWorkspace } {
  return {
    kind: 'github',
    name: workspace.name,
    backupName: `github:${workspace.name}@${workspace.openedBranch}`,
    fs: workspace.fs,
    capabilities: GITHUB_CAPABILITIES,
    github: workspace,
    save: async (plan): Promise<SaveOutcome> => {
      const result = await runCommit(workspace, plan);
      if (result === null) return { written: [], removed: [], failed: [], manualRemove: [], cancelled: true };
      return { written: [...plan.files], removed: [...plan.remove], failed: [], manualRemove: [], committedTo: result.branch };
    },
  };
}

export function isGitHubSource(source: ProjectSource | null): source is ProjectSource & { github: GitHubWorkspace } {
  return source !== null && source.kind === 'github' && (source as { github?: unknown }).github instanceof GitHubWorkspace;
}
