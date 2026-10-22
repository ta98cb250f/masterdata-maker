// GitHub 方式の入力の記憶（FR-GH-01、P-67）。
// トークンは既定ではタブを閉じると消える sessionStorage に置き、「この端末に記憶する」を選んだときだけ localStorage に置く。
// リポジトリ・ブランチ・フォルダ（秘密ではない）は localStorage に覚える
import type { GitHubLocation } from './github';

const TOKEN_KEY = 'masterdata-maker.github.token';
const LAST_KEY = 'masterdata-maker.github.last';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SettingsStores {
  session: StorageLike | null;
  local: StorageLike | null;
}

function browserStores(): SettingsStores {
  // プライベートブラウズなどで使えなければ、覚えない
  const pick = (name: 'sessionStorage' | 'localStorage'): StorageLike | null => {
    try {
      return (globalThis as Record<string, unknown>)[name] as StorageLike | null ?? null;
    } catch {
      return null;
    }
  };
  return { session: pick('sessionStorage'), local: pick('localStorage') };
}

function safe<T>(f: () => T, fallback: T): T {
  try {
    return f();
  } catch {
    return fallback;
  }
}

export interface SavedToken {
  token: string;
  /** localStorage に覚えている */
  remembered: boolean;
}

export function loadToken(stores: SettingsStores = browserStores()): SavedToken | null {
  const local = safe(() => stores.local?.getItem(TOKEN_KEY) ?? null, null);
  if (local !== null && local !== '') return { token: local, remembered: true };
  const session = safe(() => stores.session?.getItem(TOKEN_KEY) ?? null, null);
  if (session !== null && session !== '') return { token: session, remembered: false };
  return null;
}

/** トークンを覚える。remember なら端末に、そうでなければこのタブの間だけ（もう一方からは消す） */
export function saveToken(token: string, remember: boolean, stores: SettingsStores = browserStores()): void {
  const [keep, drop] = remember ? [stores.local, stores.session] : [stores.session, stores.local];
  safe(() => drop?.removeItem(TOKEN_KEY), undefined);
  safe(() => keep?.setItem(TOKEN_KEY, token), undefined);
}

export function forgetToken(stores: SettingsStores = browserStores()): void {
  safe(() => stores.local?.removeItem(TOKEN_KEY), undefined);
  safe(() => stores.session?.removeItem(TOKEN_KEY), undefined);
}

export interface LastLocation {
  repo: string;
  branch: string;
  folder: string;
}

export function loadLastLocation(stores: SettingsStores = browserStores()): LastLocation | null {
  const text = safe(() => stores.local?.getItem(LAST_KEY) ?? null, null);
  if (text === null) return null;
  const data = safe(() => JSON.parse(text) as Partial<LastLocation>, null);
  if (data === null || typeof data.repo !== 'string' || typeof data.branch !== 'string' || typeof data.folder !== 'string') return null;
  return { repo: data.repo, branch: data.branch, folder: data.folder };
}

export function saveLastLocation(location: GitHubLocation, stores: SettingsStores = browserStores()): void {
  const value: LastLocation = { repo: `${location.repo.owner}/${location.repo.repo}`, branch: location.branch, folder: location.folder };
  safe(() => stores.local?.setItem(LAST_KEY, JSON.stringify(value)), undefined);
}
