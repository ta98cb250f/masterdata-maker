import { describe, expect, it } from 'vitest';
import { Calculator } from '../calc';
import { RichCell } from '../model/cell';
import { validateProject } from '../validate';
import { createTable, deleteRows, deleteTable, enterInput, insertRows, renameColumn, setCellColor, setEnums } from './index';
import { EditSession } from './session';
import { restoreProject, snapshotProject } from './snapshot';
import type { CommandResult } from './transaction';
import { loadSample, mirror, recordUids, snapshot, structuredCloneOf, tableNamed } from './test-helpers';

describe('プロジェクトの複製の受け渡し（計画書 §4.2）', () => {
  it('構造化複製して戻すと、内部番号・並び・RichCell・採番の続きまで同じになる', async () => {
    const project = await loadSample();
    const replica = restoreProject(structuredCloneOf(snapshotProject(project)));
    expect(snapshot(replica)).toBe(snapshot(project));
    expect(replica.uids.peek()).toBe(project.uids.peek());
    expect(replica.tables.map((t) => t.uid)).toEqual(project.tables.map((t) => t.uid));
    const original = tableNamed(project, 'character').records[1].cells.get('hp');
    const copied = tableNamed(replica, 'character').records[1].cells.get('hp');
    expect(original).toBeInstanceOf(RichCell);
    expect(copied).toBeInstanceOf(RichCell);
    expect(copied).toEqual(original);
    expect(copied).not.toBe(original);
    // 複製なので、元を変えても影響しない
    tableNamed(project, 'character').records[0].cells.set('hp', 1);
    expect(tableNamed(replica, 'character').records[0].cells.get('hp')).not.toBe(1);
  });

  it('同じパッチを当て続けると、メインスレッドと同じモデル・同じ検査結果になる', async () => {
    const project = await loadSample();
    const session = new EditSession(project);
    const replica = restoreProject(structuredCloneOf(snapshotProject(project)));
    mirror(session, replica);
    const character = tableNamed(project, 'character').uid;
    const records = recordUids(project, 'character');
    const run = (r: CommandResult) => expect(session.run(r).ok).toBe(true);
    run(enterInput(project, { table: character, cells: [{ record: records[0], column: 'hp' }], text: '0' }));
    run(setCellColor(project, { table: character, cells: [{ record: records[0], column: 'name' }], color: 'red' }));
    run(insertRows(project, { table: character, anchor: records[0], position: 'below', count: 3 }));
    run(deleteRows(project, { table: character, records: [records[1]] }));
    run(renameColumn(project, { table: character, from: 'defense', to: 'guard' }));
    run(setEnums(project, [...project.common.enums.items, { name: 'extra', values: ['a', 'b'] }]));
    run(createTable(project, { name: 'item' }));
    run(deleteTable(project, { table: tableNamed(project, 'stage').uid }));
    session.undo();
    session.undo();
    session.redo();
    expect(snapshot(replica)).toBe(snapshot(project));
    expect(replica.uids.peek()).toBe(project.uids.peek());
    const main = validateProject(project, new Calculator(project));
    const worker = validateProject(replica, new Calculator(replica));
    expect(worker).toEqual(main);
    expect(main.some((d) => d.table === 'character' && d.field === 'hp')).toBe(true);
  });
});
