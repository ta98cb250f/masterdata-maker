import { describe, expect, it } from 'vitest';
import { cellValue, isEmptyValue, isRichCell, RichCell } from './cell';
import { defaultBaseFields, defaultColors } from './defaults';
import { hasErrors } from './diagnostic';
import type { FieldDef } from './field';
import { cloneFieldDef, elementType, FIELD_TYPES, isFieldEditable, isFieldExported, isFieldType, isListType } from './field';
import { joinPath, normalizeDir, resolveProjectPaths } from './project';
import { extensionOf, formatFromPath } from './source';
import { columnMap, emptyView, isViewEmpty, primaryColumn, tableColumns } from './table';
import { UidAllocator } from './uid';

describe('フィールド型（DR-13）', () => {
  it('11 種の型とリスト型の要素', () => {
    expect(FIELD_TYPES).toHaveLength(11);
    expect(isFieldType('list<enum>')).toBe(true);
    expect(isFieldType('integer')).toBe(false);
    expect(isListType('list<float>')).toBe(true);
    expect(isListType('int64')).toBe(false);
    expect(elementType('list<int>')).toBe('int');
    expect(elementType('list<enum>')).toBe('enum');
    expect(elementType('datetime')).toBe('datetime');
  });

  it('出力対象・編集可否の既定値', () => {
    const [id, version] = defaultBaseFields();
    expect(isFieldEditable(id)).toBe(false);
    expect(isFieldEditable(version)).toBe(true);
    expect(isFieldEditable({ name: 'a', type: 'int', auto: 'increment' })).toBe(false);
    expect(isFieldExported(version)).toBe(true);
    expect(isFieldExported({ name: 'a', type: 'int', export: false })).toBe(false);
  });

  it('列定義の複製は default・validation を共有しない', () => {
    const field: FieldDef = { name: 'a', type: 'list<int>', default: [1], validation: { min: 0 } };
    const copy = cloneFieldDef(field);
    expect(copy).toEqual(field);
    expect(copy.default).not.toBe(field.default);
    expect(copy.validation).not.toBe(field.validation);
  });
});

describe('セル', () => {
  it('RichCell は指定したキーだけを持つ', () => {
    const cell = new RichCell({ value: 800, color: 'red' });
    expect(Object.keys(cell)).toEqual(['value', 'color']);
    expect(cell.hasAnnotations()).toBe(true);
    expect(new RichCell({ value: 1 }).hasAnnotations()).toBe(false);
    expect(new RichCell().isEmpty()).toBe(true);
    expect(new RichCell({ extra: [] }).extra).toBeUndefined();
  });

  it('値の取り出しと未入力の判定（DR-15、P-11）', () => {
    expect(cellValue(new RichCell({ value: 3, comment: 'x' }))).toBe(3);
    expect(cellValue(5n)).toBe(5n);
    expect(cellValue(undefined)).toBeUndefined();
    expect(isRichCell(new RichCell())).toBe(true);
    expect(isRichCell([1])).toBe(false);
    expect(isEmptyValue('')).toBe(true);
    expect(isEmptyValue([])).toBe(true);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue(false)).toBe(false);
    expect(isEmptyValue([''])).toBe(false);
  });
});

describe('テーブル', () => {
  const fields: FieldDef[] = [
    { name: 'name', type: 'string' },
    { name: 'id', type: 'int' },
  ];

  it('列一覧は共通列が先（P-03、DR-32）。同じ名前は先のものを使う', () => {
    const columns = tableColumns(defaultBaseFields(), { fields });
    expect(columns.map((c) => c.name)).toEqual(['id', 'version', 'name', 'id']);
    expect(columnMap(columns).get('id')).toBe(columns[0]);
    expect(primaryColumn(columns)?.name).toBe('id');
  });

  it('表示設定の既定値（P-05）', () => {
    expect(isViewEmpty(emptyView())).toBe(true);
    expect(isViewEmpty({ column_widths: [], hidden_columns: [] })).toBe(false);
  });
});

describe('プロジェクト', () => {
  it('パスの既定値と正規化', () => {
    const paths = resolveProjectPaths({ format_version: 1, storage: { format: 'yaml' }, source: null });
    expect(paths).toEqual({ tablesDir: 'tables', configDir: 'config', outDir: 'build', outputFormat: 'json' });
    expect(normalizeDir('./a//b/')).toBe('a/b');
    expect(normalizeDir('.')).toBe('');
    expect(joinPath('', 'x.yaml')).toBe('x.yaml');
    expect(joinPath('tables/', 'x.yaml')).toBe('tables/x.yaml');
  });

  it('拡張子と形式', () => {
    expect(formatFromPath('a/b.yml')).toBe('yaml');
    expect(formatFromPath('a/b.json')).toBe('json');
    expect(formatFromPath('a/b.txt')).toBeNull();
    expect(extensionOf('yaml')).toBe('yaml');
  });

  it('内部番号は配った順に増える', () => {
    const uids = new UidAllocator();
    expect([uids.next(), uids.next(), uids.peek()]).toEqual([1, 2, 3]);
  });

  it('既定のセル色は 8 色', () => {
    expect(defaultColors().map((c) => c.color)).toEqual([
      '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#cfe2f3', '#d9d2e9', '#ead1dc',
    ]);
  });

  it('診断のエラーの有無', () => {
    expect(hasErrors([{ severity: 'warning', code: 'x' }])).toBe(false);
    expect(hasErrors([{ severity: 'error', code: 'x' }])).toBe(true);
  });
});
