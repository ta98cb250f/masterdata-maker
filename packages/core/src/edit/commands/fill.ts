// フィル（FR-FIL-01〜03、05、P-41）。値の推定は sheet/fill.ts に任せ、ここでは列の型に変換する（全部か無しか）
import type { Cell, RawValue } from '../../model/cell';
import { cellValue, isEmptyValue } from '../../model/cell';
import type { FieldDef } from '../../model/field';
import type { Project } from '../../model/project';
import type { FillValue } from '../../sheet/fill';
import { extendSeries, extendSeriesBackward, seriesFill } from '../../sheet/fill';
import { DAY_MS, formatIsoOffset, parseIsoOffset } from '../../util/datetime';
import { EditCode } from '../codes';
import type { CellTarget } from '../helpers';
import { columnLookup, editableTable, readonlyFailure, recordsOf, unique } from '../helpers';
import type { FieldTypeInfo, InputContext } from '../input';
import { convertValue, inputContext, keepSameInstant, parseCellInput } from '../input';
import type { CellData } from '../patch';
import { toCellData } from '../patch';
import type { CommandResult, EditFailure } from '../transaction';
import { emptyResult, failed, inputFailure, TxBuilder } from '../transaction';

export type FillDirection = 'down' | 'up' | 'right' | 'left';

export interface FillArgs {
  table: number;
  /** 元の範囲（表示順） */
  source: { rows: number[]; columns: string[] };
  /** 下・上へのフィルで値を入れる行（表示順。上へのフィルでは最後の行が元の範囲のすぐ上） */
  targetRows?: number[];
  /** 右・左へのフィルで値を入れる列（表示順。左へのフィルでは最後の列が元の範囲のすぐ左） */
  targetColumns?: string[];
  direction: FillDirection;
}

/** 'other' の値の中身: 元のセルとその列の型 */
interface OtherPayload {
  data: CellData;
  from: FieldTypeInfo;
}

function toFillValue(cell: Cell | undefined, field: FieldDef): FillValue {
  const data = toCellData(cell);
  const value = cellValue(cell);
  const other = (): FillValue => ({ kind: 'other', v: { data, from: { type: field.type, enum_ref: field.enum_ref } } satisfies OtherPayload });
  if (isEmptyValue(value)) return data.override !== undefined ? other() : { kind: 'empty' };
  if (typeof value === 'number') return Number.isFinite(value) ? { kind: 'number', v: value } : other();
  if (typeof value === 'bigint') return { kind: 'bigint', v: value };
  if (typeof value === 'string') {
    if (field.type === 'datetime') {
      const p = parseIsoOffset(value);
      return p === null ? other() : { kind: 'datetime', ms: p.epochMs };
    }
    if (field.type === 'string' || field.type === 'enum') return { kind: 'string', v: value };
  }
  return other();
}

type FillResult = { ok: true; data: CellData } | { ok: false; error: EditFailure };

/** 推定した値を、貼り付け先の列の型のセルにする。セル色・メモは元の範囲の対応するセルから持ち込む */
function fromFillValue(fv: FillValue, pattern: CellData, field: FieldDef, ctx: InputContext): FillResult {
  const next: CellData = {};
  if (pattern.color !== undefined) next.color = pattern.color;
  if (pattern.comment !== undefined) next.comment = pattern.comment;
  let value: RawValue | undefined;
  let from: FieldTypeInfo;
  switch (fv.kind) {
    case 'empty':
      return { ok: true, data: next };
    case 'other': {
      const payload = fv.v as OtherPayload;
      if (payload.data.override !== undefined) next.override = payload.data.override;
      value = payload.data.value;
      from = payload.from;
      break;
    }
    case 'number':
      value = fv.v;
      from = { type: 'float' };
      break;
    case 'bigint':
      value = fv.v;
      from = { type: 'int64' };
      break;
    case 'datetime': {
      const iso = formatIsoOffset(fv.ms, ctx.timeZone);
      value = keepSameInstant(iso, pattern.value, 'datetime');
      from = { type: 'datetime' };
      break;
    }
    case 'string':
      value = fv.v;
      from = { type: 'string' };
      break;
  }
  if (value === undefined) return { ok: true, data: next };
  const conv = convertValue(value, from, field, ctx);
  if (!conv.ok) return { ok: false, error: inputFailure(conv.error, { input: conv.text }) };
  if (conv.value !== undefined) next.value = conv.value;
  return { ok: true, data: next };
}

/** 元の並びの何番目のセルの書式を持ち込むか（推定の「並びを繰り返す」と同じ対応） */
function patternIndex(k: number, count: number, n: number, backward: boolean): number {
  return backward ? n - 1 - ((count - 1 - k) % n) : k % n;
}

/**
 * フィルハンドルによるフィル（FR-FIL-01〜03）。元の範囲の値から sheet/fill.ts で値を推定し、列の型に変換する。
 * 1 セルでも変換できない、または編集できない列が含まれるなら、何も変えずに失敗の一覧を返す
 */
export function fillCells(project: Project, args: FillArgs): CommandResult {
  const found = editableTable(project, args.table);
  if (!found.ok) return failed(found.failures);
  const table = found.table;
  const lookup = columnLookup(project, table);
  const records = recordsOf(project, table);
  const vertical = args.direction === 'down' || args.direction === 'up';
  const backward = args.direction === 'up' || args.direction === 'left';
  const targetRows = vertical ? (args.targetRows ?? []) : args.source.rows;
  const targetColumns = vertical ? args.source.columns : (args.targetColumns ?? []);
  if (targetRows.length === 0 || targetColumns.length === 0) return emptyResult(EditCode.opFill);

  const failures: EditFailure[] = [];
  for (const name of unique([...args.source.columns, ...targetColumns])) {
    const column = lookup.get(name);
    if (column === undefined) failures.push({ code: EditCode.columnNotFound, params: { column: name }, table: table.uid, column: name });
    else if (targetColumns.includes(name)) {
      const ro = readonlyFailure(table.uid, column);
      if (ro !== null) failures.push(ro);
    }
  }
  for (const uid of unique([...args.source.rows, ...targetRows])) {
    if (!records.has(uid)) failures.push({ code: EditCode.recordNotFound, params: {}, table: table.uid, record: uid });
  }
  if (failures.length > 0) return failed(failures);

  const ctx = inputContext(project);
  const cellAt = (uid: number, name: string): Cell | undefined => records.get(uid)?.cells.get(name);
  const changes: { record: number; column: string; old: Cell | undefined; data: CellData }[] = [];
  // 1 本の線（下・上なら列、右・左なら行）ごとに推定する
  const lines = vertical ? args.source.columns.length : args.source.rows.length;
  for (let line = 0; line < lines; line++) {
    const sourceCells = vertical
      ? args.source.rows.map((uid) => ({ cell: cellAt(uid, args.source.columns[line]), field: lookup.get(args.source.columns[line]) as FieldDef }))
      : args.source.columns.map((name) => ({ cell: cellAt(args.source.rows[line], name), field: lookup.get(name) as FieldDef }));
    const values = sourceCells.map((s) => toFillValue(s.cell, s.field));
    const count = vertical ? targetRows.length : targetColumns.length;
    const extended = backward ? extendSeriesBackward(values, count) : extendSeries(values, count);
    for (let k = 0; k < count; k++) {
      const uid = vertical ? targetRows[k] : args.source.rows[line];
      const name = vertical ? args.source.columns[line] : targetColumns[k];
      const field = lookup.get(name) as FieldDef;
      const pattern = toCellData(sourceCells[patternIndex(k, count, sourceCells.length, backward)].cell);
      const r = fromFillValue(extended[k], pattern, field, ctx);
      if (!r.ok) {
        failures.push({ ...r.error, table: table.uid, record: uid, column: name, row: vertical ? k : line, col: vertical ? line : k });
        continue;
      }
      const old = cellAt(uid, name);
      const data = r.data;
      if (data.value !== undefined) {
        const oldValue = cellValue(old);
        data.value = keepSameInstant(data.value, isEmptyValue(oldValue) ? undefined : oldValue, field.type) as RawValue;
      }
      changes.push({ record: uid, column: name, old, data });
    }
  }
  if (failures.length > 0) return failed(failures);
  const b = new TxBuilder();
  for (const c of changes) b.setCell(table.uid, c.record, c.column, c.old, c.data);
  return b.result(EditCode.opFill, { table: table.uid, records: unique(targetRows), columns: unique(targetColumns) });
}

export interface SeriesArgs {
  table: number;
  /** 値を入れるセル（入れる順） */
  cells: CellTarget[];
  /** 開始値のテキスト。datetime の列では日時 */
  start: string;
  /** 増分のテキスト。datetime の列では日数（小数も可。P-15） */
  step: string;
}

/**
 * 連番の入力（FR-FIL-05）: 開始値から増分ずつ増やした値で埋める。
 * 先頭のセルの列の型（int / int64 / float / datetime）で開始値と増分を解釈する
 */
export function fillSeriesCells(project: Project, args: SeriesArgs): CommandResult {
  const found = editableTable(project, args.table);
  if (!found.ok) return failed(found.failures);
  const table = found.table;
  if (args.cells.length === 0) return emptyResult(EditCode.opSeries);
  const lookup = columnLookup(project, table);
  const records = recordsOf(project, table);
  const failures: EditFailure[] = [];
  for (const name of unique(args.cells.map((c) => c.column))) {
    const column = lookup.get(name);
    if (column === undefined) failures.push({ code: EditCode.columnNotFound, params: { column: name }, table: table.uid, column: name });
    else {
      const ro = readonlyFailure(table.uid, column);
      if (ro !== null) failures.push(ro);
    }
  }
  for (const uid of unique(args.cells.map((c) => c.record))) {
    if (!records.has(uid)) failures.push({ code: EditCode.recordNotFound, params: {}, table: table.uid, record: uid });
  }
  if (failures.length > 0) return failed(failures);

  const ctx = inputContext(project);
  const first = lookup.get(args.cells[0].column) as FieldDef;
  const n = args.cells.length;
  const invalid = (code: string, input: string): CommandResult =>
    failed([{ code, params: { input }, table: table.uid, column: first.name, input }]);
  let values: { value: RawValue; from: FieldTypeInfo }[];
  if (first.type === 'int' || first.type === 'float') {
    const start = parseCellInput(args.start, { type: 'float' }, ctx, 'value');
    if (!start.ok || start.kind !== 'value') return invalid(EditCode.seriesInvalidStart, args.start);
    const step = parseCellInput(args.step, { type: 'float' }, ctx, 'value');
    if (!step.ok || step.kind !== 'value') return invalid(EditCode.seriesInvalidStep, args.step);
    values = seriesFill(start.value as number, step.value as number, n).map((v) => ({ value: v, from: { type: 'float' } }));
  } else if (first.type === 'int64') {
    const start = parseCellInput(args.start, { type: 'int64' }, ctx, 'value');
    if (!start.ok || start.kind !== 'value') return invalid(EditCode.seriesInvalidStart, args.start);
    const step = parseCellInput(args.step, { type: 'int64' }, ctx, 'value');
    if (!step.ok || step.kind !== 'value') return invalid(EditCode.seriesInvalidStep, args.step);
    values = seriesFill(start.value as bigint, step.value as bigint, n).map((v) => ({ value: v, from: { type: 'int64' } }));
  } else if (first.type === 'datetime') {
    const start = parseCellInput(args.start, { type: 'datetime' }, ctx, 'value');
    if (!start.ok || start.kind !== 'value') return invalid(EditCode.seriesInvalidStart, args.start);
    const step = parseCellInput(args.step, { type: 'float' }, ctx, 'value');
    if (!step.ok || step.kind !== 'value') return invalid(EditCode.seriesInvalidStep, args.step);
    const ms = (parseIsoOffset(start.value as string) as { epochMs: number }).epochMs;
    const days = step.value as number;
    values = Array.from({ length: n }, (_, k) => {
      // 秒に丸める（DR-18）。先頭は入力した時差のまま
      const t = Math.round((ms + days * k * DAY_MS) / 1000) * 1000;
      return { value: k === 0 ? (start.value as string) : formatIsoOffset(t, ctx.timeZone), from: { type: 'datetime' as const } };
    });
  } else {
    return failed([{ code: EditCode.seriesUnsupportedType, params: { column: first.name, type: first.type }, table: table.uid, column: first.name }]);
  }

  const b = new TxBuilder();
  const changes: { target: CellTarget; old: Cell | undefined; data: CellData }[] = [];
  args.cells.forEach((target, k) => {
    const field = lookup.get(target.column) as FieldDef;
    const conv = convertValue(values[k].value, values[k].from, field, ctx);
    if (!conv.ok) {
      failures.push(inputFailure(conv.error, { table: table.uid, record: target.record, column: target.column, row: k, input: conv.text }));
      return;
    }
    const old = records.get(target.record)?.cells.get(target.column);
    const data = toCellData(old);
    delete data.override;
    delete data.value;
    const oldValue = cellValue(old);
    const value = keepSameInstant(conv.value, isEmptyValue(oldValue) ? undefined : oldValue, field.type);
    if (value !== undefined) data.value = value;
    changes.push({ target, old, data });
  });
  if (failures.length > 0) return failed(failures);
  for (const c of changes) b.setCell(table.uid, c.target.record, c.target.column, c.old, c.data);
  return b.result(EditCode.opSeries, {
    table: table.uid,
    records: unique(args.cells.map((c) => c.record)),
    columns: unique(args.cells.map((c) => c.column)),
  });
}
