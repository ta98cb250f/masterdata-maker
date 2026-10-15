// フィルタ（FR-SRT-03, 04, 06）。フィルタの状態はファイルに保存しない
import { compareNumeric } from './compare';

/**
 * 列ごとの条件。
 * - values: 値の一覧から選ぶ（表示の文字列の集合。空欄を含めるかどうかは includeEmpty）
 * - equals: 等しい。セルが数値で、条件の値も数値として読めるときは数値として比べる。それ以外は文字列として比べる
 * - contains: 表示の文字列に含む
 * - range: 数値としての値が min 以上 max 以下（省略した側は制限なし。数値でないセルは合わない）
 * - empty / notEmpty: 空欄 / 空欄以外
 * equals と contains は既定で大文字と小文字を区別しない
 */
export type FilterCondition =
  | { type: 'values'; values: ReadonlySet<string> | readonly string[]; includeEmpty: boolean }
  | { type: 'equals'; value: string; caseSensitive?: boolean }
  | { type: 'contains'; value: string; caseSensitive?: boolean }
  | { type: 'range'; min?: number | bigint; max?: number | bigint }
  | { type: 'empty' }
  | { type: 'notEmpty' };

/** 判定に使うセルの情報 */
export interface FilterCell {
  /** 表示の文字列 */
  text: string;
  /** 数値としての値（数値・int64・日時の列。日時はミリ秒など、条件の min / max と同じ単位）。無ければ null か省略 */
  value?: number | bigint | null;
  /** 空欄かどうか */
  empty: boolean;
}

export interface ColumnFilter {
  col: number;
  condition: FilterCondition;
}

type Predicate = (cell: FilterCell) => boolean;

/** 文字列を数値として読む（equals の条件の値用）。読めなければ null */
function parseNumber(s: string): number | bigint | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  // 安全な範囲を超える整数は bigint として正確に比べる
  if (!Number.isSafeInteger(n) && Number.isInteger(n)) {
    try {
      return BigInt(t);
    } catch {
      return n;
    }
  }
  return n;
}

function fold(s: string, caseSensitive: boolean | undefined): string {
  return caseSensitive ? s : s.toLowerCase();
}

/** 条件を判定関数にする（同じ条件で多くの行を調べるとき用） */
export function compileCondition(condition: FilterCondition): Predicate {
  switch (condition.type) {
    case 'values': {
      const set = condition.values instanceof Set ? condition.values : new Set(condition.values as readonly string[]);
      const includeEmpty = condition.includeEmpty;
      return (cell) => (cell.empty ? includeEmpty : set.has(cell.text));
    }
    case 'equals': {
      const target = fold(condition.value, condition.caseSensitive);
      const num = parseNumber(condition.value);
      const cs = condition.caseSensitive;
      return (cell) => {
        if (num !== null && cell.value !== undefined && cell.value !== null) return compareNumeric(cell.value, num) === 0;
        return fold(cell.empty ? '' : cell.text, cs) === target;
      };
    }
    case 'contains': {
      const target = fold(condition.value, condition.caseSensitive);
      const cs = condition.caseSensitive;
      return (cell) => fold(cell.empty ? '' : cell.text, cs).includes(target);
    }
    case 'range': {
      const { min, max } = condition;
      return (cell) => {
        const v = cell.value;
        if (cell.empty || v === undefined || v === null) return false;
        if (min !== undefined && compareNumeric(v, min) < 0) return false;
        if (max !== undefined && compareNumeric(v, max) > 0) return false;
        return true;
      };
    }
    case 'empty':
      return (cell) => cell.empty;
    case 'notEmpty':
      return (cell) => !cell.empty;
  }
}

/** 1 つのセルが条件に合うか */
export function matchesCondition(cell: FilterCell, condition: FilterCondition): boolean {
  return compileCondition(condition)(cell);
}

export interface VisibleRowsOptions {
  /** エラー・警告のあるセルがある行だけにする（FR-SRT-06） */
  onlyRowsWithIssues?: boolean;
  /** 行にエラー・警告のあるセルがあるか。onlyRowsWithIssues のときに使う */
  rowHasIssue?: (row: number) => boolean;
}

/**
 * 表示中の行の番号の一覧を求める。rows（並べ替えた後の行の番号の並び）のうち、
 * すべての列の条件に合う（AND）行を、順序を保って返す
 */
export function visibleRows(
  rows: readonly number[],
  filters: readonly ColumnFilter[],
  getCell: (row: number, col: number) => FilterCell,
  options: VisibleRowsOptions = {},
): number[] {
  const compiled = filters.map((f) => ({ col: f.col, test: compileCondition(f.condition) }));
  const issue = options.onlyRowsWithIssues ? options.rowHasIssue : undefined;
  return rows.filter((row) => {
    if (options.onlyRowsWithIssues && !(issue?.(row) ?? false)) return false;
    for (const f of compiled) if (!f.test(getCell(row, f.col))) return false;
    return true;
  });
}
