import { describe, expect, it } from 'vitest';
import type { Project } from '@sheetcraft/core';
import { enterInput, insertColumn } from '@sheetcraft/core';
import { strFromU8, unzipSync } from 'fflate';
import type { AppStore } from './AppStore';
import { formatExportError, runExport } from './exportOutput';
import { testSource } from './testProject';
import { openTestStore } from './testProject';

function setHp(store: AppStore, text: string): void {
  const project = store.project as Project;
  const t = project.tables.find((x) => x.name === 'character');
  if (t === undefined) throw new Error('no table');
  expect(store.apply(enterInput(project, { table: t.uid, cells: [{ record: t.records[0].uid, column: 'hp' }], text })).ok).toBe(true);
}

function downloads() {
  const got: { name: string; blob: Blob }[] = [];
  return { got, download: (blob: Blob, name: string) => got.push({ name, blob }) };
}

describe('画面からの出力（FR-OUT-06、FR-OUT-05）', () => {
  it('ダウンロード保存方式では、1 テーブルならそのファイル、複数なら ZIP をダウンロードする', async () => {
    const { store } = await openTestStore();
    const one = downloads();
    const single = await runExport(store, { tables: ['skill'], force: false }, { download: one.download });
    expect(single).toEqual({ status: 'downloaded', name: 'skill.json', files: ['build/skill.json'] });
    expect(JSON.parse(await one.got[0].blob.text())[0].id).toBe(1);

    const many = downloads();
    const all = await runExport(store, { tables: ['character', 'skill', 'stage'], force: false }, { download: many.download });
    expect(all.status).toBe('downloaded');
    expect(many.got[0].name).toBe('basic-yaml-build.zip');
    const zip = unzipSync(new Uint8Array(await many.got[0].blob.arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual(['build/character.json', 'build/skill.json', 'build/stage.json']);
    expect(JSON.parse(strFromU8(zip['build/character.json']))[0].hp).toBe(1200);
  });

  it('検査エラーがあれば出力せず、エラーを示す。強制すれば出力する。保存していない変更も出力に含む', async () => {
    const { store } = await openTestStore();
    setHp(store, '0');
    const d = downloads();
    const blocked = await runExport(store, { tables: ['character'], force: false }, { download: d.download });
    expect(blocked).toMatchObject({ status: 'errors', forceable: true });
    expect(d.got).toEqual([]);
    const lines = blocked.status === 'errors' ? blocked.errors.map((e) => formatExportError(store, e)) : [];
    expect(lines.some((l) => l.startsWith('character / 1 / hp: '))).toBe(true);
    const forced = await runExport(store, { tables: ['character'], force: true }, { download: d.download });
    expect(forced.status).toBe('downloaded');
    expect(JSON.parse(await d.got[0].blob.text())[0].hp).toBe(0);
  });

  it('版を指定すると、version がその版以下のレコードだけを出す（FR-OUT-07）', async () => {
    const { store } = await openTestStore();
    const d = downloads();
    const result = await runExport(store, { tables: ['stage'], force: false, version: '0.1.10' }, { download: d.download });
    expect(result.status).toBe('downloaded');
    expect((JSON.parse(await d.got[0].blob.text()) as { id: number }[]).map((r) => r.id)).toEqual([1]);
  });

  it('protobuf の名前の問題は強制しても出力できない（P-63）', async () => {
    const { store } = await openTestStore();
    const d = downloads();
    // stage の列 boss_id と JSON 名（bossId）が重なる列 boss__id を足す
    const project = store.project as Project;
    const stage = project.tables.find((x) => x.name === 'stage');
    if (stage === undefined) throw new Error('no table');
    expect(store.apply(insertColumn(project, { table: stage.uid, position: { index: 0 }, field: { name: 'boss__id', type: 'int' } })).ok).toBe(true);
    const result = await runExport(store, { tables: ['stage'], force: true, format: 'protobuf' }, { download: d.download });
    expect(result).toMatchObject({ status: 'errors', forceable: false });
    expect(d.got).toEqual([]);
  });

  it('直接保存方式では、出力先のフォルダ（out_dir）に書き込む', async () => {
    const { store, fs } = await openTestStore();
    const written: Record<string, string> = {};
    const source = { ...testSource(fs, { kind: 'direct', name: 'proj' }), fs: Object.assign(Object.create(fs) as typeof fs, { write: async (p: string, t: string) => void (written[p] = t) }) };
    store.setState({ source });
    const result = await runExport(store, { tables: ['character', 'skill'], force: false });
    expect(result).toEqual({ status: 'written', outDir: 'build', files: ['build/character.json', 'build/skill.json'], failed: [] });
    expect(Object.keys(written).sort()).toEqual(['build/character.json', 'build/skill.json']);
  });
});
