// 行の挿入・削除・複製・移動（FR-ROW-01〜04）と並べ替えの適用（FR-SRT-02）
import type { Project } from '../../model/project';
import type { Table } from '../../model/table';
import { primaryColumn } from '../../model/table';
import { EditCode } from '../codes';
import { columnsOf, editableTable, nextNumbers, numberingColumns, recordsOf, unique } from '../helpers';
import type { CellData, IndexedRecord, RecordData } from '../patch';
import { toRecordData } from '../patch';
import type { CommandResult, EditFailure } from '../transaction';
import { emptyResult, failed, TxBuilder } from '../transaction';

function missingRecords(project: Project, table: Table, uids: readonly number[]): EditFailure[] {
  const records = recordsOf(project, table);
  return unique(uids)
    .filter((uid) => !records.has(uid))
    .map((uid) => ({ code: EditCode.recordNotFound, params: {}, table: table.uid, record: uid }));
}

/** 採番する列ごとの番号（count 個） */
function numberCells(project: Project, table: Table, count: number): [string, CellData][][] {
  const columns = numberingColumns(project, table);
  const numbers = columns.map((c) => nextNumbers(table, c, count));
  return Array.from({ length: count }, (_, k) => columns.map((c, ci): [string, CellData] => [c.name, { value: numbers[ci][k] }]));
}

export interface InsertRowsArgs {
  table: number;
  /** 基準のレコード。null ならレコードの末尾（空のテーブルなど） */
  anchor: number | null;
  /** 基準のレコードの上か下か（ファイル上の順序で） */
  position: 'above' | 'below';
  count: number;
}

/** 行の挿入（FR-ROW-01）。主キーと自動採番の列には既存の最大値＋1 から番号を振る（DR-16） */
export function insertRows(project: Project, args: InsertRowsArgs): CommandResult {
  const found = editableTable(project, args.table);
  if (!found.ok) return failed(found.failures);
  const table = found.table;
  const count = Math.max(0, Math.floor(args.count));
  if (count === 0) return emptyResult(EditCode.opInsertRows);
  let index = table.records.length;
  if (args.anchor !== null) {
    const i = table.records.findIndex((r) => r.uid === args.anchor);
    if (i < 0) return failed(missingRecords(project, table, [args.anchor]));
    index = args.position === 'above' ? i : i + 1;
  }
  const numbered = numberCells(project, table, count);
  const items: IndexedRecord[] = numbered.map((cells, k) => ({ index: index + k, record: { uid: project.uids.next(), cells, extra: [] } }));
  const b = new TxBuilder();
  b.add({ op: 'insertRecords', table: table.uid, items });
  return b.result(EditCode.opInsertRows, { table: table.uid, records: items.map((i) => i.record.uid), columns: [] });
}

export interface RowsArgs {
  table: number;
  records: number[];
}

/** 行の削除（FR-ROW-02） */
export function deleteRows(project: Project, args: RowsArgs): CommandResult {
  const found = editableTable(project, args.table);
  if (!found.ok) return failed(found.failures);
  const table = found.table;
  const missing = missingRecords(project, table, args.records);
  if (missing.length > 0) return failed(missing);
  if (args.records.length === 0) return emptyResult(EditCode.opDeleteRows);
  const b = new TxBuilder();
  b.add({ op: 'deleteRecords', table: table.uid, records: unique(args.records) });
  return b.result(EditCode.opDeleteRows, { table: table.uid, records: unique(args.records), columns: [] });
}

/**
 * 行の複製（FR-ROW-03）。複製は、選んだ行のうちファイル上で最後の行のすぐ後に、ファイル上の順で置く。
 * 主キーと自動採番の列は採番し直す。整数でない主キーは重複しないよう空にする
 */
export function duplicateRows(project: Project, args: RowsArgs): CommandResult {
  const found = editableTable(project, args.table);
  if (!found.ok) return failed(found.failures);
  const table = found.table;
  const missing = missingRecords(project, table, args.records);
  if (missing.length > 0) return failed(missing);
  const selected = new Set(args.records);
  if (selected.size === 0) return emptyResult(EditCode.opDuplicateRows);
  const sources = table.records.filter((r) => selected.has(r.uid));
  const last = table.records.findIndex((r) => r.uid === sources[sources.length - 1].uid);
  const numbered = numberCells(project, table, sources.length);
  const primary = primaryColumn(columnsOf(project, table));
  const items: IndexedRecord[] = sources.map((source, k) => {
    const data: RecordData = toRecordData(source);
    const replaced = new Map(numbered[k]);
    const cells: [string, CellData][] = [];
    for (const [name, cell] of data.cells) {
      if (replaced.has(name)) continue;
      if (primary !== undefined && name === primary.name) continue;
      cells.push([name, cell]);
    }
    cells.unshift(...numbered[k]);
    return { index: last + 1 + k, record: { uid: project.uids.next(), cells, extra: data.extra } };
  });
  const b = new TxBuilder();
  b.add({ op: 'insertRecords', table: table.uid, items });
  return b.result(EditCode.opDuplicateRows, { table: table.uid, records: items.map((i) => i.record.uid), columns: [] });
}

export interface MoveRowsArgs extends RowsArgs {
  /** この行の前へ移す。null ならレコードの末尾へ。移す行そのものは指定できない */
  before: number | null;
}

/** 行の移動（FR-ROW-04）。移す行はファイル上の順を保ってまとめて移し、ファイル上の順序も変わる */
export function moveRows(project: Project, args: MoveRowsArgs): CommandResult {
  const found = editableTable(project, args.table);
  if (!found.ok) return failed(found.failures);
  const table = found.table;
  const missing = missingRecords(project, table, args.before === null ? args.records : [...args.records, args.before]);
  if (missing.length > 0) return failed(missing);
  const moving = new Set(args.records);
  if (args.before !== null && moving.has(args.before)) {
    return failed([{ code: EditCode.invalidMoveTarget, params: {}, table: table.uid, record: args.before }]);
  }
  if (moving.size === 0) return emptyResult(EditCode.opMoveRows);
  const block = table.records.filter((r) => moving.has(r.uid)).map((r) => r.uid);
  const rest = table.records.filter((r) => !moving.has(r.uid)).map((r) => r.uid);
  const at = args.before === null ? rest.length : rest.indexOf(args.before);
  const order = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  if (order.every((uid, i) => table.records[i].uid === uid)) return emptyResult(EditCode.opMoveRows);
  const b = new TxBuilder();
  b.add({ op: 'setRecordOrder', table: table.uid, order });
  return b.result(EditCode.opMoveRows, { table: table.uid, records: block, columns: [] });
}

export interface ApplySortArgs {
  table: number;
  /** 表示中の並び（並べ替えた後）のレコードの uid */
  order: number[];
}

/**
 * 並べ替えの適用（FR-SRT-02）: 表示中の並びでファイル上の順序を書き換える。
 * フィルタで一部の行だけを渡したときは、それらの行が今占めている位置に、渡した順で並べる（他の行は動かさない）
 */
export function applySortOrder(project: Project, args: ApplySortArgs): CommandResult {
  const found = editableTable(project, args.table);
  if (!found.ok) return failed(found.failures);
  const table = found.table;
  const missing = missingRecords(project, table, args.order);
  if (missing.length > 0) return failed(missing);
  if (new Set(args.order).size !== args.order.length) return failed([{ code: EditCode.invalidOrder, params: {}, table: table.uid }]);
  const listed = new Set(args.order);
  const order = table.records.map((r) => r.uid);
  let next = 0;
  for (let i = 0; i < order.length; i++) {
    if (listed.has(order[i])) order[i] = args.order[next++];
  }
  if (order.every((uid, i) => table.records[i].uid === uid)) return emptyResult(EditCode.opApplySort);
  const b = new TxBuilder();
  b.add({ op: 'setRecordOrder', table: table.uid, order });
  return b.result(EditCode.opApplySort, { table: table.uid, records: [], columns: [] });
}
