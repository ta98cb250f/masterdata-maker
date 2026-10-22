import type { Cell, ExtraValue, RawValue } from '../model/cell';
import { isEmptyValue, RichCell } from '../model/cell';
import type { ColorDef, CommonConfig, CommonPartName, EnumDef } from '../model/common';
import type { FieldDef, FieldType } from '../model/field';
import { ANOMALY_KEYS, elementType, isListType, VALIDATION_KEYS } from '../model/field';
import type { ProjectConfig } from '../model/project';
import { resolveProto } from '../model/proto';
import type { StorageFormat } from '../model/source';
import type { Table, TableRecord, TableView } from '../model/table';
import { isViewEmpty, tableColumns } from '../model/table';
import { IoCode } from './codes';
import type { OutMap, OutNode } from './emit';
import { emitJson, emitYaml, map, scalar, seq, SerializeError } from './emit';

// テーブル・プロジェクト設定・共通設定を正規形のテキストにする（DR-30〜36、DR-40〜41、DR-50〜51）

function emit(root: OutMap, format: StorageFormat): string {
  return format === 'yaml' ? emitYaml(root) : emitJson(root);
}

function numberNode(value: number, key: string): OutNode {
  if (!Number.isFinite(value)) throw new SerializeError(IoCode.nonFiniteNumber, { key, value: String(value) });
  return scalar(value);
}

/** 列の型の値。datetime の文字列は常に引用符で囲む（DR-41） */
function valueNode(value: RawValue, type: FieldType, key: string): OutNode {
  if (Array.isArray(value)) {
    const itemType = isListType(type) ? elementType(type) : type;
    return seq(
      value.map((item) => valueNode(item, itemType, key)),
      true,
    );
  }
  if (typeof value === 'number') return numberNode(value, key);
  if (typeof value === 'string') return scalar(value, type === 'datetime');
  return scalar(value);
}

function extraNode(value: ExtraValue, key: string): OutNode {
  if (value instanceof Map) {
    return map(
      [...value].map(([k, v]) => [k, extraNode(v, `${key}.${k}`)]),
      true,
    );
  }
  if (Array.isArray(value)) {
    return seq(
      value.map((item) => extraNode(item, key)),
      true,
    );
  }
  if (typeof value === 'number') return numberNode(value, key);
  return scalar(value);
}

/** セル。未入力（`""`・`[]` を含む）なら undefined（DR-15、P-11） */
function cellNode(cell: Cell, type: FieldType, key: string): OutNode | undefined {
  if (!(cell instanceof RichCell)) return isEmptyValue(cell) ? undefined : valueNode(cell, type, key);
  const value = isEmptyValue(cell.value) ? undefined : cell.value;
  if (!cell.hasAnnotations()) return value === undefined ? undefined : valueNode(value, type, key);
  // DR-33: RichCell は 1 行。キーの順は value → override → color → comment → 知らないキー
  const entries: [string, OutNode][] = [];
  if (value !== undefined) entries.push(['value', valueNode(value, type, `${key}.value`)]);
  if (cell.override !== undefined && cell.override !== '') entries.push(['override', scalar(cell.override)]);
  if (cell.color !== undefined && cell.color !== '') entries.push(['color', scalar(cell.color)]);
  if (cell.comment !== undefined && cell.comment !== '') entries.push(['comment', scalar(cell.comment)]);
  for (const [k, v] of cell.extra ?? []) entries.push([k, extraNode(v, `${key}.${k}`)]);
  return entries.length === 0 ? undefined : map(entries, true);
}

function boundNode(value: number | bigint | string, type: FieldType, key: string): OutNode {
  if (typeof value === 'number') return numberNode(value, key);
  if (typeof value === 'string') return scalar(value, type === 'datetime');
  return scalar(value);
}

/** 列定義。YAML はブロック形式、JSON は 1 行。ネストした値は 1 行（DR-14 の順） */
function fieldNode(field: FieldDef, format: StorageFormat): OutNode {
  const key = field.name;
  const entries: [string, OutNode][] = [
    ['name', scalar(field.name)],
    ['type', scalar(field.type)],
  ];
  if (field.display_name !== undefined) entries.push(['display_name', scalar(field.display_name)]);
  if (field.description !== undefined) entries.push(['description', scalar(field.description)]);
  if (field.export !== undefined) entries.push(['export', scalar(field.export)]);
  if (field.editable !== undefined) entries.push(['editable', scalar(field.editable)]);
  if (field.primary !== undefined) entries.push(['primary', scalar(field.primary)]);
  if (field.auto !== undefined) entries.push(['auto', scalar(field.auto)]);
  if (field.enum_ref !== undefined) entries.push(['enum_ref', scalar(field.enum_ref)]);
  if (field.ref !== undefined) entries.push(['ref', scalar(field.ref)]);
  if (field.formula !== undefined) entries.push(['formula', scalar(field.formula)]);
  if (field.default !== undefined) entries.push(['default', valueNode(field.default, field.type, `${key}.default`)]);
  if (field.validation !== undefined) {
    const v = field.validation;
    const items: [string, OutNode][] = [];
    for (const k of VALIDATION_KEYS) {
      const value = v[k];
      if (value === undefined) continue;
      const path = `${key}.validation.${k}`;
      if (k === 'min' || k === 'max') items.push([k, boundNode(value as number | bigint | string, field.type, path)]);
      else if (typeof value === 'number') items.push([k, numberNode(value, path)]);
      else items.push([k, scalar(value as boolean | string)]);
    }
    entries.push(['validation', map(items, true)]);
  }
  if (field.anomaly !== undefined) {
    const a = field.anomaly;
    const items: [string, OutNode][] = [];
    for (const k of ANOMALY_KEYS) {
      const value = a[k];
      if (value === undefined) continue;
      items.push([k, typeof value === 'number' ? numberNode(value, `${key}.anomaly.${k}`) : scalar(value)]);
    }
    entries.push(['anomaly', map(items, true)]);
  }
  return map(entries, format === 'json');
}

/** 名前を列の順に並べ、列に無い名前は後ろに元の順で置く */
function orderByColumns<T>(items: readonly T[], nameOf: (item: T) => string, columns: readonly FieldDef[]): T[] {
  const index = new Map<string, number>();
  columns.forEach((column, i) => {
    if (!index.has(column.name)) index.set(column.name, i);
  });
  const known = items.filter((item) => index.has(nameOf(item)));
  const unknown = items.filter((item) => !index.has(nameOf(item)));
  known.sort((a, b) => (index.get(nameOf(a)) ?? 0) - (index.get(nameOf(b)) ?? 0));
  return [...known, ...unknown];
}

/** DR-32・DR-34: 共通列 → テーブルの列 → 列定義に無いキー（元の順） */
function recordNode(record: TableRecord, columns: readonly FieldDef[], key: string): OutNode {
  const entries: [string, OutNode][] = [];
  const written = new Set<string>();
  for (const column of columns) {
    if (written.has(column.name)) continue;
    written.add(column.name);
    const cell = record.cells.get(column.name);
    if (cell === undefined) continue;
    const node = cellNode(cell, column.type, `${key}.${column.name}`);
    if (node !== undefined) entries.push([column.name, node]);
  }
  // 列に無いセル（列の削除の後など）も捨てずに書く
  for (const [name, cell] of record.cells) {
    if (written.has(name)) continue;
    const node = cellNode(cell, 'string', `${key}.${name}`);
    if (node !== undefined) entries.push([name, node]);
  }
  for (const [name, value] of record.extra) entries.push([name, extraNode(value, `${key}.${name}`)]);
  return map(entries, false);
}

function viewNode(view: TableView, columns: readonly FieldDef[]): OutNode {
  const entries: [string, OutNode][] = [];
  if (view.column_widths.length > 0) {
    const widths = orderByColumns(view.column_widths, ([name]) => name, columns);
    entries.push([
      'column_widths',
      map(
        widths.map(([name, width]) => [name, numberNode(width, `view.column_widths.${name}`)]),
        true,
      ),
    ]);
  }
  if (view.frozen_columns !== undefined) {
    entries.push(['frozen_columns', numberNode(view.frozen_columns, 'view.frozen_columns')]);
  }
  if (view.hidden_columns !== undefined) {
    const hidden = orderByColumns(view.hidden_columns, (name) => name, columns);
    entries.push([
      'hidden_columns',
      seq(
        hidden.map((name) => scalar(name)),
        true,
      ),
    ]);
  }
  return map(entries, false);
}

/**
 * Protocol Buffers のフィールド番号（P-63）。今の列に合わせて書く（手で列を変えたファイルでも、保存すれば番号が決まる）。
 * fields は列の順、reserved は番号の順。番号を持たないテーブル（`proto` の無いファイルで、列をまだ変えていない）と、
 * 列も reserved も無いテーブルは書かない（以前の規則の番号のままなので、既存のファイルの正規形を変えない）
 */
function protoNode(table: Table, columns: readonly FieldDef[]): OutNode | undefined {
  if (table.proto === undefined) return undefined;
  const proto = resolveProto(table.proto, columns);
  if (proto.fields.length === 0 && proto.reserved.length === 0) return undefined;
  const entries: [string, OutNode][] = [
    [
      'fields',
      map(
        proto.fields.map(([name, n]) => [name, numberNode(n, `proto.fields.${name}`)]),
        proto.fields.length === 0,
      ),
    ],
  ];
  if (proto.reserved.length > 0) {
    entries.push([
      'reserved',
      seq(
        proto.reserved.map((r) => {
          const items: [string, OutNode][] = [['number', numberNode(r.number, 'proto.reserved.number')]];
          if (r.name !== undefined) items.push(['name', scalar(r.name)]);
          return map(items, true);
        }),
        false,
      ),
    ]);
  }
  return map(entries, false);
}

export function tableToTree(table: Table, baseFields: readonly FieldDef[], format: StorageFormat): OutMap {
  const columns = tableColumns(baseFields, table);
  const entries: [string, OutNode][] = [['table', scalar(table.name)]];
  if (table.display_name !== undefined) entries.push(['display_name', scalar(table.display_name)]);
  entries.push([
    'fields',
    seq(
      table.fields.map((field) => fieldNode(field, format)),
      false,
    ),
  ]);
  entries.push([
    'records',
    seq(
      table.records.map((record, i) => recordNode(record, columns, `records[${i}]`)),
      false,
    ),
  ]);
  if (!isViewEmpty(table.view)) entries.push(['view', viewNode(table.view, columns)]);
  const proto = protoNode(table, columns);
  if (proto !== undefined) entries.push(['proto', proto]);
  return map(entries, false);
}

/** テーブルを正規形のテキストにする。NaN・Infinity があれば SerializeError（DR-35） */
export function serializeTable(table: Table, baseFields: readonly FieldDef[], format: StorageFormat): string {
  try {
    return emit(tableToTree(table, baseFields, format), format);
  } catch (e) {
    if (e instanceof SerializeError) throw new SerializeError(e.code, { ...e.params, table: table.name });
    throw e;
  }
}

/** プロジェクト設定（P-01）。ネストしたキーは YAML・JSON とも複数行 */
export function serializeProjectConfig(config: ProjectConfig, format: StorageFormat): string {
  const entries: [string, OutNode][] = [
    ['format_version', numberNode(config.format_version, 'format_version')],
    ['storage', map([['format', scalar(config.storage.format)]], false)],
  ];
  if (config.timezone !== undefined) entries.push(['timezone', scalar(config.timezone)]);
  if (config.paths !== undefined) {
    const items: [string, OutNode][] = [];
    if (config.paths.tables !== undefined) items.push(['tables', scalar(config.paths.tables)]);
    if (config.paths.config !== undefined) items.push(['config', scalar(config.paths.config)]);
    entries.push(['paths', map(items, false)]);
  }
  if (config.output !== undefined) {
    const items: [string, OutNode][] = [];
    if (config.output.format !== undefined) items.push(['format', scalar(config.output.format)]);
    if (config.output.out_dir !== undefined) items.push(['out_dir', scalar(config.output.out_dir)]);
    entries.push(['output', map(items, false)]);
  }
  return emit(map(entries, false), format);
}

/** 列挙型（P-02）。項目は YAML ではブロック形式、JSON では 1 行。values は 1 行のリスト */
export function serializeEnums(enums: readonly EnumDef[], format: StorageFormat): string {
  const items = enums.map((def) => {
    const entries: [string, OutNode][] = [['name', scalar(def.name)]];
    if (def.display_name !== undefined) entries.push(['display_name', scalar(def.display_name)]);
    entries.push([
      'values',
      seq(
        def.values.map((value) => scalar(value)),
        true,
      ),
    ]);
    return map(entries, format === 'json');
  });
  return emit(map([['enums', seq(items, false)]], false), format);
}

/** 共通列（P-02）。テーブルの fields と同じ書き方 */
export function serializeBaseFields(fields: readonly FieldDef[], format: StorageFormat): string {
  const items = fields.map((field) => fieldNode(field, format));
  return emit(map([['base_fields', seq(items, false)]], false), format);
}

/** セル色（P-02）。項目は YAML ではブロック形式、JSON では 1 行 */
export function serializeColors(colors: readonly ColorDef[], format: StorageFormat): string {
  const items = colors.map((def) => {
    const entries: [string, OutNode][] = [
      ['key', scalar(def.key)],
      ['color', scalar(def.color)],
    ];
    if (def.label !== undefined) entries.push(['label', scalar(def.label)]);
    return map(entries, format === 'json');
  });
  return emit(map([['colors', seq(items, false)]], false), format);
}

export function serializeCommonPart(common: CommonConfig, name: CommonPartName, format: StorageFormat): string {
  switch (name) {
    case 'enums':
      return serializeEnums(common.enums.items, format);
    case 'base_fields':
      return serializeBaseFields(common.base_fields.items, format);
    case 'colors':
      return serializeColors(common.colors.items, format);
  }
}
