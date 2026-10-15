import { describe, expect, it } from 'vitest';
import type { FieldDef } from '@sheetcraft/core';
import { RichCell, checkColumnTypeChange, formatMessage, inputContext } from '@sheetcraft/core';
import { openSampleStore, recordUid, tableUid } from '../testing/sampleStore';
import type { ColumnDraft } from './columnDraft';
import { buildField, draftErrors, draftFromField, planColumnChange } from './columnDraft';

const TZ = 'Asia/Tokyo';

async function setup(table = 'character') {
  const store = await openSampleStore();
  const project = store.project;
  const session = store.session;
  if (project === null || session === null) throw new Error('not open');
  const uid = tableUid(store, table);
  const field = (name: string): FieldDef => {
    const f = project.tables.find((t) => t.uid === uid)?.fields.find((x) => x.name === name);
    if (f === undefined) throw new Error(`no field ${name}`);
    return f;
  };
  const change = (name: string, edit: Partial<ColumnDraft>) => {
    const original = field(name);
    const initial = draftFromField(original, TZ);
    const draft = { ...initial, ...edit };
    const plan = planColumnChange(project, { table: uid, original, initial, draft, locale: 'ja' });
    return session.applyGroup(plan.label, plan.steps);
  };
  return { store, project, session, uid, field, change };
}

describe('列の設定の下書き（FR-COL-02）', () => {
  it('列定義を下書きにして、変えていない欄はそのまま保つ（書かれていたキーを消さない）', () => {
    const field: FieldDef = { name: 'hp', type: 'int', export: true, validation: { required: true, min: 1 }, anomaly: { warn_above: 5000 } };
    const initial = draftFromField(field, TZ);
    expect(initial).toMatchObject({ name: 'hp', type: 'int', export: true, required: true, min: '1', warn_above: '5000', max: '' });
    const ctx = { enums: [], timeZone: TZ };
    const same = buildField(field, initial, { ...initial }, ctx);
    expect(same).toEqual({ ok: true, field });
    // 変えた欄だけを当てる。既定値（true）に戻したらキーを消す
    const r = buildField(field, initial, { ...initial, display_name: 'HP', max: '9999', required: false, export: false }, ctx);
    expect(r).toEqual({
      ok: true,
      field: { name: 'hp', type: 'int', display_name: 'HP', export: false, validation: { min: 1, max: 9999 }, anomaly: { warn_above: 5000 } },
    });
  });

  it('値の欄は列の型で解釈し、合わなければ理由を返す（FR-EDT-05）', () => {
    const field: FieldDef = { name: 'power', type: 'int64' };
    const initial = draftFromField(field, TZ);
    const ctx = { enums: [], timeZone: TZ };
    const r = buildField(field, initial, { ...initial, default: '12a', min: '9223372036854775807', max_length: '-1', warn_deviation: '0', regex: '(' }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(['default', 'max_length', 'regex', 'warn_deviation']);
    expect(formatMessage(r.errors.default?.code ?? '', r.errors.default?.params, 'ja')).toContain('12a');
    const ok = buildField(field, initial, { ...initial, default: '9007199254740993', min: '0', warn_above: '10000000000000000000' }, ctx);
    expect(ok.ok).toBe(false);
    const good = buildField(field, initial, { ...initial, default: '9007199254740993', min: '0' }, ctx);
    expect(good).toEqual({ ok: true, field: { name: 'power', type: 'int64', default: 9007199254740993n, validation: { min: 0n } } });
  });

  it('datetime の min / max は時差付きの ISO 8601 にする。式は構文を検査する', () => {
    const field: FieldDef = { name: 'start_at', type: 'datetime' };
    const initial = draftFromField(field, TZ);
    const ctx = { enums: [], timeZone: TZ };
    expect(buildField(field, initial, { ...initial, min: '2026-01-01' }, ctx)).toEqual({
      ok: true,
      field: { name: 'start_at', type: 'datetime', validation: { min: '2026-01-01T00:00:00+09:00' } },
    });
    const bad = buildField(field, initial, { ...initial, formula: '=DATE(2026, 1' }, ctx);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.formula?.code).toBe('formula.syntax.missingCloseParen');
  });

  it('列名の書式と列挙型の指定は確定する前に分かる', () => {
    const field: FieldDef = { name: 'a', type: 'string' };
    const initial = draftFromField(field, TZ);
    const ctx = { enums: [], timeZone: TZ };
    expect(Object.keys(draftErrors(field, initial, { ...initial, name: 'Bad Name' }, ctx))).toEqual(['name']);
    expect(Object.keys(draftErrors(field, initial, { ...initial, type: 'enum' }, ctx))).toEqual(['enum_ref']);
    expect(draftErrors(field, initial, { ...initial, type: 'enum', enum_ref: 'rarity' }, ctx)).toEqual({});
  });
});

describe('列の設定の確定（FR-COL-02〜04）', () => {
  it('列名を変えると、同じテーブルの式・セル単位式・他テーブルの ref もまとめて書き換え、1 回で戻せる（FR-COL-03）', async () => {
    const { store, project, session, field, change } = await setup('skill');
    // skill.id は共通列なので、テーブルの列 name を変える。character.skill_ids は skill.id を参照している
    const r = change('cost', { name: 'mp_cost' });
    expect(r.ok).toBe(true);
    expect(field('mp_cost').validation).toEqual({ required: true, min: 0 });
    expect(session.undoLabel()).toBe('edit.op.renameColumn');
    session.undo();
    expect(field('cost').name).toBe('cost');
    expect(project.tables.find((t) => t.name === 'skill')?.records[0].cells.get('cost')).toBe(10);
    expect(store.getState().revision).toBeGreaterThan(0);
  });

  it('列名の変更で列レベル式とセル単位式の列名が書き換わる', async () => {
    const { store, project, field, change } = await setup();
    const r = change('hp', { name: 'max_hp', display_name: '最大HP' });
    expect(r.ok).toBe(true);
    expect(field('effective_hp').formula).toBe('max_hp * (1 + defense / 100)');
    expect(field('max_hp').display_name).toBe('最大HP');
    const table = project.tables.find((t) => t.name === 'character');
    const cell = table?.records.find((x) => x.uid === recordUid(store, 'character', 2))?.cells.get('effective_hp');
    expect(cell instanceof RichCell ? cell.override : undefined).toBe('max_hp * 2');
  });

  it('型の変更: 変換できない値を先に一覧で示し（checkColumnTypeChange）、確定すると変換する（FR-COL-04）', async () => {
    const { project, uid, field, change, session } = await setup();
    const check = checkColumnTypeChange(project, { table: uid, column: 'memo', type: 'int' });
    expect(check.ok && check.issues.map((i) => i.input)).toEqual(['主人公', '一行目\n二行目']);
    const r = change('defense', { type: 'float' });
    expect(r.ok).toBe(true);
    expect(field('defense')).toMatchObject({ type: 'float', default: 0 });
    expect(session.undoLabel()).toBe('edit.op.changeColumnType');
  });

  it('列定義の検査（FR-VAL-07）で新しいエラーが出るなら、確定させず何も変えない', async () => {
    const { project, field, change, session } = await setup();
    const before = session.undoCount;
    // name（max_length 付きの文字列）を int にすると max_length が使えない
    const r = change('name', { type: 'int' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures.map((f) => f.code)).toEqual(['ui.column.error.definition']);
    expect(field('name').type).toBe('string');
    expect(session.undoCount).toBe(before);
    // 存在しない列を参照する式
    const bad = change('effective_hp', { formula: 'nothing * 2' });
    expect(bad.ok).toBe(false);
    expect(field('effective_hp').formula).toBe('hp * (1 + defense / 100)');
    // 参照先の表（存在しない列）
    const ref = change('memo', { ref_table: 'skill', ref_column: 'nothing' });
    expect(ref.ok).toBe(false);
    expect(project.tables.find((t) => t.name === 'character')?.fields.find((f) => f.name === 'memo')?.ref).toBeUndefined();
  });

  it('入力が型に合わなければ確定しない', async () => {
    const { field, change } = await setup();
    const r = change('defense', { default: 'abc' });
    expect(r.ok).toBe(false);
    expect(field('defense').default).toBe(0);
  });

  it('ctx: inputContext は列挙型の値で既定値を解釈する', async () => {
    const { project, field, change } = await setup();
    expect(inputContext(project).enums.length).toBe(2);
    expect(change('rarity', { default: 'ssr' }).ok).toBe(true);
    expect(field('rarity').default).toBe('SSR');
  });
});
