// セル位置の表示（名前ボックス）に入れた位置の解釈（FR-UI-03）。DOM に依存しない。
// 受け付ける形（区切りは `/`。前後の空白は無視する。テーブル名・列名は大文字と小文字を区別せず、表示名でもよい）:
//   テーブル / 列名 / 主キー … そのセル
//   列名 / 主キー           … 表示中のテーブルのそのセル（テーブルを省略）
//   テーブル / 列名         … そのテーブルの列全体
//   テーブル               … そのテーブルに切り替える
//   列名                   … 表示中のテーブルの列全体
//   主キー                 … 表示中のテーブルの、今の列のそのレコードのセル
import type { BrokenTable, Calculator, FieldDef, MessageParams, Project, Table, TableRecord } from '@sheetcraft/core';
import { formatValueText } from '@sheetcraft/core';

export type LocationTarget =
  | { kind: 'cell'; table: number; record: number; column: string }
  | { kind: 'column'; table: number; column: string }
  | { kind: 'table'; table: number };

export type LocationResult = { ok: true; target: LocationTarget } | { ok: false; code: string; params: MessageParams };

export interface LocationContext {
  project: Project;
  calc: Calculator;
  /** 表示中のテーブルの uid */
  activeTable: number | null;
  /** 表示中のテーブルの今の列（主キーだけを入れたときに使う） */
  activeColumn?: string;
}

function sameName(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase();
}

function findTable(project: Project, name: string): Table | BrokenTable | undefined {
  const all: (Table | BrokenTable)[] = [...project.tables, ...project.brokenTables];
  return (
    all.find((t) => t.name === name) ??
    all.find((t) => sameName(t.name, name)) ??
    project.tables.find((t) => t.display_name !== undefined && sameName(t.display_name, name))
  );
}

function findColumn(calc: Calculator, table: Table, name: string): FieldDef | undefined {
  const columns = calc.columns(table);
  return (
    columns.find((c) => c.name === name) ??
    columns.find((c) => sameName(c.name, name)) ??
    columns.find((c) => c.display_name !== undefined && sameName(c.display_name, name))
  );
}

/** 主キーの表記が key のレコード。主キーの列が無ければ null */
function findRecord(calc: Calculator, table: Table, key: string): TableRecord | undefined | null {
  const primary = calc.primaryColumn(table);
  if (primary === undefined) return null;
  for (const record of table.records) {
    const raw = calc.getCell(table, record.uid, primary.name).raw;
    if (raw === undefined) continue;
    if (formatValueText(raw, primary.type, calc.timeZone) === key || String(raw) === key) return record;
  }
  return undefined;
}

function cellOf(calc: Calculator, table: Table, column: FieldDef, key: string): LocationResult {
  const record = findRecord(calc, table, key);
  if (record === null) return { ok: false, code: 'ui.nameBox.noPrimary', params: { table: table.name } };
  if (record === undefined) return { ok: false, code: 'ui.nameBox.keyNotFound', params: { table: table.name, key } };
  return { ok: true, target: { kind: 'cell', table: table.uid, record: record.uid, column: column.name } };
}

/** 入力した位置を解釈する */
export function resolveLocation(ctx: LocationContext, text: string): LocationResult {
  const { project, calc } = ctx;
  const parts = text.split('/').map((p) => p.trim());
  if (parts.length > 3 || parts.some((p) => p === '')) return { ok: false, code: 'ui.nameBox.invalid', params: { text: text.trim() } };
  const active = ctx.activeTable === null ? undefined : project.tables.find((t) => t.uid === ctx.activeTable);

  if (parts.length === 3) {
    const [tableName, columnName, key] = parts;
    const table = findTable(project, tableName);
    if (table === undefined) return { ok: false, code: 'ui.nameBox.tableNotFound', params: { name: tableName } };
    if (table.kind === 'broken') return { ok: false, code: 'ui.nameBox.broken', params: { name: table.name } };
    const column = findColumn(calc, table, columnName);
    if (column === undefined) return { ok: false, code: 'ui.nameBox.columnNotFound', params: { table: table.name, name: columnName } };
    return cellOf(calc, table, column, key);
  }

  if (parts.length === 2) {
    const [first, second] = parts;
    // 表示中のテーブルの「列名 / 主キー」を先に試す
    const activeColumn = active === undefined ? undefined : findColumn(calc, active, first);
    if (active !== undefined && activeColumn !== undefined) {
      const r = cellOf(calc, active, activeColumn, second);
      if (r.ok) return r;
      if (findTable(project, first) === undefined) return r;
    }
    const table = findTable(project, first);
    if (table === undefined) return { ok: false, code: 'ui.nameBox.tableNotFound', params: { name: first } };
    if (table.kind === 'broken') return { ok: false, code: 'ui.nameBox.broken', params: { name: table.name } };
    const column = findColumn(calc, table, second);
    if (column === undefined) return { ok: false, code: 'ui.nameBox.columnNotFound', params: { table: table.name, name: second } };
    return { ok: true, target: { kind: 'column', table: table.uid, column: column.name } };
  }

  const [only] = parts;
  const table = findTable(project, only);
  if (table !== undefined) return { ok: true, target: { kind: 'table', table: table.uid } };
  if (active === undefined) return { ok: false, code: 'ui.nameBox.tableNotFound', params: { name: only } };
  const column = findColumn(calc, active, only);
  if (column !== undefined) return { ok: true, target: { kind: 'column', table: active.uid, column: column.name } };
  const current = ctx.activeColumn === undefined ? undefined : findColumn(calc, active, ctx.activeColumn);
  if (current !== undefined) {
    const r = cellOf(calc, active, current, only);
    if (r.ok) return r;
  }
  return { ok: false, code: 'ui.nameBox.notFound', params: { text: only } };
}
