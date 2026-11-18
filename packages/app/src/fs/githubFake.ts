// テスト用の偽の GitHub（REST API のうち fs/github.ts が使う部分だけ）。単体テストと画面テスト（page.route）で使う。
// オブジェクトはメモリ上に持ち、sha は内容から作る（本物の SHA-1 ではない）
export interface FakeResponse {
  status: number;
  body: unknown;
  /** 生のテキストで返す（blob の raw） */
  raw?: boolean;
}

interface FakeTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
}

interface FakePull {
  number: number;
  head: string;
  base: string;
  title: string;
  body: string;
}

let seq = 0;

function hash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + text.charCodeAt(i), 2246822519) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(3).slice(0, 40);
}

export class FakeGitHub {
  readonly owner: string;
  readonly repo: string;
  readonly blobs = new Map<string, string>();
  readonly trees = new Map<string, FakeTreeEntry[]>();
  readonly commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  readonly branches = new Map<string, string>();
  readonly pulls: FakePull[] = [];
  /** 受け付けたトークン（違えば 401） */
  token = 'test-token';
  canPush = true;
  defaultBranch = 'main';
  /** 呼ばれた要求（method と path） */
  readonly calls: string[] = [];
  /** 次の要求を失敗させる（path の一部が一致したら） */
  failNext: { match: string; status: number; message: string } | null = null;

  constructor(owner: string, repo: string, files: Record<string, string>, branch = 'main') {
    this.owner = owner;
    this.repo = repo;
    const tree = this.buildTree(files);
    const commit = this.addCommit(tree, [], 'initial');
    this.branches.set(branch, commit);
    this.defaultBranch = branch;
  }

  private addBlob(text: string): string {
    const sha = hash(`blob\0${text}`);
    this.blobs.set(sha, text);
    return sha;
  }

  private addTree(entries: FakeTreeEntry[]): string {
    const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : 1));
    const sha = hash(`tree\0${JSON.stringify(sorted)}`);
    this.trees.set(sha, sorted);
    return sha;
  }

  private addCommit(tree: string, parents: string[], message: string): string {
    const sha = hash(`commit\0${tree}\0${parents.join(',')}\0${message}\0${seq++}`);
    this.commits.set(sha, { tree, parents, message });
    return sha;
  }

  /** パス → 中身 から、入れ子のツリーを作る */
  buildTree(files: Record<string, string>): string {
    const here: FakeTreeEntry[] = [];
    const sub = new Map<string, Record<string, string>>();
    for (const [path, text] of Object.entries(files)) {
      const i = path.indexOf('/');
      if (i < 0) here.push({ path, mode: '100644', type: 'blob', sha: this.addBlob(text) });
      else {
        const dir = path.slice(0, i);
        const rest = sub.get(dir) ?? {};
        rest[path.slice(i + 1)] = text;
        sub.set(dir, rest);
      }
    }
    for (const [dir, rest] of sub) here.push({ path: dir, mode: '040000', type: 'tree', sha: this.buildTree(rest) });
    return this.addTree(here);
  }

  /** ツリーの中のファイル一式（パス → 中身） */
  filesOf(treeSha: string, prefix = ''): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of this.trees.get(treeSha) ?? []) {
      const path = prefix === '' ? e.path : `${prefix}/${e.path}`;
      if (e.type === 'tree') Object.assign(out, this.filesOf(e.sha, path));
      else out[path] = this.blobs.get(e.sha) ?? '';
    }
    return out;
  }

  /** ブランチの先頭のファイル一式 */
  branchFiles(branch: string): Record<string, string> {
    const commit = this.commits.get(this.branches.get(branch) ?? '');
    return commit === undefined ? {} : this.filesOf(commit.tree);
  }

  /** 他の誰かがブランチにコミットした（ブランチを進める） */
  pushExternal(branch: string, files: Record<string, string>): void {
    const parent = this.branches.get(branch) ?? '';
    const merged = { ...this.branchFiles(branch), ...files };
    this.branches.set(branch, this.addCommit(this.buildTree(merged), [parent], 'external'));
  }

  private applyTree(base: string, changes: { path: string; mode: string; content?: string; sha?: string | null }[]): string {
    const files = this.filesOf(base);
    for (const c of changes) {
      if (c.sha === null) {
        if (!(c.path in files)) throw new Error(`cannot delete ${c.path}`);
        delete files[c.path];
      } else files[c.path] = c.content ?? this.blobs.get(c.sha ?? '') ?? '';
    }
    return this.buildTree(files);
  }

  /** 要求を処理する（url は https://api.github.com から始まる完全な URL） */
  handle(method: string, url: string, headers: Record<string, string>, bodyText: string | null): FakeResponse {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    this.calls.push(`${method} ${path}`);
    if (this.failNext !== null && path.includes(this.failNext.match)) {
      const f = this.failNext;
      this.failNext = null;
      return { status: f.status, body: { message: f.message } };
    }
    const auth = headers.authorization ?? headers.Authorization;
    if (auth !== `Bearer ${this.token}`) return { status: 401, body: { message: 'Bad credentials' } };
    const prefix = `/repos/${this.owner}/${this.repo}`;
    if (!path.startsWith(prefix)) return { status: 404, body: { message: 'Not Found' } };
    const rest = path.slice(prefix.length);
    const body = bodyText === null || bodyText === '' ? {} : (JSON.parse(bodyText) as Record<string, unknown>);
    const notFound = { status: 404, body: { message: 'Not Found' } };
    const write = (): FakeResponse | null => (this.canPush ? null : { status: 403, body: { message: 'Resource not accessible by personal access token' } });

    if (method === 'GET' && rest === '') {
      return { status: 200, body: { full_name: `${this.owner}/${this.repo}`, default_branch: this.defaultBranch, permissions: { push: this.canPush } } };
    }
    if (method === 'GET' && rest === '/branches') {
      const page = Number(u.searchParams.get('page') ?? '1');
      const per = Number(u.searchParams.get('per_page') ?? '30');
      const names = [...this.branches.keys()].sort();
      return { status: 200, body: names.slice((page - 1) * per, page * per).map((name) => ({ name })) };
    }
    let m = /^\/git\/ref\/heads\/(.+)$/.exec(rest);
    if (method === 'GET' && m !== null) {
      const sha = this.branches.get(m[1]);
      return sha === undefined ? notFound : { status: 200, body: { ref: `refs/heads/${m[1]}`, object: { sha, type: 'commit' } } };
    }
    m = /^\/git\/commits\/([0-9a-f]+)$/.exec(rest);
    if (method === 'GET' && m !== null) {
      const c = this.commits.get(m[1]);
      return c === undefined ? notFound : { status: 200, body: { sha: m[1], tree: { sha: c.tree }, message: c.message } };
    }
    m = /^\/git\/trees\/([0-9a-f]+)$/.exec(rest);
    if (method === 'GET' && m !== null) {
      const t = this.trees.get(m[1]);
      if (t === undefined) return notFound;
      if (u.searchParams.get('recursive') === null) return { status: 200, body: { sha: m[1], tree: t, truncated: false } };
      const all: FakeTreeEntry[] = [];
      const walk = (sha: string, prefix: string) => {
        for (const e of this.trees.get(sha) ?? []) {
          const p = prefix === '' ? e.path : `${prefix}/${e.path}`;
          all.push({ ...e, path: p });
          if (e.type === 'tree') walk(e.sha, p);
        }
      };
      walk(m[1], '');
      return { status: 200, body: { sha: m[1], tree: all, truncated: false } };
    }
    m = /^\/git\/blobs\/([0-9a-f]+)$/.exec(rest);
    if (method === 'GET' && m !== null) {
      const b = this.blobs.get(m[1]);
      return b === undefined ? notFound : { status: 200, body: b, raw: true };
    }
    if (method === 'POST' && rest === '/git/trees') {
      const denied = write();
      if (denied !== null) return denied;
      try {
        const sha = this.applyTree(body.base_tree as string, body.tree as never);
        return { status: 201, body: { sha } };
      } catch (e) {
        return { status: 422, body: { message: (e as Error).message } };
      }
    }
    if (method === 'POST' && rest === '/git/commits') {
      const denied = write();
      if (denied !== null) return denied;
      const sha = this.addCommit(body.tree as string, body.parents as string[], body.message as string);
      return { status: 201, body: { sha } };
    }
    if (method === 'POST' && rest === '/git/refs') {
      const denied = write();
      if (denied !== null) return denied;
      const name = (body.ref as string).replace(/^refs\/heads\//, '');
      if (this.branches.has(name)) return { status: 422, body: { message: 'Reference already exists' } };
      this.branches.set(name, body.sha as string);
      return { status: 201, body: { ref: body.ref, object: { sha: body.sha } } };
    }
    m = /^\/git\/refs\/heads\/(.+)$/.exec(rest);
    if (method === 'PATCH' && m !== null) {
      const denied = write();
      if (denied !== null) return denied;
      const current = this.branches.get(m[1]);
      if (current === undefined) return { status: 422, body: { message: 'Reference does not exist' } };
      const next = body.sha as string;
      // 早送りか（新しいコミットの親を辿って今の先頭に着くか）
      let cursor: string | undefined = next;
      let fastForward = false;
      while (cursor !== undefined) {
        if (cursor === current) {
          fastForward = true;
          break;
        }
        cursor = this.commits.get(cursor)?.parents[0];
      }
      if (!fastForward && body.force !== true) return { status: 422, body: { message: 'Update is not a fast forward' } };
      this.branches.set(m[1], next);
      return { status: 200, body: { object: { sha: next } } };
    }
    if (method === 'POST' && rest === '/pulls') {
      const denied = write();
      if (denied !== null) return denied;
      const head = body.head as string;
      const base = body.base as string;
      if (!this.branches.has(base)) return { status: 422, body: { message: 'Validation Failed', errors: [{ message: 'base is invalid' }] } };
      if (this.pulls.some((p) => p.head === head && p.base === base)) {
        return { status: 422, body: { message: 'Validation Failed', errors: [{ message: `A pull request already exists for ${this.owner}:${head}.` }] } };
      }
      const pull: FakePull = { number: this.pulls.length + 1, head, base, title: body.title as string, body: (body.body as string) ?? '' };
      this.pulls.push(pull);
      return { status: 201, body: { number: pull.number, html_url: `https://github.com/${this.owner}/${this.repo}/pull/${pull.number}` } };
    }
    if (method === 'GET' && rest === '/pulls') {
      const head = (u.searchParams.get('head') ?? '').replace(`${this.owner}:`, '');
      const found = this.pulls.filter((p) => p.head === head);
      return { status: 200, body: found.map((p) => ({ number: p.number, html_url: `https://github.com/${this.owner}/${this.repo}/pull/${p.number}` })) };
    }
    return notFound;
  }

  /** fetch の代わり（単体テスト用） */
  fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const r = this.handle(init?.method ?? 'GET', input, headers, (init?.body as string | undefined) ?? null);
    const text = r.raw === true ? (r.body as string) : JSON.stringify(r.body);
    return new Response(text, { status: r.status, headers: { 'Content-Type': r.raw === true ? 'application/octet-stream' : 'application/json' } });
  };
}
