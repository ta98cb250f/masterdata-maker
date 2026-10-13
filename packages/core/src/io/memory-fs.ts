import { normalizeDir } from '../model/project';
import type { ProjectFs } from './project';

/** メモリ上のファイル一式（組み込みのサンプル P-45 やテストで使う） */
export class MemoryProjectFs implements ProjectFs {
  private readonly files: Map<string, string>;

  constructor(files: Iterable<[string, string]> | Record<string, string> = {}) {
    const entries = Symbol.iterator in files ? [...(files as Iterable<[string, string]>)] : Object.entries(files);
    this.files = new Map(entries);
  }

  async list(dir: string): Promise<string[]> {
    const prefix = normalizeDir(dir);
    const names: string[] = [];
    for (const path of this.files.keys()) {
      const slash = path.lastIndexOf('/');
      const parent = slash < 0 ? '' : path.slice(0, slash);
      if (parent === prefix) names.push(path.slice(slash + 1));
    }
    return names.sort();
  }

  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  write(path: string, text: string): void {
    this.files.set(path, text);
  }

  remove(path: string): void {
    this.files.delete(path);
  }

  /** すべてのファイル（パスの昇順） */
  entries(): [string, string][] {
    return [...this.files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }
}
