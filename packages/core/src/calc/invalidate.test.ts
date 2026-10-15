import { describe, expect, it } from 'vitest';
import { EditSession } from '../edit/session';
import { enterInput } from '../edit/commands/cells';
import { insertRows } from '../edit/commands/rows';
import { renameTable, setColors } from '../edit/commands/tables';
import { setColumnWidth, updateColumn } from '../edit/commands/columns';
import { Calculator } from './calculator';
import { invalidateForPatches } from './invalidate';
import { tableOf, testProject, uidOf } from './test-project';

async function setup() {
  const project = await testProject({
    tables: {
      a: `fields:
  - { name: hp, type: int }
  - { name: double, type: int, formula: hp * 2 }
records:
  - id: 1
    hp: 10
`,
      b: `fields:
  - { name: key, type: int }
  - { name: hp_of_a, type: int, formula: 'REF("a", key, "hp")' }
records:
  - id: 1
    key: 1
`,
    },
  });
  const calc = new Calculator(project);
  const session = new EditSession(project);
  session.subscribe((event) => {
    if (event.kind !== 'saved') invalidateForPatches(calc, event.patches);
  });
  return { project, calc, session, a: tableOf(project, 'a'), b: tableOf(project, 'b') };
}

describe('invalidateForPatch', () => {
  it('セルの変更で、同じテーブルの式と REF で参照する式が計算し直される。元に戻しても同じ', async () => {
    const { project, calc, session, a, b } = await setup();
    const ra = uidOf(a, 1);
    const rb = uidOf(b, 1);
    expect(calc.getCell(a, ra, 'double').raw).toBe(20);
    expect(calc.getCell(b, rb, 'hp_of_a').raw).toBe(10);
    session.run(enterInput(project, { table: a.uid, cells: [{ record: ra, column: 'hp' }], text: '25' }));
    expect(calc.getCell(a, ra, 'double').raw).toBe(50);
    expect(calc.getCell(b, rb, 'hp_of_a').raw).toBe(25);
    session.undo();
    expect(calc.getCell(a, ra, 'double').raw).toBe(20);
    expect(calc.getCell(b, rb, 'hp_of_a').raw).toBe(10);
    session.redo();
    expect(calc.getCell(b, rb, 'hp_of_a').raw).toBe(25);
  });

  it('行の追加・列定義の変更・テーブル名の変更でも計算し直される', async () => {
    const { project, calc, session, a, b } = await setup();
    const rb = uidOf(b, 1);
    const r = session.run(insertRows(project, { table: a.uid, anchor: null, position: 'below', count: 1 }));
    expect(r.ok).toBe(true);
    const added = a.records[a.records.length - 1];
    expect(calc.getCell(a, added.uid, 'id').raw).toBe(2);

    const double = a.fields.find((f) => f.name === 'double');
    expect(double).toBeDefined();
    session.run(updateColumn(project, { table: a.uid, column: 'double', field: { ...double!, formula: 'hp * 3' } }));
    expect(calc.getCell(a, uidOf(a, 1), 'double').raw).toBe(30);

    session.run(renameTable(project, { table: a.uid, name: 'a2' }));
    // REF("a", …) の参照先は書き換えられて a2 を指す
    expect(calc.getCell(b, rb, 'hp_of_a').raw).toBe(10);
    session.undo();
    expect(calc.getCell(b, rb, 'hp_of_a').raw).toBe(10);
  });

  it('表示設定とセル色のプリセットの変更では何も捨てない（結果は変わらない）', async () => {
    const { project, calc, session, a } = await setup();
    const before = calc.getCell(a, uidOf(a, 1), 'double');
    session.run(setColumnWidth(project, { table: a.uid, columns: ['hp'], width: 150 }));
    session.run(setColors(project, [{ key: 'red', color: '#ff0000' }]));
    expect(calc.getCell(a, uidOf(a, 1), 'double')).toBe(before);
  });
});
