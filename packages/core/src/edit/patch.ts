// パッチ（最小単位の変更。計画書 §4.2）。
// パッチは構造化複製でそのまま送れるプレーンなデータにする（RichCell のインスタンスは持たない）。
// 画面のメインスレッドと検査用の Web Worker が同じパッチを applyPatch で当て、同じ状態にする
import type { Cell, ExtraValue, RawValue } from '../model/cell';
import { isEmptyValue, RichCell } from '../model/cell';
import type { ColorDef, CommonPartName, EnumDef } from '../model/common';
import type { Diagnostic } from '../model/diagnostic';
import type { FieldDef } from '../model/field';
import { cloneFieldDef, cloneRawValue } from '../model/field';
import type { Project } from '../model/project';
import { compareNames } from '../model/project';
import type { TableProto } from '../model/proto';
import { cloneTableProto, protoAfterColumnChange } from '../model/proto';
import type { SourceFile } from '../model/source';
import type { Table, TableRecord, TableView } from '../model/table';
import { tableColumns } from '../model/table';
import { UidAllocator } from '../model/uid';

/** セルの中身（プレーンな形）。空のセルは null で表す */
export interface CellData {
  value?: RawValue;
  /** セル単位式（先頭の `=` は付けない。P-04） */
  override?: string;
  color?: string;
  comment?: string;
  extra?: [string, ExtraValue][];
}

export interface RecordData {
  uid: number;
  cells: [string, CellData][];
  extra: [string, ExtraValue][];
}

export interface TableData {
  uid: number;
  name: string;
  display_name?: string;
  fields: FieldDef[];
  records: RecordData[];
  view: TableView;
  proto?: TableProto;
  source: SourceFile | null;
  diagnostics: Diagnostic[];
}

export interface CellChange {
  record: number;
  /** 列名 */
  column: string;
  /** null は空のセル（値・式・色・メモのどれも無い） */
  cell: CellData | null;
}

/** 位置付きのレコード。index は挿入した後の配列での位置 */
export interface IndexedRecord {
  index: number;
  record: RecordData;
}

/**
 * 列の変更の後のフィールド番号（P-63）。省略すれば変更に合わせて決める（protoAfterColumnChange）。
 * 逆のパッチは変更前の番号をそのまま持つ（null は `proto` の無いテーブル）
 */
interface ProtoAfter {
  proto?: TableProto | null;
}

/** テーブルは内部の uid、レコードは uid、列は名前で指す */
export type Patch =
  | { op: 'setCells'; table: number; cells: CellChange[] }
  /** items は index の昇順 */
  | { op: 'insertRecords'; table: number; items: IndexedRecord[] }
  | { op: 'deleteRecords'; table: number; records: number[] }
  /** 全レコードの uid の並び */
  | { op: 'setRecordOrder'; table: number; order: number[] }
  /** index は table.fields（共通列を含まない）の中の位置。cells はレコードの uid → セル */
  | ({ op: 'insertField'; table: number; index: number; field: FieldDef; cells: [number, CellData][] } & ProtoAfter)
  | ({ op: 'deleteField'; table: number; name: string } & ProtoAfter)
  /** 列名は変えない（列名の変更は renameField） */
  | ({ op: 'updateField'; table: number; name: string; field: FieldDef } & ProtoAfter)
  /** 列定義の名前と、各レコードのセルのキーを変える */
  | ({ op: 'renameField'; table: number; from: string; to: string } & ProtoAfter)
  /** 各レコードのセルのキーだけを変える（共通列の名前の変更に使う） */
  | { op: 'renameCellKey'; table: number; from: string; to: string }
  /** table.fields の名前の並び */
  | ({ op: 'setFieldOrder'; table: number; order: string[] } & ProtoAfter)
  | { op: 'setView'; table: number; view: TableView }
  | { op: 'setTableName'; table: number; name: string }
  | { op: 'setTableDisplayName'; table: number; displayName: string | null }
  | { op: 'addTable'; table: TableData }
  | { op: 'removeTable'; table: number }
  | { op: 'setCommon'; part: 'enums'; items: EnumDef[]; isDefault: boolean }
  /**
   * rename は共通列の名前の変更（フィールド番号を引き継ぐ）。protos は変更後の各テーブルのフィールド番号
   * （省略すれば変更に合わせて決める。逆のパッチは変更前の番号を持つ）
   */
  | {
      op: 'setCommon';
      part: 'base_fields';
      items: FieldDef[];
      isDefault: boolean;
      rename?: { from: string; to: string };
      protos?: [number, TableProto | null][];
    }
  | { op: 'setCommon'; part: 'colors'; items: ColorDef[]; isDefault: boolean };

export type PatchOp = Patch['op'];

/** パッチを当てられない（指す先が無い・既にある）。古いパッチを当てたときなどのプログラムの誤り */
export class PatchError extends Error {
  constructor(
    readonly op: PatchOp,
    message: string,
  ) {
    super(`${op}: ${message}`);
    this.name = 'PatchError';
  }
}

// ---- プレーンな形との変換 ----

export function cloneExtraValue(value: ExtraValue): ExtraValue {
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [k, cloneExtraValue(v)]));
  if (Array.isArray(value)) return value.map(cloneExtraValue);
  return value;
}

function cloneExtraEntries(entries: readonly [string, ExtraValue][]): [string, ExtraValue][] {
  return entries.map(([k, v]) => [k, cloneExtraValue(v)]);
}

function nonEmptyString(s: string | undefined): string | undefined {
  return s === undefined || s === '' ? undefined : s;
}

/** セルをプレーンな形にする（値は複製する）。空の文字列の式・色・メモと、未入力の値（DR-15、P-11）は持たない */
export function toCellData(cell: Cell | undefined): CellData {
  const data: CellData = {};
  if (cell === undefined) return data;
  if (!(cell instanceof RichCell)) {
    if (!isEmptyValue(cell)) data.value = cloneRawValue(cell);
    return data;
  }
  if (!isEmptyValue(cell.value)) data.value = cloneRawValue(cell.value as RawValue);
  const override = nonEmptyString(cell.override);
  const color = nonEmptyString(cell.color);
  const comment = nonEmptyString(cell.comment);
  if (override !== undefined) data.override = override;
  if (color !== undefined) data.color = color;
  if (comment !== undefined) data.comment = comment;
  if (cell.extra !== undefined && cell.extra.length > 0) data.extra = cloneExtraEntries(cell.extra);
  return data;
}

/** 値・式・色・メモのどれも無いか */
export function isCellDataEmpty(data: CellData | null | undefined): boolean {
  if (data === null || data === undefined) return true;
  return (
    isEmptyValue(data.value) &&
    nonEmptyString(data.override) === undefined &&
    nonEmptyString(data.color) === undefined &&
    nonEmptyString(data.comment) === undefined &&
    (data.extra === undefined || data.extra.length === 0)
  );
}

/** プレーンな形をセルにする。値だけなら値そのもの、空なら undefined */
export function fromCellData(data: CellData | null | undefined): Cell | undefined {
  if (data === null || data === undefined || isCellDataEmpty(data)) return undefined;
  const value = isEmptyValue(data.value) ? undefined : cloneRawValue(data.value as RawValue);
  const override = nonEmptyString(data.override);
  const color = nonEmptyString(data.color);
  const comment = nonEmptyString(data.comment);
  const extra = data.extra !== undefined && data.extra.length > 0 ? cloneExtraEntries(data.extra) : undefined;
  if (override === undefined && color === undefined && comment === undefined && extra === undefined) return value;
  return new RichCell({ value, override, color, comment, extra });
}

function rawEquals(a: RawValue | undefined, b: RawValue | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => rawEquals(item, b[i]));
  }
  // number と bigint は区別する（型が違えば別の値として書き出される）
  return a === b || (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b));
}

function extraEquals(a: ExtraValue, b: ExtraValue): boolean {
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false;
    const bs = [...b];
    return [...a].every(([k, v], i) => bs[i][0] === k && extraEquals(v, bs[i][1]));
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => extraEquals(item, b[i]));
  }
  return a === b;
}

/** 2 つのセルが同じ中身か（未入力の値や空の文字列は無いものとして比べる） */
export function cellDataEquals(a: CellData | null | undefined, b: CellData | null | undefined): boolean {
  const x = a ?? {};
  const y = b ?? {};
  const xe = x.extra ?? [];
  const ye = y.extra ?? [];
  return (
    rawEquals(isEmptyValue(x.value) ? undefined : x.value, isEmptyValue(y.value) ? undefined : y.value) &&
    nonEmptyString(x.override) === nonEmptyString(y.override) &&
    nonEmptyString(x.color) === nonEmptyString(y.color) &&
    nonEmptyString(x.comment) === nonEmptyString(y.comment) &&
    xe.length === ye.length &&
    xe.every(([k, v], i) => ye[i][0] === k && extraEquals(v, ye[i][1]))
  );
}

export function toRecordData(record: TableRecord): RecordData {
  return {
    uid: record.uid,
    cells: [...record.cells].map(([name, cell]) => [name, toCellData(cell)]),
    extra: cloneExtraEntries(record.extra),
  };
}

export function fromRecordData(data: RecordData): TableRecord {
  const cells = new Map<string, Cell>();
  for (const [name, cellData] of data.cells) {
    const cell = fromCellData(cellData);
    if (cell !== undefined) cells.set(name, cell);
  }
  return { uid: data.uid, cells, extra: cloneExtraEntries(data.extra) };
}

export function cloneView(view: TableView): TableView {
  const copy: TableView = { column_widths: view.column_widths.map(([name, width]) => [name, width]) };
  if (view.frozen_columns !== undefined) copy.frozen_columns = view.frozen_columns;
  if (view.hidden_columns !== undefined) copy.hidden_columns = [...view.hidden_columns];
  return copy;
}

function cloneDiagnostic(d: Diagnostic): Diagnostic {
  return d.params === undefined ? { ...d } : { ...d, params: { ...d.params } };
}

export function toTableData(table: Table): TableData {
  const data: TableData = {
    uid: table.uid,
    name: table.name,
    fields: table.fields.map(cloneFieldDef),
    records: table.records.map(toRecordData),
    view: cloneView(table.view),
    source: table.source === null ? null : { ...table.source },
    diagnostics: table.diagnostics.map(cloneDiagnostic),
  };
  if (table.display_name !== undefined) data.display_name = table.display_name;
  if (table.proto !== undefined) data.proto = cloneTableProto(table.proto);
  return data;
}

export function fromTableData(data: TableData): Table {
  const table: Table = {
    kind: 'table',
    uid: data.uid,
    name: data.name,
    fields: data.fields.map(cloneFieldDef),
    records: data.records.map(fromRecordData),
    view: cloneView(data.view),
    source: data.source === null ? null : { ...data.source },
    diagnostics: data.diagnostics.map(cloneDiagnostic),
  };
  if (data.display_name !== undefined) table.display_name = data.display_name;
  if (data.proto !== undefined) table.proto = cloneTableProto(data.proto);
  return table;
}

export function cloneEnumDef(def: EnumDef): EnumDef {
  return { ...def, values: [...def.values] };
}

export function cloneColorDef(def: ColorDef): ColorDef {
  return { ...def };
}

// ---- 版数（変更のたびに増える数。画面の再描画の判断と、未保存の判定のメモ化に使う） ----

interface EditState {
  /** プロジェクト全体で増え続ける数。版数はここから配るので、同じ値が二度出ない */
  counter: number;
  tables: Map<number, number>;
  /** レコードの増減の版数（uid → レコードの索引のキャッシュに使う） */
  recordShapes: Map<number, number>;
  common: number;
  tableList: number;
}

const states = new WeakMap<Project, EditState>();

function stateOf(project: Project): EditState {
  let state = states.get(project);
  if (state === undefined) {
    state = { counter: 0, tables: new Map(), recordShapes: new Map(), common: 0, tableList: 0 };
    states.set(project, state);
  }
  return state;
}

function nextVersion(project: Project): number {
  return ++stateOf(project).counter;
}

/** テーブルの版数。テーブルの中身（列定義・レコード・表示設定・名前・共通列）が変わるたびに変わる */
export function tableVersion(project: Project, tableUid: number): number {
  return stateOf(project).tables.get(tableUid) ?? 0;
}

/** 共通設定（列挙型・共通列・セル色）の版数 */
export function commonVersion(project: Project): number {
  return stateOf(project).common;
}

/** テーブルの一覧（追加・削除・名前の変更）の版数 */
export function tableListVersion(project: Project): number {
  return stateOf(project).tableList;
}

function bumpTable(project: Project, tableUid: number): void {
  stateOf(project).tables.set(tableUid, nextVersion(project));
}

function bumpRecordShape(project: Project, tableUid: number): void {
  stateOf(project).recordShapes.set(tableUid, nextVersion(project));
}

// ---- レコードの索引 ----

const recordIndexes = new WeakMap<Table, { shape: number; map: Map<number, TableRecord> }>();

/** uid → レコード。レコードの増減があるまでキャッシュする（モデルはパッチ以外で書き換えない前提） */
export function recordIndex(project: Project, table: Table): Map<number, TableRecord> {
  const shape = stateOf(project).recordShapes.get(table.uid) ?? 0;
  const cached = recordIndexes.get(table);
  if (cached !== undefined && cached.shape === shape && cached.map.size === table.records.length) return cached.map;
  const map = new Map<number, TableRecord>();
  for (const record of table.records) map.set(record.uid, record);
  recordIndexes.set(table, { shape, map });
  return map;
}

// ---- 適用 ----

function tableOf(project: Project, uid: number, op: PatchOp): Table {
  const table = project.tables.find((t) => t.uid === uid);
  if (table === undefined) throw new PatchError(op, `table ${uid} not found`);
  return table;
}

function recordOf(project: Project, table: Table, uid: number, op: PatchOp): TableRecord {
  const record = recordIndex(project, table).get(uid);
  if (record === undefined) throw new PatchError(op, `record ${uid} not found in table ${table.uid}`);
  return record;
}

function fieldIndexOf(table: Table, name: string, op: PatchOp): number {
  const i = table.fields.findIndex((f) => f.name === name);
  if (i < 0) throw new PatchError(op, `field ${name} not found in table ${table.uid}`);
  return i;
}

/** 名前の列が（共通列か、このテーブルの列として）あるか */
function hasColumn(project: Project, table: Table, name: string): boolean {
  return project.common.base_fields.items.some((f) => f.name === name) || table.fields.some((f) => f.name === name);
}

/** 内部番号の採番を、使われた番号より先に進める（Worker 側のモデルでも採番が重ならないように） */
function reserveUid(project: Project, uid: number): void {
  if (uid >= project.uids.peek()) project.uids = new UidAllocator(uid + 1);
}

function sortTables(project: Project): void {
  project.tables.sort((a, b) => compareNames(a.name, b.name));
}

function isTableNameUsed(project: Project, name: string, exceptUid: number): boolean {
  return (
    project.tables.some((t) => t.uid !== exceptUid && t.name === name) ||
    project.brokenTables.some((t) => t.uid !== exceptUid && t.name === name)
  );
}

function renameCellKeys(table: Table, from: string, to: string, op: PatchOp): void {
  for (const record of table.records) {
    if (record.cells.has(to)) throw new PatchError(op, `record ${record.uid} already has a cell ${to}`);
  }
  for (const record of table.records) {
    const cell = record.cells.get(from);
    if (cell === undefined) continue;
    record.cells.delete(from);
    record.cells.set(to, cell);
  }
}

function applySetCells(project: Project, p: Extract<Patch, { op: 'setCells' }>): Patch {
  const table = tableOf(project, p.table, p.op);
  const index = recordIndex(project, table);
  // 先にすべての指す先を確かめる（途中で失敗してモデルが半端に変わらないように）
  for (const change of p.cells) {
    if (!index.has(change.record)) throw new PatchError(p.op, `record ${change.record} not found in table ${table.uid}`);
  }
  const inverse: CellChange[] = [];
  for (const change of p.cells) {
    const record = index.get(change.record) as TableRecord;
    const old = record.cells.get(change.column);
    inverse.push({ record: change.record, column: change.column, cell: old === undefined ? null : toCellData(old) });
    const next = fromCellData(change.cell);
    if (next === undefined) record.cells.delete(change.column);
    else record.cells.set(change.column, next);
  }
  inverse.reverse();
  bumpTable(project, table.uid);
  return { op: 'setCells', table: table.uid, cells: inverse };
}

function applyInsertRecords(project: Project, p: Extract<Patch, { op: 'insertRecords' }>): Patch {
  const table = tableOf(project, p.table, p.op);
  const existing = recordIndex(project, table);
  const total = table.records.length + p.items.length;
  const seen = new Set<number>();
  let last = -1;
  for (const item of p.items) {
    if (!Number.isInteger(item.index) || item.index <= last || item.index >= total) {
      throw new PatchError(p.op, `invalid index ${item.index}`);
    }
    if (existing.has(item.record.uid) || seen.has(item.record.uid)) {
      throw new PatchError(p.op, `record ${item.record.uid} already exists`);
    }
    seen.add(item.record.uid);
    last = item.index;
  }
  // 挿入後の位置の順に、元のレコードと新しいレコードを合わせる
  const out: TableRecord[] = new Array(total);
  let oi = 0;
  let ii = 0;
  for (let pos = 0; pos < total; pos++) {
    if (ii < p.items.length && p.items[ii].index === pos) {
      out[pos] = fromRecordData(p.items[ii].record);
      reserveUid(project, p.items[ii].record.uid);
      ii++;
    } else {
      out[pos] = table.records[oi++];
    }
  }
  table.records = out;
  bumpRecordShape(project, table.uid);
  bumpTable(project, table.uid);
  return { op: 'deleteRecords', table: table.uid, records: p.items.map((item) => item.record.uid) };
}

function applyDeleteRecords(project: Project, p: Extract<Patch, { op: 'deleteRecords' }>): Patch {
  const table = tableOf(project, p.table, p.op);
  const targets = new Set(p.records);
  const index = recordIndex(project, table);
  for (const uid of targets) {
    if (!index.has(uid)) throw new PatchError(p.op, `record ${uid} not found in table ${table.uid}`);
  }
  const kept: TableRecord[] = [];
  const removed: IndexedRecord[] = [];
  table.records.forEach((record, i) => {
    if (targets.has(record.uid)) removed.push({ index: i, record: toRecordData(record) });
    else kept.push(record);
  });
  table.records = kept;
  bumpRecordShape(project, table.uid);
  bumpTable(project, table.uid);
  return { op: 'insertRecords', table: table.uid, items: removed };
}

function applySetRecordOrder(project: Project, p: Extract<Patch, { op: 'setRecordOrder' }>): Patch {
  const table = tableOf(project, p.table, p.op);
  const index = recordIndex(project, table);
  if (p.order.length !== table.records.length || new Set(p.order).size !== p.order.length) {
    throw new PatchError(p.op, 'order is not a permutation of the records');
  }
  const next = p.order.map((uid) => {
    const record = index.get(uid);
    if (record === undefined) throw new PatchError(p.op, `record ${uid} not found in table ${table.uid}`);
    return record;
  });
  const old = table.records.map((r) => r.uid);
  table.records = next;
  bumpTable(project, table.uid);
  return { op: 'setRecordOrder', table: table.uid, order: old };
}

function applyInsertField(project: Project, p: Extract<Patch, { op: 'insertField' }>): FieldPatch {
  const table = tableOf(project, p.table, p.op);
  if (!Number.isInteger(p.index) || p.index < 0 || p.index > table.fields.length) {
    throw new PatchError(p.op, `invalid index ${p.index}`);
  }
  if (table.fields.some((f) => f.name === p.field.name)) {
    throw new PatchError(p.op, `field ${p.field.name} already exists in table ${table.uid}`);
  }
  const records = p.cells.map(([uid]) => recordOf(project, table, uid, p.op));
  table.fields.splice(p.index, 0, cloneFieldDef(p.field));
  p.cells.forEach(([, data], i) => {
    const cell = fromCellData(data);
    if (cell === undefined) records[i].cells.delete(p.field.name);
    else records[i].cells.set(p.field.name, cell);
  });
  bumpTable(project, table.uid);
  return { op: 'deleteField', table: table.uid, name: p.field.name };
}

function applyDeleteField(project: Project, p: Extract<Patch, { op: 'deleteField' }>): FieldPatch {
  const table = tableOf(project, p.table, p.op);
  const i = fieldIndexOf(table, p.name, p.op);
  const [def] = table.fields.splice(i, 1);
  const cells: [number, CellData][] = [];
  // 同じ名前の列が残っていれば（共通列と重なる定義の誤りなど）、セルは消さない
  if (!hasColumn(project, table, p.name)) {
    for (const record of table.records) {
      const cell = record.cells.get(p.name);
      if (cell === undefined) continue;
      cells.push([record.uid, toCellData(cell)]);
      record.cells.delete(p.name);
    }
  }
  bumpTable(project, table.uid);
  return { op: 'insertField', table: table.uid, index: i, field: def, cells };
}

function applyUpdateField(project: Project, p: Extract<Patch, { op: 'updateField' }>): FieldPatch {
  const table = tableOf(project, p.table, p.op);
  if (p.field.name !== p.name) throw new PatchError(p.op, `field name must stay ${p.name}`);
  const i = fieldIndexOf(table, p.name, p.op);
  const old = table.fields[i];
  table.fields[i] = cloneFieldDef(p.field);
  bumpTable(project, table.uid);
  return { op: 'updateField', table: table.uid, name: p.name, field: old };
}

function applyRenameField(project: Project, p: Extract<Patch, { op: 'renameField' }>): FieldPatch {
  const table = tableOf(project, p.table, p.op);
  const i = fieldIndexOf(table, p.from, p.op);
  if (p.from === p.to) throw new PatchError(p.op, 'from and to are the same');
  if (hasColumn(project, table, p.to)) throw new PatchError(p.op, `field ${p.to} already exists in table ${table.uid}`);
  renameCellKeys(table, p.from, p.to, p.op);
  table.fields[i] = { ...cloneFieldDef(table.fields[i]), name: p.to };
  bumpTable(project, table.uid);
  return { op: 'renameField', table: table.uid, from: p.to, to: p.from };
}

function applyRenameCellKey(project: Project, p: Extract<Patch, { op: 'renameCellKey' }>): Patch {
  const table = tableOf(project, p.table, p.op);
  if (p.from === p.to) throw new PatchError(p.op, 'from and to are the same');
  renameCellKeys(table, p.from, p.to, p.op);
  bumpTable(project, table.uid);
  return { op: 'renameCellKey', table: table.uid, from: p.to, to: p.from };
}

function applySetFieldOrder(project: Project, p: Extract<Patch, { op: 'setFieldOrder' }>): FieldPatch {
  const table = tableOf(project, p.table, p.op);
  if (p.order.length !== table.fields.length || new Set(p.order).size !== p.order.length) {
    throw new PatchError(p.op, 'order is not a permutation of the fields');
  }
  const byName = new Map(table.fields.map((f) => [f.name, f]));
  const next = p.order.map((name) => {
    const field = byName.get(name);
    if (field === undefined) throw new PatchError(p.op, `field ${name} not found in table ${table.uid}`);
    return field;
  });
  const old = table.fields.map((f) => f.name);
  table.fields = next;
  bumpTable(project, table.uid);
  return { op: 'setFieldOrder', table: table.uid, order: old };
}

function applySetView(project: Project, p: Extract<Patch, { op: 'setView' }>): Patch {
  const table = tableOf(project, p.table, p.op);
  const old = table.view;
  table.view = cloneView(p.view);
  bumpTable(project, table.uid);
  return { op: 'setView', table: table.uid, view: old };
}

function applySetTableName(project: Project, p: Extract<Patch, { op: 'setTableName' }>): Patch {
  const table = tableOf(project, p.table, p.op);
  if (isTableNameUsed(project, p.name, table.uid)) throw new PatchError(p.op, `table name ${p.name} already exists`);
  const old = table.name;
  table.name = p.name;
  sortTables(project);
  bumpTable(project, table.uid);
  stateOf(project).tableList = nextVersion(project);
  return { op: 'setTableName', table: table.uid, name: old };
}

function applySetTableDisplayName(project: Project, p: Extract<Patch, { op: 'setTableDisplayName' }>): Patch {
  const table = tableOf(project, p.table, p.op);
  const old = table.display_name ?? null;
  if (p.displayName === null) delete table.display_name;
  else table.display_name = p.displayName;
  bumpTable(project, table.uid);
  stateOf(project).tableList = nextVersion(project);
  return { op: 'setTableDisplayName', table: table.uid, displayName: old };
}

function applyAddTable(project: Project, p: Extract<Patch, { op: 'addTable' }>): Patch {
  const data = p.table;
  if (project.tables.some((t) => t.uid === data.uid) || project.brokenTables.some((t) => t.uid === data.uid)) {
    throw new PatchError(p.op, `table ${data.uid} already exists`);
  }
  if (isTableNameUsed(project, data.name, data.uid)) throw new PatchError(p.op, `table name ${data.name} already exists`);
  const table = fromTableData(data);
  project.tables.push(table);
  sortTables(project);
  reserveUid(project, table.uid);
  for (const record of table.records) reserveUid(project, record.uid);
  bumpRecordShape(project, table.uid);
  bumpTable(project, table.uid);
  stateOf(project).tableList = nextVersion(project);
  return { op: 'removeTable', table: table.uid };
}

function applyRemoveTable(project: Project, p: Extract<Patch, { op: 'removeTable' }>): Patch {
  const table = tableOf(project, p.table, p.op);
  project.tables.splice(project.tables.indexOf(table), 1);
  bumpTable(project, table.uid);
  stateOf(project).tableList = nextVersion(project);
  return { op: 'addTable', table: toTableData(table) };
}

function applySetCommon(project: Project, p: Extract<Patch, { op: 'setCommon' }>): Patch {
  const state = stateOf(project);
  state.common = nextVersion(project);
  switch (p.part) {
    case 'enums': {
      const part = project.common.enums;
      const old = { items: part.items, isDefault: part.isDefault };
      part.items = p.items.map(cloneEnumDef);
      part.isDefault = p.isDefault;
      return { op: 'setCommon', part: 'enums', items: old.items, isDefault: old.isDefault };
    }
    case 'colors': {
      const part = project.common.colors;
      const old = { items: part.items, isDefault: part.isDefault };
      part.items = p.items.map(cloneColorDef);
      part.isDefault = p.isDefault;
      return { op: 'setCommon', part: 'colors', items: old.items, isDefault: old.isDefault };
    }
    case 'base_fields': {
      const part = project.common.base_fields;
      const old = { items: part.items, isDefault: part.isDefault };
      const given = p.protos === undefined ? undefined : new Map(p.protos);
      const oldProtos: [number, TableProto | null][] = [];
      const nextProtos = project.tables.map((table): TableProto | undefined => {
        oldProtos.push([table.uid, table.proto === undefined ? null : table.proto]);
        if (given !== undefined) {
          const proto = given.get(table.uid);
          return proto === undefined ? table.proto : proto === null ? undefined : cloneTableProto(proto);
        }
        const before = tableColumns(old.items, table);
        const after = tableColumns(p.items, table);
        return protoAfterColumnChange(table.proto, before, after, p.rename);
      });
      part.items = p.items.map(cloneFieldDef);
      part.isDefault = p.isDefault;
      project.tables.forEach((table, i) => setProto(table, nextProtos[i]));
      // 共通列はすべてのテーブルの列なので、全テーブルの版数を進める
      for (const table of project.tables) bumpTable(project, table.uid);
      const inverse: Patch = { op: 'setCommon', part: 'base_fields', items: old.items, isDefault: old.isDefault, protos: oldProtos };
      if (p.rename !== undefined) inverse.rename = { from: p.rename.to, to: p.rename.from };
      return inverse;
    }
  }
}

function setProto(table: Table, proto: TableProto | undefined): void {
  if (proto === undefined) delete table.proto;
  else table.proto = proto;
}

type FieldPatch = Extract<Patch, { op: 'insertField' | 'deleteField' | 'updateField' | 'renameField' | 'setFieldOrder' }>;

/**
 * 列定義を変えるパッチを当て、フィールド番号を合わせる（P-63）。番号はパッチが持っていればそれにし、
 * 無ければ変更の前後の列から決める。番号を持たないテーブル（`proto` の無いファイル）は、ここで以前の規則の番号を持つ
 * （列の並べ替えや出力対象の切り替えで番号が変わらないように）。逆のパッチに変更前の番号を持たせる（元に戻すと番号も元に戻る）
 */
function withProto<P extends FieldPatch>(project: Project, p: P, apply: (p: P) => FieldPatch): Patch {
  const table = tableOf(project, p.table, p.op);
  const base = project.common.base_fields.items;
  const old = table.proto;
  const before = tableColumns(base, table).map(cloneFieldDef);
  const inverse = apply(p);
  if (p.proto !== undefined) {
    setProto(table, p.proto === null ? undefined : cloneTableProto(p.proto));
  } else {
    const rename = p.op === 'renameField' ? { from: p.from, to: p.to } : undefined;
    setProto(table, protoAfterColumnChange(old, before, tableColumns(base, table), rename));
  }
  return { ...inverse, proto: old === undefined ? null : old };
}

/**
 * パッチをモデルに当て、逆のパッチを返す。
 * 指す先が無いなどで当てられなければ PatchError を投げ、モデルは変えない。
 * パッチのオブジェクトはモデルに取り込まず複製する（パッチは履歴に残り、Worker にも送られるため）
 */
export function applyPatch(project: Project, patch: Patch): Patch {
  switch (patch.op) {
    case 'setCells':
      return applySetCells(project, patch);
    case 'insertRecords':
      return applyInsertRecords(project, patch);
    case 'deleteRecords':
      return applyDeleteRecords(project, patch);
    case 'setRecordOrder':
      return applySetRecordOrder(project, patch);
    case 'insertField':
      return withProto(project, patch, (p) => applyInsertField(project, p));
    case 'deleteField':
      return withProto(project, patch, (p) => applyDeleteField(project, p));
    case 'updateField':
      return withProto(project, patch, (p) => applyUpdateField(project, p));
    case 'renameField':
      return withProto(project, patch, (p) => applyRenameField(project, p));
    case 'renameCellKey':
      return applyRenameCellKey(project, patch);
    case 'setFieldOrder':
      return withProto(project, patch, (p) => applySetFieldOrder(project, p));
    case 'setView':
      return applySetView(project, patch);
    case 'setTableName':
      return applySetTableName(project, patch);
    case 'setTableDisplayName':
      return applySetTableDisplayName(project, patch);
    case 'addTable':
      return applyAddTable(project, patch);
    case 'removeTable':
      return applyRemoveTable(project, patch);
    case 'setCommon':
      return applySetCommon(project, patch);
  }
}

/**
 * パッチの列を順に当て、逆のパッチの列（当てる順。つまり逆順）を返す。
 * 途中で失敗したら、それまでに当てたものを戻してから投げる（全部か無しか）
 */
export function applyPatches(project: Project, patches: readonly Patch[]): Patch[] {
  const inverse: Patch[] = [];
  try {
    for (const patch of patches) inverse.push(applyPatch(project, patch));
  } catch (e) {
    for (let i = inverse.length - 1; i >= 0; i--) applyPatch(project, inverse[i]);
    throw e;
  }
  return inverse.reverse();
}

/** パッチが指すテーブルの uid。共通設定のパッチは null */
export function patchTable(patch: Patch): number | null {
  switch (patch.op) {
    case 'addTable':
      return patch.table.uid;
    case 'setCommon':
      return null;
    default:
      return patch.table;
  }
}

/** 共通設定のパッチが指す部分 */
export function patchCommonPart(patch: Patch): CommonPartName | null {
  return patch.op === 'setCommon' ? patch.part : null;
}
