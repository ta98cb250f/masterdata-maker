import { describe, expect, it } from 'vitest';
import type { SavePlan } from '@sheetcraft/core';
import { MemoryProjectFs, deleteRows, extendTo, getShortcut, selectCell } from '@sheetcraft/core';
import { allCommands } from '../commands';
import { downloadSource } from '../fs/download';
import { basicSampleFiles } from '../fs/sample';
import type { ProjectSource, SaveOutcome } from '../fs/types';
import { copySelection, pasteClipboard, pasteText } from '../grid/clipboard';
import { displayOrder } from '../sheet/model';
import { computeOrder } from '../sheet/sortFilter';
import { AppStore, fitSelection } from './AppStore';

interface Opened {
  store: AppStore;
  saved: SavePlan[];
  uid(name: string): number;
  col(name: string): number;
  row(id: number): number;
  text(row: number, column: string): unknown;
}

/** 組み込みのサンプルを開いた store（保存は記録するだけ） */
async function openSample(files: Record<string, string> = basicSampleFiles()): Promise<Opened> {
  const store = new AppStore({ commands: allCommands(), platform: 'other', validationDelay: 0 });
  const saved: SavePlan[] = [];
  const base = downloadSource('basic-yaml', new MemoryProjectFs(files), 'sample', () => undefined);
  const source: ProjectSource = {
    ...base,
    save: async (plan): Promise<SaveOutcome> => {
      saved.push(plan);
      return { written: plan.files, removed: plan.remove, failed: [], manualRemove: [] };
    },
  };
  expect(await store.open(source)).toBe(true);
  await store.flushValidation();
  const uid = (name: string) => store.tabs().find((t) => t.name === name)?.uid ?? -1;
  return {
    store,
    saved,
    uid,
    col: (name) => store.sheet()?.colOf(name) ?? -1,
    row: (id) => {
      const sheet = store.sheet();
      const record = sheet?.table.records.find((r) => r.cells.get('id') === id);
      return record === undefined || sheet === null ? -1 : sheet.rowOf(record.uid);
    },
    text: (row, column) => {
      const sheet = store.sheet();
      const record = sheet?.recordAt(row);
      return sheet === null || record === undefined ? undefined : store.calc?.getCell(sheet.table, record.uid, column).raw;
    },
  };
}

function select(store: AppStore, row: number, col: number): void {
  const sheet = store.sheet();
  if (sheet === null) throw new Error('no sheet');
  store.setSelection(selectCell({ row, col }, sheet.size));
}

describe('AppStore: 開く・タブ', () => {
  it('サンプルを開くと、テーブル名の昇順のタブができ、最初のテーブルを表示する（P-06）', async () => {
    const { store } = await openSample();
    expect(store.getState().phase).toBe('open');
    expect(store.tabs().map((t) => t.name)).toEqual(['character', 'skill', 'stage']);
    expect(store.table()?.name).toBe('character');
    expect(store.isProjectModified()).toBe(false);
  });

  it('プロジェクトでないフォルダは開かず、理由を残す', async () => {
    const store = new AppStore({ platform: 'other' });
    expect(await store.open(downloadSource('x', new MemoryProjectFs({ 'a.txt': '' })))).toBe(false);
    expect(store.getState().phase).toBe('start');
    expect(store.getState().loadError?.[0]).toContain('プロジェクトのフォルダではありません');
  });

  it('読み込みエラーのテーブルもタブに出し、編集の対象にはしない（P-40）', async () => {
    const files = { ...basicSampleFiles(), 'tables/broken.yaml': 'table: broken\nfields:\n  - name: a\n    type: int\n    required: true\nrecords: []\n' };
    const { store, uid } = await openSample(files);
    const tab = store.tabs().find((t) => t.name === 'broken');
    expect(tab?.broken).toBe(true);
    store.setActiveTable(uid('broken'));
    expect(store.sheet()).toBeNull();
    expect(store.beginEdit()).toBe(false);
    expect((store.issues('broken')?.errors ?? 0) > 0).toBe(true);
  });
});

describe('AppStore: 入力と編集（FR-EDT-01〜06）', () => {
  it('確定すると値が入り、選択が下へ動く。依存する式も計算し直す', async () => {
    const o = await openSample();
    const { store } = o;
    const r = o.row(2);
    select(store, r, o.col('hp'));
    expect(store.beginEdit({ mode: 'overwrite' })).toBe(true);
    store.setEditText('1000');
    expect(store.commitEdit('enter')).toBe(true);
    expect(o.text(r, 'hp')).toBe(1000);
    expect(o.text(r, 'effective_hp')).toBe(2000);
    expect(store.selection()?.anchor).toEqual({ row: r + 1, col: o.col('hp') });
    expect(store.isTableModified(o.uid('character'))).toBe(true);
    expect(store.isProjectModified()).toBe(true);
  });

  it('型に合わない入力は確定させず、理由を残す（FR-EDT-05）', async () => {
    const o = await openSample();
    select(o.store, 0, o.col('hp'));
    o.store.beginEdit({ mode: 'overwrite' });
    o.store.setEditText('12a');
    expect(o.store.commitEdit('enter')).toBe(false);
    const editing = o.store.getState().editing;
    expect(editing?.text).toBe('12a');
    expect(editing?.error?.message).toBe('12a は整数ではありません');
    expect(editing?.error?.hint).toBe('整数を入力してください');
    expect(o.store.selection()?.anchor.row).toBe(0);
    // 直すと確定できる
    o.store.setEditText('12');
    expect(o.store.commitEdit(null)).toBe(true);
    expect(o.text(0, 'hp')).toBe(12);
  });

  it('編集できない列は編集を始めない（FR-EDT-06）。Enter / F2 では今の値から始める', async () => {
    const o = await openSample();
    select(o.store, 0, o.col('id'));
    expect(o.store.beginEdit({ mode: 'overwrite' })).toBe(false);
    expect(o.store.getState().status?.text).toContain('編集できません');
    select(o.store, 0, o.col('element'));
    o.store.beginEdit({ mode: 'edit' });
    expect(o.store.getState().editing?.text).toBe('火, 光');
    o.store.cancelEdit();
    // 列レベル式に従うセルは空から始める（列の式は数式バーに薄く出す）
    select(o.store, 0, o.col('effective_hp'));
    o.store.beginEdit({ mode: 'edit' });
    expect(o.store.getState().editing?.text).toBe('');
    o.store.setEditText('=hp + 1');
    o.store.commitEdit(null);
    expect(o.text(0, 'effective_hp')).toBe(1201);
  });

  it('元に戻す・やり直しで、そのトランザクションのテーブルを表示し、変えた範囲を選ぶ（FR-HIS-02）', async () => {
    const o = await openSample();
    const { store } = o;
    select(store, 0, o.col('hp'));
    store.beginEdit({ mode: 'overwrite', text: '1300' });
    store.commitEdit('enter');
    store.setActiveTable(o.uid('skill'));
    select(store, 1, o.col('cost'));
    store.beginEdit({ mode: 'overwrite', text: '99' });
    store.commitEdit('enter');
    expect(store.undo()).toBe(true);
    expect(store.table()?.name).toBe('skill');
    expect(store.selection()?.anchor).toEqual({ row: 1, col: o.col('cost') });
    expect(store.undo()).toBe(true);
    expect(store.table()?.name).toBe('character');
    expect(store.selection()?.anchor).toEqual({ row: 0, col: o.col('hp') });
    expect(o.text(0, 'hp')).toBe(1200);
    expect(store.isProjectModified()).toBe(false);
    expect(store.redo()).toBe(true);
    expect(o.text(0, 'hp')).toBe(1300);
  });

  it('行が減ったら選択を表の中に収める', async () => {
    const o = await openSample();
    const { store } = o;
    const sheet = store.sheet();
    if (sheet === null) throw new Error();
    store.setSelection(selectCell({ row: 2, col: 3 }, sheet.size));
    store.apply(deleteRows(store.project!, { table: sheet.table.uid, records: [sheet.rowUids[2]] }));
    expect(store.selection()?.anchor).toEqual({ row: 1, col: 3 });
    const all = fitSelection({ kind: 'cols', anchor: { row: 0, col: 1 }, active: { row: 5, col: 1 }, ranges: [{ top: 0, left: 1, bottom: 5, right: 1 }] }, { rows: 2, cols: 3 });
    expect(all.ranges[0]).toEqual({ top: 0, left: 1, bottom: 1, right: 1 });
  });
});

describe('AppStore: 検査（FR-VAL-09）', () => {
  it('開いた直後に全体を検査し、編集の後は変更のあったテーブルを検査し直してセルに印を付ける', async () => {
    const o = await openSample();
    const { store } = o;
    const before = store.getState().validation.version;
    expect(store.issues('character')?.errors).toBe(0);
    select(store, 0, o.col('hp'));
    store.beginEdit({ mode: 'overwrite', text: '0' });
    store.commitEdit(null);
    await store.flushValidation();
    expect(store.getState().validation.version).toBeGreaterThan(before);
    const issues = store.issues('character');
    expect(issues?.errors).toBe(1);
    const recordUid = store.sheet()?.rowUids[0] ?? -1;
    expect(issues?.cells.get(recordUid)?.get('hp')).toBe('error');
    store.undo();
    await store.flushValidation();
    expect(store.issues('character')?.errors).toBe(0);
  });

  it('参照先のテーブルを変えると、参照するテーブルも検査し直す（affectedTables）', async () => {
    const o = await openSample();
    const { store } = o;
    store.setActiveTable(o.uid('skill'));
    // skill の id 3 を 30 に変えると、character の skill_ids [1, 3] が参照先の無い値になる
    select(store, o.row(3), o.col('id'));
    const sheet = store.sheet();
    const record = sheet?.recordAt(o.row(3));
    expect(record).toBeDefined();
    // id は編集できない列なので、貼り付けではなくパッチで変える
    store.apply({ ok: true, tx: { label: 'test', patches: [{ op: 'setCells', table: o.uid('skill'), cells: [{ record: record!.uid, column: 'id', cell: { value: 30 } }] }], inverse: [], tables: [o.uid('skill')] } });
    await store.flushValidation();
    expect(store.issues('character')?.errors).toBeGreaterThan(0);
  });
});

describe('表示の形・並べ替え・フィルタ', () => {
  it('非表示の列は除き、隠れた位置を覚える。固定列は表示中の列で数える（FR-COL-07〜08）', async () => {
    const o = await openSample();
    o.store.setActiveTable(o.uid('stage'));
    const sheet = o.store.sheet();
    expect(sheet?.columns.map((c) => c.name)).toEqual(['id', 'name', 'boss_id']);
    expect(sheet?.columns[1].hiddenBefore).toEqual(['version']);
    expect(sheet?.frozenCount).toBe(1);
    o.store.setActiveTable(o.uid('character'));
    expect(o.store.sheet()?.frozenCount).toBe(2);
    expect(o.store.sheet()?.columns.find((c) => c.name === 'name')?.width).toBe(160);
  });

  it('並べ替えた後に足した行は、ファイル上ですぐ前の行の後ろに出す', () => {
    const records = [1, 2, 3, 9, 4].map((uid) => ({ uid, cells: new Map(), extra: [] }));
    expect(displayOrder(records, null, null)).toEqual([1, 2, 3, 9, 4]);
    // 3, 1, 2 の順に並べ、4 はフィルタで隠した。9 は後から足した行
    expect(displayOrder(records, [3, 1, 2], new Set([1, 2, 3, 4]))).toEqual([3, 9, 1, 2]);
  });

  it('表示だけの並べ替え（降順）とフィルタ。version 列は semver で比べる（FR-SRT-01、03、05）', async () => {
    const o = await openSample();
    const { store } = o;
    const table = store.table();
    const calc = store.calc;
    if (table === undefined || calc === null) throw new Error();
    const ids = (order: number[] | null) => (order ?? table.records.map((r) => r.uid)).map((uid) => table.records.find((r) => r.uid === uid)?.cells.get('id'));
    expect(ids(computeOrder(calc, table, { sort: [{ column: 'hp', direction: 'desc' }], filters: [], onlyIssues: false }))).toEqual([1, 2, 3]);
    expect(ids(computeOrder(calc, table, { sort: [{ column: 'hp', direction: 'asc' }], filters: [], onlyIssues: false }))).toEqual([3, 2, 1]);
    expect(ids(computeOrder(calc, table, { sort: [], filters: [{ column: 'rarity', condition: { type: 'equals', value: 'sr' } }], onlyIssues: false }))).toEqual([2]);
    expect(computeOrder(calc, table, { sort: [], filters: [], onlyIssues: false })).toBeNull();
    store.setActiveTable(o.uid('stage'));
    const stage = store.table();
    if (stage === undefined) throw new Error();
    const order = computeOrder(calc, stage, { sort: [{ column: 'version', direction: 'desc' }], filters: [], onlyIssues: false });
    expect(order?.map((uid) => stage.records.find((r) => r.uid === uid)?.cells.get('version'))).toEqual(['0.1.11', '0.1.2']);
    // store に条件を入れて行の並びを作り直す
    store.updateView(stage.uid, () => ({ sort: [{ column: 'version', direction: 'desc' }] }));
    store.applySortFilter(stage.uid);
    expect(store.sheet()?.rowUids).toEqual(order);
  });
});

describe('AppStore: 保存（FR-FIO-02〜05）', () => {
  it('変更のあるテーブルだけを保存し、未保存の印が消える。何も変えなければ保存しない', async () => {
    const o = await openSample();
    const { store, saved } = o;
    await store.save();
    expect(saved).toHaveLength(0);
    expect(store.getState().status?.text).toBe('保存する変更はありません');
    select(store, 1, o.col('hp'));
    store.beginEdit({ mode: 'overwrite', text: '1000' });
    store.commitEdit(null);
    await store.save();
    expect(saved).toHaveLength(1);
    expect(saved[0].files.map((f) => f.path)).toEqual(['tables/character.yaml']);
    expect(saved[0].files[0].text).toContain('hp: { value: 1000, color: red, comment: 次回調整予定 }');
    expect(store.isProjectModified()).toBe(false);
    expect(store.getState().status?.text).toBe('保存しました（1 ファイル）');
    // 保存しても履歴は消さない（FR-HIS-02）
    expect(store.session?.canUndo()).toBe(true);
  });

  it('編集中に保存すると、先に確定する（確定できなければ保存しない）', async () => {
    const o = await openSample();
    select(o.store, 0, o.col('hp'));
    o.store.beginEdit({ mode: 'overwrite', text: 'abc' });
    await o.store.save();
    expect(o.saved).toHaveLength(0);
    o.store.setEditText('5');
    await o.store.save();
    expect(o.saved).toHaveLength(1);
  });

  it('未保存の変更があれば、捨てる前に確かめる（NFR-17）', async () => {
    const o = await openSample();
    let ran = 0;
    o.store.confirmDiscard(() => {
      ran++;
    });
    expect(ran).toBe(1);
    select(o.store, 0, o.col('hp'));
    o.store.beginEdit({ mode: 'overwrite', text: '5' });
    o.store.commitEdit(null);
    o.store.confirmDiscard(() => {
      ran++;
    });
    expect(ran).toBe(1);
    const dialog = o.store.getState().dialogs.at(-1);
    expect(dialog?.id).toBe('confirm');
    await (dialog?.args as { onConfirm(): Promise<void> | void }).onConfirm();
    expect(ran).toBe(2);
  });
});

describe('コピーと貼り付け（FR-CLP-01〜07）', () => {
  it('本ツールの中のコピーは、セル色・メモも持ち込む。値のみ貼り付けは持ち込まない', async () => {
    const o = await openSample();
    const { store } = o;
    const hp = o.col('hp');
    select(store, 1, hp);
    const copied = copySelection(store, false);
    expect(copied?.tsv).toBe('800');
    expect(store.getState().clipboardMark?.cut).toBe(false);
    select(store, 2, hp);
    expect(pasteText(store, copied?.tsv ?? '', false)).toBe(true);
    const record = store.sheet()?.recordAt(2);
    expect(JSON.stringify(record?.cells.get('hp'))).toContain('次回調整予定');
    store.undo();
    expect(pasteText(store, copied?.tsv ?? '', true)).toBe(true);
    expect(store.sheet()?.recordAt(2)?.cells.get('hp')).toBe(800);
  });

  it('他のアプリのテキストは列の型に変換し、1 セルでも失敗すれば全体を取りやめる（§5.17 の 3 番）', async () => {
    const o = await openSample();
    const { store } = o;
    const hp = o.col('hp');
    select(store, 0, hp);
    expect(pasteClipboard(store, { text: [['10'], ['abc'], ['30']] }, false)).toBe(false);
    const dialog = store.getState().dialogs.at(-1);
    expect((dialog?.args as { items: string[] }).items).toEqual(['2 行目: abc は整数ではありません']);
    expect(o.text(0, 'hp')).toBe(1200);
    store.closeDialog();
    // 1 セルのコピーは範囲全体を埋める（FR-CLP-03）
    const sheet = store.sheet();
    if (sheet === null) throw new Error();
    store.setSelection(extendTo(selectCell({ row: 0, col: hp }, sheet.size), { row: 2, col: hp }, sheet.size));
    expect(pasteText(store, '7', false)).toBe(true);
    expect([o.text(0, 'hp'), o.text(1, 'hp'), o.text(2, 'hp')]).toEqual([7, 7, 7]);
    // 末尾を超えたら行を追加する（FR-CLP-05）
    select(store, 2, hp);
    expect(pasteText(store, '1\n2', false)).toBe(true);
    expect(store.sheet()?.size.rows).toBe(4);
    expect(o.text(3, 'id')).toBe(4);
  });
});

describe('操作の登録簿・ダイアログ・パネル', () => {
  it('ショートカットから操作を引ける。メニューは group ごとに並ぶ', async () => {
    const { store } = await openSample();
    expect(store.commands.byShortcut('undo')?.id).toBe('edit.undo');
    expect(store.commands.byShortcut('save')?.id).toBe('file.save');
    expect(store.commands.byShortcut('moveDown')?.id).toBe('nav.moveDown');
    expect(getShortcut('pasteValues')).toBeDefined();
    expect(store.commands.byShortcut('pasteValues')?.native).toBeDefined();
    const edit = store.commands.menuGroups('edit');
    expect(edit[0].map((d) => d.id)).toEqual(['edit.undo', 'edit.redo']);
    expect(store.isEnabled('edit.undo')).toBe(false);
    // シートタブの + の操作（段階6・7 で登録した）
    expect(store.isEnabled('table.create')).toBe(true);
    // 識別子の重複が無い
    const ids = allCommands().map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const shortcuts = allCommands().flatMap((d) => (d.shortcut === undefined ? [] : [d.shortcut]));
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });

  it('ダイアログは重ねて開け、識別子で閉じる。パネルは位置ごとに 1 つ', async () => {
    const { store } = await openSample();
    const a = store.openDialog('message', { titleKey: 'ui.save.failedTitle' });
    store.openDialog('confirm', { titleKey: 'ui.confirm.discardTitle', onConfirm: () => undefined });
    expect(store.getState().dialogs.map((d) => d.id)).toEqual(['message', 'confirm']);
    store.closeDialog();
    expect(store.getState().dialogs.map((d) => d.key)).toEqual([a]);
    store.closeDialog(a);
    expect(store.getState().dialogs).toEqual([]);
    store.togglePanel('problems', 'bottom');
    expect(store.getState().panels).toEqual({ right: null, bottom: 'problems' });
    expect(store.isPanelOpen('problems')).toBe(true);
    store.openPanel('cellInfo', 'right');
    store.togglePanel('problems', 'bottom');
    expect(store.getState().panels).toEqual({ right: 'cellInfo', bottom: null });
  });
});
