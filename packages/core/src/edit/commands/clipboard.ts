// コピー・切り取り・貼り付け（FR-CLP-01〜07）と、Ctrl+D / Ctrl+R（FR-FIL-04）
import type { Cell, RawValue } from '../../model/cell';
import { cellValue, isEmptyValue } from '../../model/cell';
import type { FieldDef } from '../../model/field';
import type { Project } from '../../model/project';
import { EditCode } from '../codes';
import { annotationsOf, columnLookup, editableTable, findTable, nextNumbers, numberingColumns, readonlyFailure, recordsOf, unique } from '../helpers';
import type { FieldTypeInfo, InputContext } from '../input';
import { cellFormula, convertValue, formatValueText, inputContext, keepSameInstant, parseCellInput } from '../input';
import type { CellData, IndexedRecord } from '../patch';
import { isCellDataEmpty, toCellData } from '../patch';
import type { CommandResult, EditFailure } from '../transaction';
import { emptyResult, failed, failure, inputFailure, TxBuilder } from '../transaction';
import { applyParsedInput } from './cells';

/** 計算済みの値（実効値。P-10）を返す。未入力やエラーなら undefined。datetime は ISO 8601 の文字列、リストは配列 */
export type EffectiveValueFn = (table: number, record: number, column: string) => RawValue | undefined;

/** 本ツールの中でコピーした範囲の中身（FR-CLP-06） */
export interface ClipSource {
  table: number;
  rows: number[];
  columns: string[];
  /** 列ごとの型（貼り付け先の型への変換に使う） */
  types: FieldTypeInfo[];
  /** セルの中身（値・セル単位式・セル色・メモ）。空のセルは null */
  cells: (CellData | null)[][];
  /** 計算済みの値（値のみ貼り付け。FR-CLP-07）。未入力は null */
  values: (RawValue | null)[][];
  /** 切り取りか。貼り付けたときに元のセルを空にする */
  cut: boolean;
}

export interface ClipboardData {
  /** セルのテキストの表（クリップボードの text/plain。他のアプリからの貼り付けはこれだけ） */
  text: string[][];
  /** 本ツールの中でのコピーなら、その中身 */
  source?: ClipSource;
}

export interface CopyArgs {
  table: number;
  /** コピーする行（表示順）のレコードの uid */
  rows: number[];
  /** コピーする列（表示順） */
  columns: string[];
  /** 計算済みの値。省略すると、セルに入っている値（式は `=` 付きのテキスト）を使う */
  effectiveValue?: EffectiveValueFn;
  cut?: boolean;
}

/**
 * 範囲をコピーする（モデルは変えない）。テキストは表示用の表記（Googleスプレッドシートと同じく計算結果）。
 * テーブルが無ければ null
 */
export function copyCells(project: Project, args: CopyArgs): ClipboardData | null {
  const table = findTable(project, args.table);
  if (table === undefined) return null;
  const columns = columnLookup(project, table);
  const records = recordsOf(project, table);
  const tz = inputContext(project).timeZone;
  const fields = args.columns.map((name) => columns.get(name));
  const text: string[][] = [];
  const cells: (CellData | null)[][] = [];
  const values: (RawValue | null)[][] = [];
  for (const uid of args.rows) {
    const record = records.get(uid);
    const textRow: string[] = [];
    const cellRow: (CellData | null)[] = [];
    const valueRow: (RawValue | null)[] = [];
    args.columns.forEach((name, j) => {
      const field = fields[j];
      const cell: Cell | undefined = field === undefined ? undefined : record?.cells.get(name);
      const data = toCellData(cell);
      cellRow.push(isCellDataEmpty(data) ? null : data);
      let value: RawValue | undefined;
      let t = '';
      if (args.effectiveValue !== undefined) {
        value = field === undefined || record === undefined ? undefined : args.effectiveValue(table.uid, uid, name);
        if (value !== undefined && field !== undefined) t = formatValueText(value, field.type, tz);
      } else {
        const raw = cellValue(cell);
        value = isEmptyValue(raw) ? undefined : raw;
        const formula = cellFormula(cell);
        if (formula !== undefined) t = `=${formula}`;
        else if (value !== undefined && field !== undefined) t = formatValueText(value, field.type, tz);
      }
      textRow.push(t);
      valueRow.push(value === undefined ? null : value);
    });
    text.push(textRow);
    cells.push(cellRow);
    values.push(valueRow);
  }
  return {
    text,
    source: {
      table: table.uid,
      rows: [...args.rows],
      columns: [...args.columns],
      types: fields.map((f) => (f === undefined ? { type: 'string' } : { type: f.type, enum_ref: f.enum_ref })),
      cells,
      values,
      cut: args.cut === true,
    },
  };
}

export interface PasteArgs {
  table: number;
  /**
   * 貼り付け先の行（表示順）のレコードの uid。null はレコードの末尾に追加する行（末尾にだけ置ける。FR-CLP-05）。
   * コピー元より大きい範囲なら、コピー元を繰り返して埋める（FR-CLP-03。範囲は sheet/clipboard.ts の planPaste で決める）
   */
  rows: (number | null)[];
  /** 貼り付け先の列（表示順）。null は表の右端を超えた列で、貼り付け全体を取りやめる */
  columns: (string | null)[];
  clip: ClipboardData;
  /** 値のみ貼り付け（FR-CLP-07）。計算済みの値を使い、セル色・メモ・式は持ち込まない */
  valuesOnly?: boolean;
}

type CellResult = { ok: true; data: CellData } | { ok: false; failure: EditFailure };

/**
 * 貼り付け（FR-CLP-03〜07）。テキストは貼り付け先の列の型に変換する。
 * 1 セルでも変換できない、または編集できない列（FR-EDT-06）が含まれるなら、全体を取りやめて失敗の一覧を返す（FR-CLP-04）。
 * レコードの末尾を超えた行は追加し、主キーを採番する（FR-CLP-05、DR-16）。
 * 本ツールの中でのコピーは、値・セル単位式・セル色・メモを持ち込み、切り取りなら元のセルを空にする（FR-CLP-06）
 */
export function pasteCells(project: Project, args: PasteArgs): CommandResult {
  return pasteInto(project, args, args.valuesOnly === true ? EditCode.opPasteValues : EditCode.opPaste);
}

function pasteInto(project: Project, args: PasteArgs, label: string): CommandResult {
  const found = editableTable(project, args.table);
  if (!found.ok) return failed(found.failures);
  const table = found.table;
  const clip = args.clip;
  const sr = clip.text.length;
  const sc = clip.text.reduce((m, row) => Math.max(m, row.length), 0);
  if (sr === 0 || sc === 0) return failure(EditCode.pasteEmpty, {}, { table: table.uid });
  if (args.rows.length === 0 || args.columns.length === 0) return emptyResult(label);
  if (args.columns.some((c) => c === null)) return failure(EditCode.pasteOutside, {}, { table: table.uid });
  const columnNames = args.columns as string[];

  const lookup = columnLookup(project, table);
  const records = recordsOf(project, table);
  const failures: EditFailure[] = [];
  for (const name of unique(columnNames)) {
    const column = lookup.get(name);
    if (column === undefined) failures.push({ code: EditCode.columnNotFound, params: { column: name }, table: table.uid, column: name });
    else {
      const ro = readonlyFailure(table.uid, column);
      if (ro !== null) failures.push(ro);
    }
  }
  const firstNew = args.rows.indexOf(null);
  if (firstNew >= 0 && args.rows.slice(firstNew).some((r) => r !== null)) {
    failures.push({ code: EditCode.invalidOrder, params: {}, table: table.uid });
  }
  for (const uid of args.rows) {
    if (uid !== null && !records.has(uid)) failures.push({ code: EditCode.recordNotFound, params: {}, table: table.uid, record: uid });
  }
  const source = clip.source;
  const cutSource = source !== undefined && source.cut && args.valuesOnly !== true ? source : undefined;
  const cutTable = cutSource === undefined ? undefined : findTable(project, cutSource.table);
  if (cutSource !== undefined && cutTable !== undefined) {
    const cutColumns = columnLookup(project, cutTable);
    for (const name of unique(cutSource.columns)) {
      const column = cutColumns.get(name);
      const ro = column === undefined ? null : readonlyFailure(cutTable.uid, column);
      if (ro !== null) failures.push(ro);
    }
  }
  if (failures.length > 0) return failed(failures);

  const ctx = inputContext(project);
  const mode: 'values' | 'internal' | 'text' = args.valuesOnly === true ? 'values' : source !== undefined ? 'internal' : 'text';
  const cache = new Map<string, CellResult>();
  const nextCells: CellData[][] = [];
  args.rows.forEach((uid, i) => {
    const row: CellData[] = [];
    const record = uid === null ? undefined : records.get(uid);
    columnNames.forEach((name, j) => {
      const si = i % sr;
      const sj = j % sc;
      const field = lookup.get(name) as FieldDef;
      const old = record?.cells.get(name);
      // 変換の結果はコピー元のセルと貼り付け先の列で決まるので、繰り返して埋めるときは使い回す
      const key = `${si}\u0000${sj}\u0000${name}`;
      let r = cache.get(key);
      if (r === undefined) {
        r = convertClipCell(clip, mode, si, sj, field, ctx);
        cache.set(key, r);
      }
      if (!r.ok) {
        failures.push({ ...r.failure, table: table.uid, record: uid ?? undefined, column: name, row: i, col: j });
        row.push({});
        return;
      }
      row.push(mergeTarget(r.data, mode, old, field));
    });
    nextCells.push(row);
  });
  if (failures.length > 0) return failed(failures);

  const b = new TxBuilder();
  b.touch(table.uid);
  // 切り取りの元を空にする（貼り付け先と重なるセルは、貼り付けで上書きするので飛ばす）
  if (cutSource !== undefined && cutTable !== undefined) {
    const targets = new Set<string>();
    if (cutTable.uid === table.uid) {
      for (const uid of args.rows) if (uid !== null) for (const name of columnNames) targets.add(`${uid}\u0000${name}`);
    }
    const cutRecords = recordsOf(project, cutTable);
    for (const uid of cutSource.rows) {
      const record = cutRecords.get(uid);
      if (record === undefined) continue;
      for (const name of cutSource.columns) {
        if (targets.has(`${uid}\u0000${name}`)) continue;
        b.setCell(cutTable.uid, uid, name, record.cells.get(name), null);
      }
    }
  }
  // 末尾を超えた行を追加する
  const newCount = firstNew < 0 ? 0 : args.rows.length - firstNew;
  const newUids: number[] = [];
  if (newCount > 0) {
    const numbering = numberingColumns(project, table).filter((c) => !columnNames.includes(c.name));
    const numbers = numbering.map((c) => nextNumbers(table, c, newCount));
    const items: IndexedRecord[] = [];
    for (let k = 0; k < newCount; k++) {
      const uid = project.uids.next();
      newUids.push(uid);
      const cells: [string, CellData][] = numbering.map((c, ci) => [c.name, { value: numbers[ci][k] }]);
      columnNames.forEach((name, j) => {
        const data = nextCells[firstNew + k][j];
        if (!isCellDataEmpty(data)) cells.push([name, data]);
      });
      items.push({ index: table.records.length + k, record: { uid, cells, extra: [] } });
    }
    b.add({ op: 'insertRecords', table: table.uid, items });
  }
  args.rows.forEach((uid, i) => {
    if (uid === null) return;
    const record = records.get(uid);
    columnNames.forEach((name, j) => b.setCell(table.uid, uid, name, record?.cells.get(name), nextCells[i][j]));
  });
  const focusRecords = args.rows.map((uid, i) => uid ?? newUids[i - firstNew]);
  return b.result(label, { table: table.uid, records: unique(focusRecords), columns: unique(columnNames) });
}

/** コピー元の 1 セルを、貼り付け先の列の型にする（貼り付け先のセルの今の中身にはよらない部分） */
function convertClipCell(
  clip: ClipboardData,
  mode: 'values' | 'internal' | 'text',
  si: number,
  sj: number,
  field: FieldDef,
  ctx: InputContext,
): CellResult {
  const text = clip.text[si]?.[sj] ?? '';
  const source = clip.source;
  if (mode === 'text' || (mode === 'values' && source === undefined)) {
    // 値のみ貼り付けでは、`=` で始まるテキストも式にしない
    const parsed = parseCellInput(text, field, ctx, mode === 'values' ? 'value' : 'input');
    if (!parsed.ok) return { ok: false, failure: inputFailure(parsed.error, { input: text }) };
    return { ok: true, data: applyParsedInput(parsed, {}, field.type) };
  }
  const src = source as ClipSource;
  const from = src.types[sj] ?? { type: 'string' };
  if (mode === 'values') {
    const value = src.values[si]?.[sj] ?? null;
    if (value === null) return { ok: true, data: {} };
    const conv = convertValue(value, from, field, ctx);
    if (!conv.ok) return { ok: false, failure: inputFailure(conv.error, { input: conv.text }) };
    return { ok: true, data: conv.value === undefined ? {} : { value: conv.value } };
  }
  const cell = src.cells[si]?.[sj] ?? null;
  if (cell === null) return { ok: true, data: {} };
  const data: CellData = { ...cell };
  delete data.value;
  if (cell.value !== undefined) {
    const conv = convertValue(cell.value, from, field, ctx);
    if (!conv.ok) return { ok: false, failure: inputFailure(conv.error, { input: conv.text }) };
    if (conv.value !== undefined) data.value = conv.value;
  }
  return { ok: true, data };
}

/** 貼り付け先のセルの今の中身と合わせる。テキスト・値のみの貼り付けは、貼り付け先のセル色・メモを残す */
function mergeTarget(data: CellData, mode: 'values' | 'internal' | 'text', old: Cell | undefined, field: FieldDef): CellData {
  const oldValue = cellValue(old);
  const next: CellData = mode === 'internal' ? { ...data } : { ...annotationsOf(old), ...data };
  if (next.value !== undefined) {
    const kept = keepSameInstant(next.value, isEmptyValue(oldValue) ? undefined : oldValue, field.type);
    if (kept !== undefined) next.value = kept;
  }
  return next;
}

export interface CopyDirectionArgs {
  table: number;
  /** 範囲の行（表示順）。Ctrl+D では先頭の行を残りの行へコピーする */
  rows: number[];
  /** 範囲の列（表示順）。Ctrl+R では先頭の列を残りの列へコピーする */
  columns: string[];
}

/**
 * Ctrl+D（FR-FIL-04）: 範囲の先頭の行を、残りの行へコピーする（値・式・セル色・メモ）。
 * 1 行だけを選んだときにすぐ上の行をコピーするなら、呼び出し側が上の行を先頭に含めて渡す
 */
export function fillDown(project: Project, args: CopyDirectionArgs): CommandResult {
  if (args.rows.length < 2) return emptyResult(EditCode.opFillDown);
  const clip = copyCells(project, { table: args.table, rows: [args.rows[0]], columns: args.columns });
  if (clip === null) {
    const found = editableTable(project, args.table);
    return failed(found.ok ? [] : found.failures);
  }
  return pasteInto(project, { table: args.table, rows: args.rows.slice(1), columns: args.columns, clip }, EditCode.opFillDown);
}

/** Ctrl+R（FR-FIL-04）: 範囲の先頭の列を、残りの列へコピーする（型が違えば変換する） */
export function fillRight(project: Project, args: CopyDirectionArgs): CommandResult {
  if (args.columns.length < 2) return emptyResult(EditCode.opFillRight);
  const clip = copyCells(project, { table: args.table, rows: args.rows, columns: [args.columns[0]] });
  if (clip === null) {
    const found = editableTable(project, args.table);
    return failed(found.ok ? [] : found.failures);
  }
  return pasteInto(project, { table: args.table, rows: args.rows, columns: args.columns.slice(1), clip }, EditCode.opFillRight);
}
