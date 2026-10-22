import { describe, expect, it } from 'vitest';
import { RichCell, inputContext } from '@masterdata-maker/core';
import { openSampleStore, recordUid } from '../testing/sampleStore';
import type { CommonDraft } from './commonDraft';
import { colorDraft, colorUsage, commonDraftErrors, commonDraftOf, countCells, enumDraft, enumUsage, enumValueCounts, hasCommonErrors, newBaseFieldDraft, newEnumValueDraft, planCommonChange } from './commonDraft';

const TZ = 'Asia/Tokyo';

async function setup() {
  const store = await openSampleStore();
  const project = store.project;
  const session = store.session;
  if (project === null || session === null) throw new Error('not open');
  const apply = (draft: CommonDraft) => {
    const plan = planCommonChange(project, draft, inputContext(project), 'ja');
    return { plan, result: session.applyGroup('ui.settings.op', plan.steps) };
  };
  return { store, project, session, draft: () => commonDraftOf(project, TZ), apply };
}

describe('共通設定の編集（FR-TBL-03）', () => {
  it('何も変えなければ手順は空（共通設定のファイルを作らない）', async () => {
    const { project, draft } = await setup();
    expect(planCommonChange(project, draft(), inputContext(project), 'ja').steps).toEqual([]);
  });

  it('列挙型の名前の変更は列の enum_ref も書き換え、値の編集と追加・削除と合わせて 1 回で戻せる', async () => {
    const { project, session, draft, apply } = await setup();
    const d = draft();
    d.enums[0] = { ...d.enums[0], name: 'grade', values: [...d.enums[0].values, newEnumValueDraft('UR')] };
    d.enums.splice(1, 1);
    d.enums.push({ ...enumDraft({ name: 'size', values: ['S', 'M'] }), original: null });
    expect(enumUsage(project, 'rarity')).toEqual(['character.rarity']);
    const { plan, result } = apply(d);
    expect(plan.parts).toEqual(['enums']);
    expect(result.ok).toBe(true);
    expect(project.common.enums.items.map((e) => [e.name, e.values.length])).toEqual([
      ['grade', 5],
      ['size', 2],
    ]);
    expect(project.tables.find((t) => t.name === 'character')?.fields.find((f) => f.name === 'rarity')?.enum_ref).toBe('grade');
    session.undo();
    expect(project.common.enums.items.map((e) => e.name)).toEqual(['rarity', 'element']);
    expect(project.tables.find((t) => t.name === 'character')?.fields.find((f) => f.name === 'rarity')?.enum_ref).toBe('rarity');
  });

  it('列挙型の名前の入れ替えもできる', async () => {
    const { project, draft, apply } = await setup();
    const d = draft();
    d.enums[0] = { ...d.enums[0], name: 'element' };
    d.enums[1] = { ...d.enums[1], name: 'rarity' };
    expect(apply(d).result.ok).toBe(true);
    const fields = project.tables.find((t) => t.name === 'character')?.fields;
    expect(fields?.find((f) => f.name === 'rarity')?.enum_ref).toBe('element');
    expect(fields?.find((f) => f.name === 'element')?.enum_ref).toBe('rarity');
  });

  it('列挙型の値の名前を変えると、その値のセル（list<enum> は要素ごと）も書き換え、列挙型の名前の変更と合わせて 1 回で戻せる', async () => {
    const { project, session, draft, apply } = await setup();
    const character = () => project.tables.find((t) => t.name === 'character');
    expect(enumValueCounts(project, 'element').get('火')).toBe(2);
    const d = draft();
    d.enums[0] = { ...d.enums[0], name: 'grade' };
    d.enums[0].values = d.enums[0].values.map((v) => (v.value === 'SR' ? { ...v, value: 'SuperRare' } : v));
    d.enums[1].values = d.enums[1].values.map((v) => (v.value === '火' ? { ...v, value: '炎' } : v));
    const { plan, result } = apply(d);
    expect(plan.parts).toEqual(['enums']);
    expect(result.ok).toBe(true);
    expect(project.common.enums.items.map((e) => [e.name, e.values])).toEqual([
      ['grade', ['N', 'R', 'SuperRare', 'SSR']],
      ['element', ['炎', '水', '風', '光', '闇']],
    ]);
    expect(character()?.records[1].cells.get('rarity')).toBe('SuperRare');
    expect(character()?.records[0].cells.get('element')).toEqual(['炎', '光']);
    expect(project.tables.find((t) => t.name === 'skill')?.records[0].cells.get('element')).toBe('炎');
    session.undo();
    expect(project.common.enums.items[0].name).toBe('rarity');
    expect(character()?.records[1].cells.get('rarity')).toBe('SR');
    expect(character()?.records[0].cells.get('element')).toEqual(['火', '光']);
  });

  it('列挙型の値の入れ替えもできる。空にした行は削除として扱い、セルは書き換えない', async () => {
    const { project, draft, apply } = await setup();
    const rarity = (i: number) => project.tables.find((t) => t.name === 'character')?.records[i].cells.get('rarity');
    const d = draft();
    d.enums[0].values = d.enums[0].values.map((v) => (v.value === 'SR' ? { ...v, value: 'SSR' } : v.value === 'SSR' ? { ...v, value: 'SR' } : v.value === 'R' ? { ...v, value: '' } : v));
    expect(apply(d).result.ok).toBe(true);
    expect(project.common.enums.items[0].values).toEqual(['N', 'SSR', 'SR']);
    expect([rarity(0), rarity(1), rarity(2)]).toEqual(['SR', 'SSR', 'R']);
  });

  it('セル色のキーを変えると、その色のセルも新しいキーになる', async () => {
    const { store, project, draft, apply } = await setup();
    expect(countCells(colorUsage(project, 'red'))).toBe(1);
    const d = draft();
    d.colors[0] = { ...d.colors[0], key: 'danger', color: '#ff0000', label: '危険' };
    d.colors.push({ ...colorDraft({ key: 'gray', color: '#cccccc' }), original: null });
    expect(apply(d).result.ok).toBe(true);
    expect(project.common.colors.items[0]).toEqual({ key: 'danger', color: '#ff0000', label: '危険' });
    const cell = project.tables.find((t) => t.name === 'character')?.records.find((r) => r.uid === recordUid(store, 'character', 2))?.cells.get('hp');
    expect(cell instanceof RichCell ? cell.color : undefined).toBe('danger');
  });

  it('共通列: 名前の変更（全テーブルのセルのキーも）と、追加・設定の変更', async () => {
    const { project, draft, apply } = await setup();
    const d = draft();
    const version = d.baseFields[1];
    d.baseFields[1] = { ...version, draft: { ...version.draft, name: 'ver', display_name: '版' } };
    d.baseFields.push(newBaseFieldDraft('note', 'string', TZ));
    expect(apply(d).result.ok).toBe(true);
    expect(project.common.base_fields.items.map((f) => f.name)).toEqual(['id', 'ver', 'note']);
    expect(project.common.base_fields.items[1]).toEqual({ name: 'ver', type: 'string', display_name: '版' });
    expect(project.tables.find((t) => t.name === 'stage')?.records[0].cells.get('ver')).toBe('0.1.2');
    expect(project.tables.find((t) => t.name === 'stage')?.view.hidden_columns).toEqual(['ver']);
  });

  it('下書きの誤り: 名前の重複・空・色コード・テーブルの列と同じ共通列の名前', async () => {
    const { project, draft } = await setup();
    const d = draft();
    d.enums[1] = { ...d.enums[1], name: 'rarity' };
    d.colors[0] = { ...d.colors[0], key: '', color: 'red' };
    d.baseFields.push(newBaseFieldDraft('name', 'string', TZ));
    const errors = commonDraftErrors(project, d, inputContext(project));
    expect(hasCommonErrors(errors)).toBe(true);
    expect([...errors.enums.values()].map((e) => e.name?.code)).toEqual(['edit.error.commonDuplicateName', 'edit.error.commonDuplicateName']);
    expect(errors.colors.get(d.colors[0].id)).toMatchObject({ key: { code: 'edit.error.commonEmptyName' }, color: { code: 'ui.settings.error.colorCode' } });
    expect(errors.baseFields.get(d.baseFields[2].id)?.name?.code).toBe('ui.settings.error.baseFieldUsed');
  });
});
