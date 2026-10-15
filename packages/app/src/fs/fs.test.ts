import { describe, expect, it } from 'vitest';
import type { SavePlan } from '@sheetcraft/core';
import { EditSession, enterInput, loadProject } from '@sheetcraft/core';
import { unzipSync, strFromU8 } from 'fflate';
import type { DirectoryHandleLike, FileHandleLike, WritableLike } from './direct';
import { DirectoryProjectFs, directSource, ensurePermission, supportsDirectAccess, writePlan } from './direct';
import type { RelativeFile } from './download';
import { downloadPlan, FileListProjectFs, filesToProject } from './download';
import { generateLargeProjectFiles } from './largeSample';
import { basicSampleFiles, sampleSource } from './sample';

// ---- 偽の FileSystemHandle（メモリ上） ----

class FakeFile {
  constructor(
    public text: string,
    public lastModified: number,
  ) {}
  async arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = new TextEncoder().encode(this.text);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  }
}

function notFound(): Error {
  const e = new Error('not found');
  e.name = 'NotFoundError';
  return e;
}

let clock = 1000;

class FakeFileHandle implements FileHandleLike {
  readonly kind = 'file' as const;
  /** close の前の書き込み（一時ファイル） */
  pending: string | null = null;
  failWrite = false;
  constructor(
    readonly name: string,
    public file: FakeFile,
  ) {}
  async getFile(): Promise<FakeFile> {
    return this.file;
  }
  async createWritable(): Promise<WritableLike> {
    this.pending = '';
    return {
      write: async (data: string) => {
        if (this.failWrite) throw new Error('disk full');
        this.pending = (this.pending ?? '') + data;
      },
      close: async () => {
        this.file = new FakeFile(this.pending ?? '', ++clock);
        this.pending = null;
      },
      abort: async () => {
        this.pending = null;
      },
    };
  }
}

class FakeDirHandle implements DirectoryHandleLike {
  readonly kind = 'directory' as const;
  readonly entries = new Map<string, FakeFileHandle | FakeDirHandle>();
  permission: PermissionState = 'granted';
  requested = 0;
  constructor(readonly name: string) {}
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirHandle> {
    const e = this.entries.get(name);
    if (e instanceof FakeDirHandle) return e;
    if (e !== undefined || !options?.create) throw notFound();
    const d = new FakeDirHandle(name);
    this.entries.set(name, d);
    return d;
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    const e = this.entries.get(name);
    if (e instanceof FakeFileHandle) return e;
    if (e !== undefined || !options?.create) throw notFound();
    const f = new FakeFileHandle(name, new FakeFile('', ++clock));
    this.entries.set(name, f);
    return f;
  }
  async removeEntry(name: string): Promise<void> {
    if (!this.entries.delete(name)) throw notFound();
  }
  async *values(): AsyncIterable<FakeFileHandle | FakeDirHandle> {
    yield* this.entries.values();
  }
  async queryPermission(): Promise<PermissionState> {
    return this.permission;
  }
  async requestPermission(): Promise<PermissionState> {
    this.requested++;
    this.permission = 'granted';
    return this.permission;
  }
}

function fakeFolder(name: string, files: Record<string, string>): FakeDirHandle {
  const root = new FakeDirHandle(name);
  for (const [path, text] of Object.entries(files)) {
    const parts = path.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let next = dir.entries.get(part);
      if (!(next instanceof FakeDirHandle)) {
        next = new FakeDirHandle(part);
        dir.entries.set(part, next);
      }
      dir = next;
    }
    const fileName = parts[parts.length - 1];
    dir.entries.set(fileName, new FakeFileHandle(fileName, new FakeFile(text, ++clock)));
  }
  return root;
}

async function readAll(fs: DirectoryProjectFs, dir: FakeDirHandle, prefix = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, e] of dir.entries) {
    const path = prefix === '' ? name : `${prefix}/${name}`;
    if (e instanceof FakeDirHandle) Object.assign(out, await readAll(fs, e, path));
    else out[path] = e.file.text;
  }
  return out;
}

describe('直接保存方式（DirectoryProjectFs）', () => {
  it('list / read / write / remove / lastModified。BOM は残す', async () => {
    const root = fakeFolder('proj', { 'sheetcraft.yaml': 'a', 'tables/x.yaml': '﻿x', 'tables/sub/y.yaml': 'y' });
    const fs = new DirectoryProjectFs(root);
    expect(await fs.list('')).toEqual(['sheetcraft.yaml']);
    expect(await fs.list('tables')).toEqual(['x.yaml']);
    expect(await fs.list('tables/')).toEqual(['x.yaml']);
    expect(await fs.list('nothing')).toEqual([]);
    expect(await fs.read('tables/x.yaml')).toBe('﻿x');
    expect(await fs.read('tables/none.yaml')).toBeNull();
    expect(await fs.read('none/none.yaml')).toBeNull();
    await fs.write('config/enums.yaml', 'enums: []\n');
    expect(await fs.read('config/enums.yaml')).toBe('enums: []\n');
    const before = await fs.lastModified('tables/x.yaml');
    await fs.write('tables/x.yaml', 'x2');
    expect(await fs.lastModified('tables/x.yaml')).toBeGreaterThan(before ?? 0);
    await fs.remove('tables/x.yaml');
    expect(await fs.read('tables/x.yaml')).toBeNull();
    await fs.remove('tables/x.yaml'); // 無いファイルを消しても失敗にしない
    expect(await fs.lastModified('tables/x.yaml')).toBeNull();
  });

  it('書き込みに失敗したら元のファイルを残し、失敗として返す（NFR-15）', async () => {
    const root = fakeFolder('proj', { 'a.yaml': 'old', 'b.yaml': 'old' });
    const fs = new DirectoryProjectFs(root);
    (root.entries.get('a.yaml') as FakeFileHandle).failWrite = true;
    const plan: SavePlan = {
      files: [
        { path: 'a.yaml', text: 'new', format: 'yaml', target: { kind: 'common', part: 'enums' } },
        { path: 'b.yaml', text: 'new', format: 'yaml', target: { kind: 'common', part: 'colors' } },
      ],
      remove: ['gone.yaml'],
    };
    const outcome = await writePlan(fs, plan);
    expect(outcome.written.map((f) => f.path)).toEqual(['b.yaml']);
    expect(outcome.failed.map((f) => f.path)).toEqual(['a.yaml']);
    expect(outcome.removed).toEqual(['gone.yaml']);
    expect(await fs.read('a.yaml')).toBe('old');
    expect(await fs.read('b.yaml')).toBe('new');
  });

  it('サンプルを開いて 1 セル変えて保存すると、そのファイルだけが変わる', async () => {
    const files = basicSampleFiles();
    const root = fakeFolder('basic-yaml', files);
    const source = directSource(root);
    const loaded = await loadProject(source.fs);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    const project = loaded.project;
    const session = new EditSession(project);
    const character = project.tables.find((t) => t.name === 'character');
    expect(character).toBeDefined();
    const record = character!.records[1];
    expect(session.run(enterInput(project, { table: character!.uid, cells: [{ record: record.uid, column: 'hp' }], text: '1000' })).ok).toBe(true);
    const plan = session.planSave();
    expect(plan.files.map((f) => f.path)).toEqual(['tables/character.yaml']);
    const outcome = await source.save(plan);
    session.markSaved(outcome.written, outcome.removed);
    expect(session.hasUnsavedChanges()).toBe(false);
    const after = await readAll(source.fs as DirectoryProjectFs, root);
    for (const [path, text] of Object.entries(files)) {
      if (path === 'tables/character.yaml') {
        expect(text).toContain('hp: { value: 800, color: red, comment: 次回調整予定 }');
        expect(after[path]).toContain('hp: { value: 1000, color: red, comment: 次回調整予定 }');
      } else {
        expect(after[path], path).toBe(text);
      }
    }
  });

  it('API の有無で方式を決める（NFR-04）。許可が無ければ求める', async () => {
    expect(supportsDirectAccess({})).toBe(false);
    expect(supportsDirectAccess({ showDirectoryPicker: () => undefined })).toBe(true);
    const root = fakeFolder('p', {});
    root.permission = 'prompt';
    expect(await ensurePermission(root)).toBe(true);
    expect(root.requested).toBe(1);
    expect(await ensurePermission(root)).toBe(true);
    expect(root.requested).toBe(1);
  });
});

describe('ダウンロード保存方式', () => {
  function relFile(path: string, text: string): RelativeFile {
    const blob = new Blob([text]);
    return Object.assign(blob, { name: path.split('/').pop() ?? path, webkitRelativePath: path });
  }

  it('webkitdirectory のファイル一式から、選んだフォルダからの相対パスで読める', async () => {
    const r = filesToProject([relFile('proj/sheetcraft.yaml', 'a'), relFile('proj/tables/x.yaml', 'x'), relFile('proj/tables/y.json', 'y')]);
    expect(r?.name).toBe('proj');
    const fs = r?.fs as FileListProjectFs;
    expect(await fs.list('')).toEqual(['sheetcraft.yaml']);
    expect(await fs.list('tables/')).toEqual(['x.yaml', 'y.json']);
    expect(await fs.read('tables/x.yaml')).toBe('x');
    expect(await fs.read('tables/z.yaml')).toBeNull();
    expect(filesToProject([])).toBeNull();
  });

  it('1 ファイルならそのファイル、複数ならフォルダ構成を保った ZIP をダウンロードし、消すファイルは手で消すものとして返す', async () => {
    const downloads: { name: string; blob: Blob }[] = [];
    const download = (blob: Blob, name: string) => downloads.push({ name, blob });
    const one: SavePlan = {
      files: [{ path: 'tables/a.yaml', text: 'A', format: 'yaml', target: { kind: 'table', table: 1, name: 'a', state: 1 } }],
      remove: [],
    };
    const o1 = downloadPlan(one, 'proj', download);
    expect(o1.downloaded).toBe('a.yaml');
    expect(await downloads[0].blob.text()).toBe('A');
    expect(o1.written).toHaveLength(1);

    const two: SavePlan = {
      files: [
        { path: 'tables/a.yaml', text: 'A', format: 'yaml', target: { kind: 'table', table: 1, name: 'a', state: 1 } },
        { path: 'config/enums.yaml', text: 'E', format: 'yaml', target: { kind: 'common', part: 'enums' } },
      ],
      remove: ['tables/old.yaml'],
    };
    const o2 = downloadPlan(two, 'proj', download);
    expect(o2.downloaded).toBe('proj.zip');
    expect(o2.manualRemove).toEqual(['tables/old.yaml']);
    const entries = unzipSync(new Uint8Array(await downloads[1].blob.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(['config/enums.yaml', 'tables/a.yaml']);
    expect(strFromU8(entries['tables/a.yaml'])).toBe('A');
  });

  it('組み込みのサンプルを開ける（P-45）', async () => {
    const files = basicSampleFiles();
    expect(Object.keys(files).sort()).toEqual([
      'config/base_fields.yaml',
      'config/colors.yaml',
      'config/enums.yaml',
      'sheetcraft.yaml',
      'tables/character.yaml',
      'tables/skill.yaml',
      'tables/stage.yaml',
    ]);
    const source = sampleSource('basic', () => undefined);
    expect(source.kind).toBe('sample');
    expect(source.capabilities.directSave).toBe(false);
    const loaded = await loadProject(source.fs);
    expect(loaded.status === 'ok' && loaded.project.tables.map((t) => t.name)).toEqual(['character', 'skill', 'stage']);
  });

  it('性能の確認用の大きなプロジェクトを生成できる（行数・列数を指定）', async () => {
    const files = generateLargeProjectFiles({ rows: 30, columns: 50, format: 'json' });
    const loaded = await loadProject(new FileListProjectFs(Object.entries(files).map(([p, t]) => [p, new Blob([t])])));
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    const big = loaded.project.tables.find((t) => t.name === 'big');
    expect(big?.records).toHaveLength(30);
    expect(loaded.project.common.base_fields.items.length + (big?.fields.length ?? 0)).toBe(50);
    expect(loaded.project.brokenTables).toEqual([]);
  });

  it('大きなテーブルを複数生成できる（NFR-11 の確認用。名前は big_001 から）', async () => {
    const files = generateLargeProjectFiles({ rows: 5, columns: 20, format: 'yaml', bigTables: 3 });
    expect(Object.keys(files).filter((p) => p.startsWith('tables/')).sort()).toEqual([
      'tables/big_001.yaml',
      'tables/big_002.yaml',
      'tables/big_003.yaml',
      'tables/skill.yaml',
    ]);
    const loaded = await loadProject(new FileListProjectFs(Object.entries(files).map(([p, t]) => [p, new Blob([t])])));
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.project.tables.map((t) => [t.name, t.records.length, t.fields.length + 2])).toEqual([
      ['big_001', 5, 20],
      ['big_002', 5, 20],
      ['big_003', 5, 20],
      ['skill', 50, 4],
    ]);
    // 乱数の種はテーブルごとに変える
    expect(files['tables/big_001.yaml'].slice(files['tables/big_001.yaml'].indexOf('records:'))).not.toBe(
      files['tables/big_002.yaml'].slice(files['tables/big_002.yaml'].indexOf('records:')),
    );
    expect(loaded.project.brokenTables).toEqual([]);
  });
});
