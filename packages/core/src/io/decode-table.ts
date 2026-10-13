import type { Cell, ExtraValue } from '../model/cell';
import { cellValue } from '../model/cell';
import type { FieldDef } from '../model/field';
import type { SourceFile } from '../model/source';
import type { BrokenTable, Table, TableRecord, TableView } from '../model/table';
import { columnMap, emptyView, primaryColumn, tableColumns } from '../model/table';
import type { UidAllocator } from '../model/uid';
import { IoCode } from './codes';
import { decodeFieldList } from './decode-field';
import { decodeCell, decodeInteger, decodeStringValue, toExtraValue } from './decode-value';
import type { Reporter, SrcNode } from './tree';

// テーブルファイル（DR-10〜19、DR-34）

export const TABLE_KEYS = ['table', 'display_name', 'fields', 'records', 'view'] as const;

export interface DecodeTableOptions {
  baseFields: readonly FieldDef[];
  uids: UidAllocator;
  source: SourceFile;
  /** `table` が読めないときの名前（ファイル名から拡張子を除いたもの） */
  fallbackName: string;
}

function decodeView(node: SrcNode, r: Reporter): TableView {
  const view = emptyView();
  if (node.kind === 'scalar' && node.value === null) {
    r.warn(IoCode.nullValueIgnored, node.pos, { key: 'view' });
    return view;
  }
  if (node.kind !== 'map') {
    r.error(IoCode.expectedMapping, node.pos, { key: 'view' });
    return view;
  }
  for (const entry of node.entries) {
    const key = `view.${entry.key}`;
    switch (entry.key) {
      case 'column_widths': {
        const v = entry.value;
        if (v.kind === 'scalar' && v.value === null) {
          r.warn(IoCode.nullValueIgnored, v.pos, { key });
        } else if (v.kind !== 'map') {
          r.error(IoCode.expectedMapping, v.pos, { key });
        } else {
          for (const width of v.entries) {
            const n = decodeInteger(width.value, r, `${key}.${width.key}`);
            if (n !== undefined) view.column_widths.push([width.key, n]);
          }
        }
        break;
      }
      case 'frozen_columns': {
        const n = decodeInteger(entry.value, r, key);
        if (n !== undefined) view.frozen_columns = n;
        break;
      }
      case 'hidden_columns': {
        const v = entry.value;
        if (v.kind === 'scalar' && v.value === null) {
          r.warn(IoCode.nullValueIgnored, v.pos, { key });
        } else if (v.kind !== 'seq') {
          r.error(IoCode.expectedList, v.pos, { key });
        } else {
          const names: string[] = [];
          for (const item of v.items) {
            const s = decodeStringValue(item, r, key);
            if (s !== undefined) names.push(s);
          }
          view.hidden_columns = names;
        }
        break;
      }
      default:
        r.error(IoCode.unknownViewKey, entry.keyPos, { key: entry.key });
    }
  }
  return view;
}

function decodeRecord(
  node: SrcNode,
  columns: Map<string, FieldDef>,
  primary: FieldDef | undefined,
  uids: UidAllocator,
  reporter: Reporter,
): TableRecord | null {
  const uid = uids.next();
  const r = reporter.child({ recordUid: uid });
  if (node.kind !== 'map') {
    r.error(IoCode.expectedMapping, node.pos, { key: 'records' });
    return null;
  }
  const before = r.items.length;
  const cells = new Map<string, Cell>();
  const extra: [string, ExtraValue][] = [];
  for (const entry of node.entries) {
    const column = columns.get(entry.key);
    if (column !== undefined) {
      const cell = decodeCell(entry.value, column, r.child({ field: column.name }));
      if (cell !== undefined) cells.set(column.name, cell);
    } else {
      // DR-34: 列定義に無いキーは消さずに残し、警告する
      r.warn(IoCode.unknownRecordKey, entry.keyPos, { key: entry.key });
      extra.push([entry.key, toExtraValue(entry.value)]);
    }
  }
  // 診断に主キーの値を付ける（FR-VAL-08）
  if (primary !== undefined) {
    const key = cellValue(cells.get(primary.name));
    if (key !== undefined && !Array.isArray(key)) {
      for (const d of r.items.slice(before)) d.recordKey = String(key);
    }
  }
  return { uid, cells, extra };
}

/** 構文木をテーブルにする。エラーがあれば BrokenTable（P-40） */
export function decodeTable(root: SrcNode | null, reporter: Reporter, options: DecodeTableOptions): Table | BrokenTable {
  const uid = options.uids.next();
  const broken = (name: string): BrokenTable => ({
    kind: 'broken',
    uid,
    name,
    source: options.source,
    diagnostics: reporter.items,
  });
  if (root === null) return broken(options.fallbackName);
  if (root.kind !== 'map') {
    reporter.error(IoCode.rootNotMapping, root.pos);
    return broken(options.fallbackName);
  }

  const entries = new Map(root.entries.map((entry) => [entry.key, entry]));
  for (const entry of root.entries) {
    if (!(TABLE_KEYS as readonly string[]).includes(entry.key)) {
      reporter.error(IoCode.unknownTableKey, entry.keyPos, { key: entry.key });
    }
  }

  const tableEntry = entries.get('table');
  const name = tableEntry === undefined ? undefined : decodeStringValue(tableEntry.value, reporter, 'table');
  if (name === undefined) reporter.error(IoCode.missingKey, root.pos, { key: 'table' });
  const r = name === undefined ? reporter : reporter.child({ table: name });

  const displayEntry = entries.get('display_name');
  const displayName = displayEntry === undefined ? undefined : decodeStringValue(displayEntry.value, r, 'display_name');

  const fieldsEntry = entries.get('fields');
  const fields = fieldsEntry === undefined ? [] : decodeFieldList(fieldsEntry.value, r, 'fields');

  const columns = tableColumns(options.baseFields, { fields });
  const byName = columnMap(columns);
  const primary = primaryColumn(columns);

  const records: TableRecord[] = [];
  const recordsEntry = entries.get('records');
  if (recordsEntry !== undefined) {
    const node = recordsEntry.value;
    if (node.kind === 'scalar' && node.value === null) {
      r.warn(IoCode.nullValueIgnored, node.pos, { key: 'records' });
    } else if (node.kind !== 'seq') {
      r.error(IoCode.expectedList, node.pos, { key: 'records' });
    } else {
      for (const item of node.items) {
        const record = decodeRecord(item, byName, primary, options.uids, r);
        if (record !== null) records.push(record);
      }
    }
  }

  const viewEntry = entries.get('view');
  const view = viewEntry === undefined ? emptyView() : decodeView(viewEntry.value, r);

  if (name === undefined || reporter.hasErrors()) return broken(name ?? options.fallbackName);
  const table: Table = {
    kind: 'table',
    uid,
    name,
    fields,
    records,
    view,
    source: options.source,
    diagnostics: reporter.items,
  };
  if (displayName !== undefined) table.display_name = displayName;
  return table;
}
