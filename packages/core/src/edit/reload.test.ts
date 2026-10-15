import { beforeEach, describe, expect, it } from 'vitest';
import { parseCommonFile, parseTableFile } from '../io/parse';
import type { Project } from '../model/project';
import type { EnumDef } from '../model/common';
import { enterInput, setEnums } from './index';
import type { EditEvent } from './session';
import { EditSession } from './session';
import { restoreProject, snapshotProject } from './snapshot';
import { loadSample, mirror, recordUids, snapshot, structuredCloneOf, tableNamed } from './test-helpers';
import type { CommandResult } from './transaction';

let project: Project;
let session: EditSession;
let events: EditEvent[];

beforeEach(async () => {
  project = await loadSample();
  session = new EditSession(project);
  events = [];
  session.subscribe((e) => events.push(e));
});

function run(r: CommandResult): void {
  expect(session.run(r).ok).toBe(true);
}

function setHp(text: string, index = 0): void {
  const table = tableNamed(project, 'character');
  run(enterInput(project, { table: table.uid, cells: [{ record: table.records[index].uid, column: 'hp' }], text }));
}

function setSkillCost(text: string): void {
  const table = tableNamed(project, 'skill');
  run(enterInput(project, { table: table.uid, cells: [{ record: table.records[0].uid, column: 'cost' }], text }));
}

/** ファイルの今のテキストを書き換えたものとして読み直す */
function reparse(name: string, edit: (text: string) => string) {
  const table = tableNamed(project, name);
  const path = table.source?.path as string;
  const text = edit(table.source?.text as string);
  return { path, text, next: parseTableFile(path, text, { baseFields: project.common.base_fields.items, uids: project.uids, storageFormat: 'yaml' }) };
}

describe('外部で書き換えられたファイルの読み込み直し（FR-FIO-07）', () => {
  it('テーブルを読み直すと未保存の変更は消え、読み直したテキストが基準になる。そのテーブルを指す履歴は消す', () => {
    const replica = restoreProject(structuredCloneOf(snapshotProject(project)));
    mirror(session, replica);
    const uid = tableNamed(project, 'character').uid;
    setHp('4321');
    expect(session.isTableModified(uid)).toBe(true);
    const { next } = reparse('character', (t) => t.replace('hp: 1200', 'hp: 1300'));
    const result = session.reloadFiles({ tables: [{ uid, next }] });
    expect(result.historyCleared).toBe(true);
    expect(session.canUndo()).toBe(false);
    const table = tableNamed(project, 'character');
    expect(table.uid).toBe(uid);
    expect(table.records[0].cells.get('hp')).toBe(1300);
    expect(session.isTableModified(uid)).toBe(false);
    expect(session.isTableDirty(uid)).toBe(false);
    expect(session.planSave().files).toEqual([]);
    const event = events[events.length - 1];
    expect(event.kind).toBe('reload');
    // Worker 側のモデルも同じパッチで同じになる
    expect(snapshot(replica)).toBe(snapshot(project));
    // 読み直した後の編集も元に戻せる
    setHp('1');
    expect(session.undo()).toBeDefined();
    expect(tableNamed(project, 'character').records[0].cells.get('hp')).toBe(1300);
  });

  it('読み直したテーブルを指さない履歴は残す', () => {
    setSkillCost('7');
    const uid = tableNamed(project, 'character').uid;
    const { next } = reparse('character', (t) => t.replace('hp: 1200', 'hp: 1300'));
    expect(session.reloadFiles({ tables: [{ uid, next }] }).historyCleared).toBe(false);
    expect(session.canUndo()).toBe(true);
    session.undo();
    expect(tableNamed(project, 'skill').records[0].cells.get('cost')).not.toBe(7);
  });

  it('読み込みエラーになったテーブルは読み込みエラーのテーブルに移し、保存でファイルを消さない。直れば戻せる', () => {
    const uid = tableNamed(project, 'character').uid;
    const broken = reparse('character', (t) => `${t}\n  : [`);
    expect(broken.next.kind).toBe('broken');
    session.reloadFiles({ tables: [{ uid, next: broken.next }] });
    expect(project.tables.some((t) => t.uid === uid)).toBe(false);
    expect(project.brokenTables.find((t) => t.uid === uid)?.name).toBe('character');
    expect(session.planSave()).toEqual({ files: [], remove: [] });
    expect(session.hasUnsavedChanges()).toBe(false);

    const fixed = parseTableFile(broken.path, broken.text.replace('\n  : [', ''), {
      baseFields: project.common.base_fields.items,
      uids: project.uids,
      storageFormat: 'yaml',
    });
    session.reloadFiles({ tables: [{ uid, next: fixed }] });
    expect(project.brokenTables).toEqual([]);
    expect(tableNamed(project, 'character').uid).toBe(uid);
    expect(session.isTableDirty(uid)).toBe(false);
  });

  it('消されたファイルのテーブルは取り除き、保存で消すファイルにも入れない', () => {
    const uid = tableNamed(project, 'stage').uid;
    session.reloadFiles({ tables: [{ uid, next: null }] });
    expect(project.tables.some((t) => t.uid === uid)).toBe(false);
    expect(session.removedTableFiles()).toEqual([]);
    expect(session.hasUnsavedChanges()).toBe(false);
  });

  it('ほかのテーブルと同じ名前になったら、読み込みエラーにする', () => {
    const uid = tableNamed(project, 'stage').uid;
    const { next } = reparse('stage', (t) => t.replace(/^table: stage$/m, 'table: skill'));
    session.reloadFiles({ tables: [{ uid, next }] });
    const broken = project.brokenTables.find((t) => t.uid === uid);
    expect(broken?.diagnostics.some((d) => d.code === 'io.duplicateTableName')).toBe(true);
    expect(tableNamed(project, 'skill').name).toBe('skill');
  });

  it('共通設定を読み直すと値が変わり、その共通設定を変えた履歴は消す', () => {
    run(setEnums(project, [...project.common.enums.items, { name: 'extra', values: ['a'] }]));
    const source = project.common.enums.source;
    expect(source).not.toBeNull();
    const text = `${source?.text}  - name: added\n    values: [x, y]\n`;
    const parsed = parseCommonFile('enums', source?.path as string, text);
    expect(parsed.ok).toBe(true);
    const items = (parsed.ok ? parsed.value : []) as EnumDef[];
    const result = session.reloadFiles({ common: [{ part: 'enums', next: { items, source: { path: source?.path as string, format: 'yaml', text } } }] });
    expect(result.historyCleared).toBe(true);
    expect(project.common.enums.items.map((e) => e.name)).toContain('added');
    expect(project.common.enums.items.map((e) => e.name)).not.toContain('extra');
    expect(session.isCommonDirty('enums')).toBe(false);
  });
});

describe('外部で書き換えられたファイルを、エディタの内容で上書きする（FR-FIO-07）', () => {
  it('変更の無いテーブルでも、ファイルの内容と違えば未保存になり、保存で書き込む', () => {
    const uid = tableNamed(project, 'character').uid;
    const original = tableNamed(project, 'character').source?.text as string;
    const changed = original.replace('hp: 1200', 'hp: 1300');
    session.keepEditorContent({ tables: [{ uid, text: changed }] });
    expect(events[events.length - 1].kind).toBe('saved');
    expect(session.isTableModified(uid)).toBe(true);
    const plan = session.planSave();
    expect(plan.files.map((f) => f.path)).toEqual(['tables/character.yaml']);
    expect(plan.files[0].text).toBe(original);
    session.markSaved(plan.files);
    expect(session.isTableModified(uid)).toBe(false);
  });

  it('ファイルの内容がエディタの内容と同じなら未保存にしない。消されたファイルは作り直す', () => {
    const character = tableNamed(project, 'character');
    session.keepEditorContent({ tables: [{ uid: character.uid, text: character.source?.text as string }] });
    expect(session.isTableModified(character.uid)).toBe(false);
    const skill = tableNamed(project, 'skill');
    session.keepEditorContent({ tables: [{ uid: skill.uid, text: null }] });
    expect(session.planSave().files.map((f) => f.path)).toEqual(['tables/skill.yaml']);
    expect(recordUids(project, 'skill').length).toBeGreaterThan(0);
  });
});
