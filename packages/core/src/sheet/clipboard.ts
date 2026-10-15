// クリップボードの変換（FR-CLP-01〜04）。Googleスプレッドシート・Excel と同じタブ区切りテキストを読み書きする。
import type { CellPos, CellRange } from './selection';

function needsQuote(cell: string): boolean {
  for (let i = 0; i < cell.length; i++) {
    const c = cell.charCodeAt(i);
    // タブ・LF・CR・"
    if (c === 9 || c === 10 || c === 13 || c === 34) return true;
  }
  return false;
}

/**
 * セルの文字列の表を TSV にする。タブ・改行・`"` を含むセルは `"` で囲み、中の `"` は `""` にする。
 * 行は `\n` でつなぎ、末尾に改行を付けない
 */
export function toTsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) => row.map((cell) => (needsQuote(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join('\t'))
    .join('\n');
}

function normalizeNewlines(s: string): string {
  return s.includes('\r') ? s.replaceAll('\r\n', '\n').replaceAll('\r', '\n') : s;
}

/** `"` で囲まれたセルを読む。囲みが正しくなければ null（閉じていない、または閉じた後にタブ・改行以外が続く） */
function readQuoted(text: string, start: number): { value: string; next: number } | null {
  let j = start + 1;
  let out = '';
  for (;;) {
    const q = text.indexOf('"', j);
    if (q < 0) return null;
    out += text.slice(j, q);
    if (text.charCodeAt(q + 1) === 34) {
      out += '"';
      j = q + 2;
      continue;
    }
    const k = q + 1;
    if (k < text.length) {
      const c = text.charCodeAt(k);
      if (c !== 9 && c !== 10 && c !== 13) return null;
    }
    return { value: normalizeNewlines(out), next: k };
  }
}

/** 囲まれていないセルを読む（次のタブ・改行まで。`"` は文字として扱う） */
function readPlain(text: string, start: number): { value: string; next: number } {
  let j = start;
  while (j < text.length) {
    const c = text.charCodeAt(j);
    if (c === 9 || c === 10 || c === 13) break;
    j++;
  }
  return { value: text.slice(start, j), next: j };
}

/**
 * TSV を読んでセルの文字列の表にする。
 * - `"` で囲まれたセルの中の改行・タブ・`""` を扱う。セルの中の CRLF と CR は LF にする
 * - 行の区切りは LF・CRLF・CR のどれでもよい。末尾の改行 1 つ（Excel が付ける）は行として数えない
 * - 囲みが正しくないセル（閉じていない、閉じた後に文字が続く）の `"` は文字としてそのまま扱う
 * - 行ごとの列数が違うときは、最も長い行に合わせて空文字で埋める
 * - 空のテキストは 1 行 1 列の空文字
 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  const n = text.length;
  let i = 0;
  for (;;) {
    const quoted = text.charCodeAt(i) === 34 ? readQuoted(text, i) : null;
    const field = quoted ?? readPlain(text, i);
    row.push(field.value);
    i = field.next;
    if (i >= n) {
      rows.push(row);
      break;
    }
    if (text.charCodeAt(i) === 9) {
      i++;
      continue;
    }
    // 行の区切り
    i += text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
    rows.push(row);
    row = [];
    if (i >= n) break;
  }
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  for (const r of rows) while (r.length < width) r.push('');
  return rows;
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/**
 * セルの文字列の表を HTML の表にする（クリップボードの text/html 用）。
 * セル内の改行は `<br>` にし、Excel でも同じセルに収まるよう `mso-data-placement:same-cell` を指定する
 */
export function toHtmlTable(rows: readonly (readonly string[])[]): string {
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(normalizeNewlines(cell)).replaceAll('\n', '<br>')}</td>`).join('')}</tr>`)
    .join('');
  return (
    '<meta charset="utf-8">' +
    '<style type="text/css">br{mso-data-placement:same-cell;}</style>' +
    `<table><tbody>${body}</tbody></table>`
  );
}

/** コピー元の大きさ */
export interface ClipSize {
  rows: number;
  cols: number;
}

export interface PastePlan {
  /** 実際に書き込む範囲（表示上の座標） */
  range: CellRange;
  /** コピー元を繰り返して敷き詰めたか */
  tiled: boolean;
  /** 書き込み先 (row, col) に対応するコピー元の位置（コピー元の左上が (0, 0)） */
  sourceOf(row: number, col: number): CellPos;
}

/**
 * 貼り付けの形を決める。
 * - 貼り付け先の行数・列数がどちらもコピー元のちょうど整数倍なら、コピー元を繰り返して貼り付け先全体を埋める
 *   （1 セルのコピーは、どの範囲に貼っても範囲全体を埋める。FR-CLP-03）
 * - それ以外は、貼り付け先の左上からコピー元の大きさで書く（表の端を越える分の扱いは呼び出し側が決める）
 * コピー元が空なら null
 */
export function planPaste(source: ClipSize, target: CellRange): PastePlan | null {
  if (source.rows <= 0 || source.cols <= 0) return null;
  const th = target.bottom - target.top + 1;
  const tw = target.right - target.left + 1;
  const fits = th % source.rows === 0 && tw % source.cols === 0;
  const range: CellRange = fits
    ? { ...target }
    : { top: target.top, left: target.left, bottom: target.top + source.rows - 1, right: target.left + source.cols - 1 };
  const tiled = fits && (th > source.rows || tw > source.cols);
  return {
    range,
    tiled,
    sourceOf(row: number, col: number): CellPos {
      return { row: (row - range.top) % source.rows, col: (col - range.left) % source.cols };
    },
  };
}
