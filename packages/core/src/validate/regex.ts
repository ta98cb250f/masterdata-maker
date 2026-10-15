// 検査ルール regex の正規表現（RE2 構文。C-2）。コンパイルした結果をキャッシュする
import { RE2JS, RE2JSException } from 're2js';

export type CompiledRegex = { ok: true; regex: RE2JS } | { ok: false; detail: string };

const CACHE_LIMIT = 1000;
const cache = new Map<string, CompiledRegex>();

export function compileRegex(pattern: string): CompiledRegex {
  let compiled = cache.get(pattern);
  if (compiled === undefined) {
    try {
      compiled = { ok: true, regex: RE2JS.compile(pattern) };
    } catch (e) {
      if (!(e instanceof RE2JSException)) throw e;
      compiled = { ok: false, detail: e.message };
    }
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(pattern, compiled);
  }
  return compiled;
}

/** 部分一致（Googleスプレッドシートの REGEXMATCH と同じ）。正規表現が正しくなければ undefined */
export function regexTest(pattern: string, text: string): boolean | undefined {
  const compiled = compileRegex(pattern);
  return compiled.ok ? compiled.regex.test(text) : undefined;
}
