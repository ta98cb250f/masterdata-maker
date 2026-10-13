// 検索と置換（FR-FND-01〜04）。照合には re2js（RE2 構文）を使う
import { RE2JS, RE2JSException } from 're2js';

export interface FindOptions {
  /** 検索語 */
  query: string;
  /** 大文字と小文字を区別する（既定は区別しない。Googleスプレッドシートと同じ） */
  matchCase: boolean;
  /** セル全体が一致するものだけ */
  entireCell: boolean;
  /** 検索語を正規表現（RE2 構文）として扱う */
  regex: boolean;
  /** 式の中も検索する。照合の対象のテキストは呼び出し側が選ぶので、ここでは値として持つだけ */
  searchFormulas: boolean;
}

export function defaultFindOptions(query = ''): FindOptions {
  return { query, matchCase: false, entireCell: false, regex: false, searchFormulas: false };
}

export interface TextMatcher {
  /** テキストに一致する部分があるか（セル全体の一致では、テキスト全体が一致するか） */
  test(text: string): boolean;
  /** 一致する部分の数 */
  countMatches(text: string): number;
  /**
   * 一致する部分をすべて置き換えたテキスト。一致が無ければ元のテキストのまま。
   * 正規表現では置換の文字列の `$1`〜`$99`・`$<名前>` をグループ、`$0` と `$&` を一致した全体、`$$` を `$` にする。
   * 正規表現でなければ置換の文字列をそのまま使う
   */
  replace(text: string, replacement: string): string;
}

/** 文言コード付きのエラー（文言は i18n の sheet.json） */
export interface FindError {
  code: 'sheet.find.error.emptyQuery' | 'sheet.find.error.invalidRegex';
  params: Record<string, string>;
}

export type MatcherResult = { ok: true; matcher: TextMatcher } | { ok: false; error: FindError };

/** 置換の文字列のグループ参照を展開する */
function expandTemplate(template: string, groups: readonly (string | null)[], named: Record<string, number>): string {
  if (!template.includes('$')) return template;
  const groupCount = groups.length - 1;
  let out = '';
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch !== '$' || i + 1 >= template.length) {
      out += ch;
      i++;
      continue;
    }
    const next = template[i + 1];
    if (next === '$') {
      out += '$';
      i += 2;
      continue;
    }
    if (next === '&') {
      out += groups[0] ?? '';
      i += 2;
      continue;
    }
    if (next >= '0' && next <= '9') {
      // 2 桁が有効なグループ番号なら 2 桁として読む（JavaScript の置換と同じ）
      const two = template[i + 2];
      if (two !== undefined && two >= '0' && two <= '9') {
        const n2 = Number(next + two);
        if (n2 >= 1 && n2 <= groupCount) {
          out += groups[n2] ?? '';
          i += 3;
          continue;
        }
      }
      const n1 = Number(next);
      if (n1 <= groupCount) {
        out += groups[n1] ?? '';
        i += 2;
        continue;
      }
      out += '$';
      i++;
      continue;
    }
    if (next === '<') {
      const close = template.indexOf('>', i + 2);
      if (close > 0) {
        const name = template.slice(i + 2, close);
        const idx = named[name];
        if (idx !== undefined) {
          out += groups[idx] ?? '';
          i = close + 1;
          continue;
        }
      }
    }
    out += '$';
    i++;
  }
  return out;
}

/** 検索の設定から照合器を作る。検索語が空、または正規表現の構文が正しくなければエラー */
export function createMatcher(options: FindOptions): MatcherResult {
  if (options.query === '') return { ok: false, error: { code: 'sheet.find.error.emptyQuery', params: {} } };
  const body = options.regex ? options.query : RE2JS.quote(options.query);
  const source = options.entireCell ? `\\A(?:${body})\\z` : body;
  let pattern: RE2JS;
  try {
    pattern = RE2JS.compile(source, options.matchCase ? 0 : RE2JS.CASE_INSENSITIVE);
  } catch (e) {
    if (e instanceof RE2JSException) {
      return { ok: false, error: { code: 'sheet.find.error.invalidRegex', params: { detail: e.message } } };
    }
    throw e;
  }
  const groupCount = pattern.groupCount();
  const named = pattern.namedGroups();
  const literal = !options.regex;
  return {
    ok: true,
    matcher: {
      test: (text) => pattern.test(text),
      countMatches: (text) => {
        let n = 0;
        pattern.matcher(text).replaceAll(() => {
          n++;
          return '';
        });
        return n;
      },
      replace: (text, replacement) => {
        if (!pattern.test(text)) return text;
        return pattern.matcher(text).replaceAll((...args: unknown[]) => {
          if (literal) return replacement;
          // 引数は String.prototype.replace の置換関数と同じ（一致した全体, グループ 1.., 位置, 入力, …）
          const groups = args.slice(0, groupCount + 1).map((g) => (typeof g === 'string' ? g : null));
          return expandTemplate(replacement, groups, named);
        });
      },
    },
  };
}
