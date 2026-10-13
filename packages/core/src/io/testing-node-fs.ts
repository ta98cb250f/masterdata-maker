// テスト専用: Node の fs でフォルダを読む ProjectFs。
// core の型検査に Node の型を持ち込まないよう、モジュール名を変数にして動的に読み込む
import type { ProjectFs } from './project';

interface DirEntry {
  name: string;
  isFile(): boolean;
}

interface NodeFsModule {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  readdir(path: string, options: { withFileTypes: true }): Promise<DirEntry[]>;
}

const FS_MODULE = 'node:fs/promises';

async function nodeFs(): Promise<NodeFsModule> {
  return (await import(/* @vite-ignore */ FS_MODULE)) as NodeFsModule;
}

/** リポジトリのルート（このファイルの位置から求める） */
export function repoRoot(): string {
  const url = (import.meta as unknown as { url: string }).url;
  const path = decodeURIComponent(url.replace(/^file:\/\//, ''));
  const i = path.lastIndexOf('/packages/core/');
  return path.slice(0, i);
}

function join(root: string, path: string): string {
  return path === '' ? root : `${root}/${path}`;
}

export async function createNodeProjectFs(root: string): Promise<ProjectFs> {
  const fs = await nodeFs();
  return {
    async list(dir) {
      try {
        const entries = await fs.readdir(join(root, dir), { withFileTypes: true });
        return entries.filter((e) => e.isFile()).map((e) => e.name);
      } catch {
        return [];
      }
    },
    async read(path) {
      try {
        return await fs.readFile(join(root, path), 'utf8');
      } catch {
        return null;
      }
    },
  };
}

/** フォルダの下のファイルを再帰的に読む（パスは root からの相対パス） */
export async function readTree(root: string): Promise<Map<string, string>> {
  const fs = await nodeFs();
  const files = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(join(root, dir), { withFileTypes: true });
    for (const entry of entries) {
      const path = dir === '' ? entry.name : `${dir}/${entry.name}`;
      if (entry.isFile()) files.set(path, await fs.readFile(join(root, path), 'utf8'));
      else await walk(path);
    }
  };
  await walk('');
  return files;
}
