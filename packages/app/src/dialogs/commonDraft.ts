// 共通設定の編集（FR-TBL-03）の下書きと、下書きから編集の手順を作る処理。DOM に依存しない。
// 列挙型・共通列・セル色の変更を、EditSession.applyGroup で 1 回の操作にする
import type { CellTarget, ColorDef, EditFailure, EnumDef, FieldDef, FieldType, InputContext, Locale, Project } from '@sheetcraft/core';
import {
  EditCode,
  RichCell,
  cellValue,
  cloneFieldDef,
  emptyResult,
  isValidIdentifier,
  renameBaseField,
  renameEnum,
  renameEnumValues,
  setBaseFields,
  setCellColor,
  setColors,
  setEnums,
} from '@sheetcraft/core';
import type { ColumnDraft, DraftErrors, EditStep, FieldError } from './columnDraft';
import { baseFieldDefinitionErrors, buildField, diagnosticKey, draftErrors, draftFromField, freshDefinitionFailures } from './columnDraft';

export interface EnumDraft {
  /** 下書きの中の番号（React の key） */
  id: number;
  /** もとの名前。新しく足したものは null */
  original: string | null;
  name: string;
  display_name: string;
  values: EnumValueDraft[];
}

export interface EnumValueDraft {
  id: number;
  /** もとの値。新しく足したものは null。文字を変えると、この値のセルも新しい値に書き換える */
  original: string | null;
  value: string;
}

export interface ColorDraft {
  id: number;
  original: string | null;
  key: string;
  color: string;
  label: string;
}

export interface BaseFieldDraft {
  id: number;
  /** もとの列定義。新しく足したものは null */
  original: FieldDef | null;
  initial: ColumnDraft;
  draft: ColumnDraft;
}

export interface CommonDraft {
  enums: EnumDraft[];
  baseFields: BaseFieldDraft[];
  colors: ColorDraft[];
}

let nextId = 1;
export function draftId(): number {
  return nextId++;
}

export function enumDraft(def: EnumDef): EnumDraft {
  return { id: draftId(), original: def.name, name: def.name, display_name: def.display_name ?? '', values: def.values.map((v) => ({ id: draftId(), original: v, value: v })) };
}

export function newEnumValueDraft(value: string): EnumValueDraft {
  return { id: draftId(), original: null, value };
}

export function colorDraft(def: ColorDef): ColorDraft {
  return { id: draftId(), original: def.key, key: def.key, color: def.color, label: def.label ?? '' };
}

export function baseFieldDraft(field: FieldDef, timeZone: string): BaseFieldDraft {
  const initial = draftFromField(field, timeZone);
  return { id: draftId(), original: field, initial, draft: { ...initial } };
}

/** 新しく足す共通列の下書き（initial は名前と型だけの列なので、入れた欄はすべて変更として当たる） */
export function newBaseFieldDraft(name: string, type: FieldType, timeZone: string): BaseFieldDraft {
  const initial = draftFromField({ name, type }, timeZone);
  return { id: draftId(), original: null, initial, draft: { ...initial } };
}

export function commonDraftOf(project: Project, timeZone: string): CommonDraft {
  return {
    enums: project.common.enums.items.map(enumDraft),
    baseFields: project.common.base_fields.items.map((f) => baseFieldDraft(f, timeZone)),
    colors: project.common.colors.items.map(colorDraft),
  };
}

/** 値の一覧（前後の空白を除き、空の行は無視する） */
export function enumValues(values: readonly EnumValueDraft[]): string[] {
  return values.map((v) => v.value.trim()).filter((v) => v !== '');
}

/** 値の名前の変更（もとの値があり、文字を変えた行。空にした行は削除として扱う） */
export function enumValueRenames(d: EnumDraft): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const v of d.values) {
    const to = v.value.trim();
    if (v.original !== null && to !== '' && to !== v.original) out.push({ from: v.original, to });
  }
  return out;
}

function toEnumDef(d: EnumDraft): EnumDef {
  const def: EnumDef = { name: d.name.trim(), values: enumValues(d.values) };
  if (d.display_name.trim() !== '') def.display_name = d.display_name;
  return def;
}

function toColorDef(d: ColorDraft): ColorDef {
  const def: ColorDef = { key: d.key.trim(), color: d.color.trim() };
  if (d.label.trim() !== '') def.label = d.label;
  return def;
}

/** キーの順によらない比較（undefined のキーは無いものとする） */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export interface CommonErrors {
  enums: Map<number, Partial<Record<'name' | 'values', FieldError>>>;
  colors: Map<number, Partial<Record<'key' | 'color', FieldError>>>;
  baseFields: Map<number, DraftErrors>;
}

export function hasCommonErrors(errors: CommonErrors): boolean {
  return errors.enums.size > 0 || errors.colors.size > 0 || errors.baseFields.size > 0;
}

/** 下書きの誤り（確定する前に分かるもの） */
export function commonDraftErrors(project: Project, draft: CommonDraft, ctx: InputContext): CommonErrors {
  const errors: CommonErrors = { enums: new Map(), colors: new Map(), baseFields: new Map() };
  const enumNames = new Map<string, number>();
  for (const d of draft.enums) enumNames.set(d.name.trim(), (enumNames.get(d.name.trim()) ?? 0) + 1);
  for (const d of draft.enums) {
    const e: Partial<Record<'name' | 'values', FieldError>> = {};
    const name = d.name.trim();
    if (name === '') e.name = { code: EditCode.commonEmptyName, params: {} };
    else if ((enumNames.get(name) ?? 0) > 1) e.name = { code: EditCode.commonDuplicateName, params: { name } };
    const values = enumValues(d.values);
    const dup = values.find((v, i) => values.indexOf(v) !== i);
    if (dup !== undefined) e.values = { code: 'ui.settings.error.duplicateValue', params: { value: dup } };
    if (e.name !== undefined || e.values !== undefined) errors.enums.set(d.id, e);
  }
  const colorKeys = new Map<string, number>();
  for (const d of draft.colors) colorKeys.set(d.key.trim(), (colorKeys.get(d.key.trim()) ?? 0) + 1);
  for (const d of draft.colors) {
    const e: Partial<Record<'key' | 'color', FieldError>> = {};
    const key = d.key.trim();
    if (key === '') e.key = { code: EditCode.commonEmptyName, params: {} };
    else if ((colorKeys.get(key) ?? 0) > 1) e.key = { code: EditCode.commonDuplicateName, params: { name: key } };
    if (!COLOR_RE.test(d.color.trim())) e.color = { code: 'ui.settings.error.colorCode', params: { input: d.color } };
    if (e.key !== undefined || e.color !== undefined) errors.colors.set(d.id, e);
  }
  const baseNames = new Map<string, number>();
  for (const d of draft.baseFields) baseNames.set(d.draft.name, (baseNames.get(d.draft.name) ?? 0) + 1);
  for (const d of draft.baseFields) {
    const original = d.original ?? { name: d.draft.name, type: d.draft.type };
    const e = draftErrors(original, d.initial, d.draft, ctx);
    if (e.name === undefined && (baseNames.get(d.draft.name) ?? 0) > 1) {
      e.name = { code: EditCode.columnDuplicate, params: { name: d.draft.name } };
    }
    if (e.name === undefined && isValidIdentifier(d.draft.name)) {
      const owner = project.tables.find((t) => t.fields.some((f) => f.name === d.draft.name));
      if (owner !== undefined) e.name = { code: 'ui.settings.error.baseFieldUsed', params: { name: d.draft.name, table: owner.name } };
    }
    if (Object.keys(e).length > 0) errors.baseFields.set(d.id, e);
  }
  return errors;
}

/** 列挙型を使っている列（`テーブル.列`。共通列は列名だけ） */
export function enumUsage(project: Project, name: string): string[] {
  const used: string[] = [];
  for (const f of project.common.base_fields.items) if (f.enum_ref === name) used.push(f.name);
  for (const t of project.tables) for (const f of t.fields) if (f.enum_ref === name) used.push(`${t.name}.${f.name}`);
  return used;
}

/** 列挙型の値ごとの、その値を入れているセルの数（その列挙型を使う列のセル。list<enum> は要素ごとに数える） */
export function enumValueCounts(project: Project, name: string): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (v: unknown) => {
    if (typeof v === 'string') counts.set(v, (counts.get(v) ?? 0) + 1);
  };
  const uses = (f: FieldDef) => (f.type === 'enum' || f.type === 'list<enum>') && f.enum_ref === name;
  const base = project.common.base_fields.items.filter(uses);
  for (const table of project.tables) {
    const columns = [...base, ...table.fields.filter(uses)];
    if (columns.length === 0) continue;
    for (const record of table.records) {
      for (const column of columns) {
        const value = cellValue(record.cells.get(column.name));
        if (Array.isArray(value)) new Set(value).forEach(add);
        else add(value);
      }
    }
  }
  return counts;
}

/** セル色を使っているセル（テーブルの uid → セル） */
export function colorUsage(project: Project, key: string): Map<number, CellTarget[]> {
  const used = new Map<number, CellTarget[]>();
  for (const table of project.tables) {
    for (const record of table.records) {
      for (const [column, cell] of record.cells) {
        if (!(cell instanceof RichCell) || cell.color !== key) continue;
        let list = used.get(table.uid);
        if (list === undefined) {
          list = [];
          used.set(table.uid, list);
        }
        list.push({ record: record.uid, column });
      }
    }
  }
  return used;
}

export function countCells(usage: ReadonlyMap<number, readonly CellTarget[]>): number {
  let n = 0;
  for (const cells of usage.values()) n += cells.length;
  return n;
}

/** 共通列に値の入っているセルの数（共通列を消しても、値はファイルに残る） */
export function baseFieldValueCount(project: Project, name: string): number {
  let n = 0;
  for (const table of project.tables) for (const record of table.records) if (record.cells.has(name)) n++;
  return n;
}

/**
 * 名前の変更を、途中で名前がぶつからない順に並べる（入れ替え・玉突きは仮の名前を通す）。
 * 消す項目は先に消しておくので、ぶつかる相手は名前を変える項目どうしだけ
 */
function renameSteps(renames: readonly { from: string; to: string }[], names: readonly string[], rename: (from: string, to: string) => EditStep): EditStep[] {
  const pending = renames.filter((r) => r.from !== r.to);
  if (pending.length === 0) return [];
  const sources = new Set(pending.map((r) => r.from));
  const conflict = pending.some((r) => sources.has(r.to));
  if (!conflict) return pending.map((r) => rename(r.from, r.to));
  const taken = new Set([...names, ...pending.map((r) => r.to)]);
  const temps = pending.map((r, i) => {
    let temp = `${r.from}__rename${i}`;
    while (taken.has(temp)) temp += '_';
    taken.add(temp);
    return temp;
  });
  return [...pending.map((r, i) => rename(r.from, temps[i])), ...pending.map((r, i) => rename(temps[i], r.to))];
}

export interface CommonChangePlan {
  steps: EditStep[];
  /** 変わる部分（無ければ空。ダイアログを閉じるだけにする） */
  parts: ('enums' | 'base_fields' | 'colors')[];
}

/**
 * 下書きを編集の手順にする。変えていない部分は手順に入れない（共通設定のファイルを作らない）。
 * 列挙型: 名前の変更（renameEnum。列の enum_ref も書き換わる）→ 値の名前の変更（renameEnumValues。セルと default も書き換わる）→ 一覧の置き換え（setEnums）
 * 共通列: 名前の変更（renameBaseField。全テーブルのセルのキー・式・ref も書き換わる）→ 一覧の置き換え（setBaseFields）→ 列定義の検査
 * セル色: 一覧の置き換え（setColors）→ キーを変えた色のセルを新しいキーにする（setCellColor）
 */
export function planCommonChange(project: Project, draft: CommonDraft, ctx: InputContext, locale: Locale): CommonChangePlan {
  const steps: EditStep[] = [];
  const parts: CommonChangePlan['parts'] = [];
  const common = project.common;

  // 列挙型
  const enums = draft.enums.map(toEnumDef);
  const enumRenames = draft.enums.filter((d) => d.original !== null && d.original !== d.name.trim()).map((d) => ({ from: d.original as string, to: d.name.trim() }));
  const valueRenamed = draft.enums.some((d) => d.original !== null && enumValueRenames(d).length > 0);
  if (enumRenames.length > 0 || valueRenamed || !sameValue(enums, common.enums.items)) {
    parts.push('enums');
    // 消した列挙型の名前を、名前の変更の行き先に使えるように、先に消す
    const kept = new Set(draft.enums.map((d) => d.original).filter((n): n is string => n !== null));
    if (common.enums.items.some((e) => !kept.has(e.name))) steps.push((p) => setEnums(p, p.common.enums.items.filter((e) => kept.has(e.name))));
    steps.push(...renameSteps(enumRenames, common.enums.items.map((e) => e.name), (from, to) => (p) => renameEnum(p, { from, to })));
    for (const d of draft.enums) {
      const renames = enumValueRenames(d);
      if (d.original !== null && renames.length > 0) steps.push((p) => renameEnumValues(p, { enum: d.name.trim(), renames }));
    }
    steps.push((p) => setEnums(p, enums));
  }

  // 共通列
  const baseRenames = draft.baseFields
    .filter((d) => d.original !== null && d.original.name !== d.draft.name)
    .map((d) => ({ from: (d.original as FieldDef).name, to: d.draft.name }));
  const changedBase = draft.baseFields.length !== common.base_fields.items.length || draft.baseFields.some((d, i) => d.original !== common.base_fields.items[i] || JSON.stringify(d.draft) !== JSON.stringify(d.initial));
  if (changedBase) {
    parts.push('base_fields');
    const before = new Set(baseFieldDefinitionErrors(project, new Set(common.base_fields.items.map((f) => f.name))).map(diagnosticKey));
    const kept = new Set(draft.baseFields.map((d) => d.original?.name).filter((n): n is string => n !== undefined));
    if (common.base_fields.items.some((f) => !kept.has(f.name))) {
      steps.push((p) => setBaseFields(p, p.common.base_fields.items.filter((f) => kept.has(f.name))));
    }
    steps.push(...renameSteps(baseRenames, common.base_fields.items.map((f) => f.name), (from, to) => (p) => renameBaseField(p, { from, to })));
    steps.push((p) => {
      const current = new Map(p.common.base_fields.items.map((f) => [f.name, f]));
      const fields: FieldDef[] = [];
      const failures: EditFailure[] = [];
      for (const d of draft.baseFields) {
        const base = d.original === null ? { name: d.draft.name, type: d.draft.type } : (current.get(d.draft.name) ?? { ...cloneFieldDef(d.original), name: d.draft.name });
        const built = buildField(base, d.initial, d.draft, ctx);
        if (!built.ok) failures.push(...Object.values(built.errors).map((e) => ({ ...e, column: d.draft.name })));
        else fields.push(built.field);
      }
      if (failures.length > 0) return { ok: false, failures };
      return setBaseFields(p, fields);
    });
    steps.push((p) => {
      const names = new Set(draft.baseFields.map((d) => d.draft.name));
      const failures = freshDefinitionFailures(baseFieldDefinitionErrors(p, names), before, locale);
      return failures.length === 0 ? emptyResult(EditCode.opEditBaseFields) : { ok: false, failures };
    });
  }

  // セル色
  const colors = draft.colors.map(toColorDef);
  const colorRenames = draft.colors.filter((d) => d.original !== null && d.original !== d.key.trim()).map((d) => ({ from: d.original as string, to: d.key.trim() }));
  if (colorRenames.length > 0 || !sameValue(colors, common.colors.items)) {
    parts.push('colors');
    // 名前を変えた色のセルは、変える前の状態で集めておく（入れ替えでも取り違えない）
    const rewrites = colorRenames.map((r) => ({ to: r.to, usage: colorUsage(project, r.from) }));
    steps.push((p) => setColors(p, colors));
    for (const { to, usage } of rewrites) {
      for (const [table, cells] of usage) steps.push((p) => setCellColor(p, { table, cells, color: to }));
    }
  }
  return { steps, parts };
}
