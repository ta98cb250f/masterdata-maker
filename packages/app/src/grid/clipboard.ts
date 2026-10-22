// コピー・切り取り・貼り付け（FR-CLP-01〜07）。クリップボードとのやりとりは、見えない入力欄の copy / cut / paste のイベントで行う
// （ブラウザの許可の確認が出ない方法）。ここではイベントから受け取ったテキストとモデルの間の変換だけをする
import type { CellRange, ClipboardData } from '@masterdata-maker/core';
import { copyCells, extendTo, parseTsv, pasteCells, planPaste, selectCell, toHtmlTable, toTsv } from '@masterdata-maker/core';
import { selectionTarget } from '../commands/helpers';
import type { AppStore } from '../store/AppStore';

export interface CopiedText {
  tsv: string;
  html: string;
}

function normalizeNewlines(s: string): string {
  return s.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

/**
 * 選択範囲をコピーする（cut なら切り取り）。クリップボードに入れるテキストを返し、
 * 値・セル単位式・セル色・メモも持ち込めるよう、コピーした中身を store に覚えておく
 */
export function copySelection(store: AppStore, cut: boolean): CopiedText | null {
  const t = selectionTarget(store);
  const project = store.project;
  if (t === null || project === null) return null;
  const data = copyCells(project, {
    table: t.table.uid,
    rows: t.records,
    columns: t.columns,
    cut,
    effectiveValue: (_table, record, column) => t.calc.getCell(t.table, record, column).raw,
  });
  if (data === null) return null;
  // 式のエラーのセルは、Googleスプレッドシートと同じくエラー値をテキストにする
  t.records.forEach((uid, i) => {
    t.columns.forEach((name, j) => {
      const r = t.calc.getCell(t.table, uid, name);
      if (r.error !== undefined) data.text[i][j] = r.error.code;
    });
  });
  const tsv = toTsv(data.text);
  store.clipboard = { data, tsv };
  store.setClipboardMark({ table: t.table.uid, range: { ...t.range }, cut });
  return { tsv, html: toHtmlTable(data.text) };
}

/** クリップボードのテキストが本ツールの中でコピーしたものなら、その中身を使う */
export function clipboardDataFor(store: AppStore, text: string): ClipboardData {
  const internal = store.clipboard;
  if (internal !== null && normalizeNewlines(internal.tsv) === normalizeNewlines(text)) return internal.data;
  return { text: parseTsv(text) };
}

/** 貼り付ける範囲（選択範囲と、コピー元の大きさから。FR-CLP-03） */
export function pasteRange(store: AppStore, clip: ClipboardData): CellRange | null {
  const sheet = store.sheet();
  const sel = store.selection();
  if (sheet === null || sel === null || sheet.size.cols === 0) return null;
  const rows = clip.text.length;
  const cols = clip.text.reduce((m, r) => Math.max(m, r.length), 0);
  const target = sheet.size.rows === 0 ? { top: 0, left: sel.anchor.col, bottom: 0, right: sel.anchor.col } : sel.ranges[0];
  return planPaste({ rows, cols }, target)?.range ?? null;
}

/**
 * 貼り付ける（FR-CLP-03〜07）。1 セルでも変換できなければ全体を取りやめ、失敗したセルの一覧を示す（FR-CLP-04）。
 * レコードの末尾を超えた行は追加する（FR-CLP-05）
 */
export function pasteClipboard(store: AppStore, clip: ClipboardData, valuesOnly: boolean): boolean {
  const project = store.project;
  const sheet = store.sheet();
  const range = pasteRange(store, clip);
  if (project === null || sheet === null || range === null) return false;
  const rows: (number | null)[] = [];
  for (let r = range.top; r <= range.bottom; r++) rows.push(sheet.rowUids[r] ?? null);
  const columns: (string | null)[] = [];
  for (let c = range.left; c <= range.right; c++) columns.push(sheet.columns[c]?.name ?? null);
  const result = store.apply(pasteCells(project, { table: sheet.table.uid, rows, columns, clip, valuesOnly }));
  if (!result.ok) {
    store.showFailures('ui.paste.failedTitle', result.failures, (f) => (f.row === undefined ? undefined : range.top + f.row + 1));
    return false;
  }
  if (clip.source?.cut === true && !valuesOnly) store.clipboard = null;
  const after = store.sheet();
  if (after !== null) {
    const sel = extendTo(selectCell({ row: range.top, col: range.left }, after.size), { row: range.bottom, col: range.right }, after.size);
    store.setSelection(sel, { reveal: true });
  }
  return true;
}

/** クリップボードのテキストを貼り付ける（paste のイベントから） */
export function pasteText(store: AppStore, text: string, valuesOnly: boolean): boolean {
  if (text === '') return false;
  return pasteClipboard(store, clipboardDataFor(store, text), valuesOnly);
}
