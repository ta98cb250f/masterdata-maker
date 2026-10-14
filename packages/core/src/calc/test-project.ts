// テスト用: メモリ上のファイルからプロジェクトを作る（*.test.ts から使う）
import { loadProject } from '../io/project';
import { MemoryProjectFs } from '../io/memory-fs';
import { createNodeProjectFs, repoRoot } from '../io/testing-node-fs';
import type { Project } from '../model/project';
import type { Table } from '../model/table';

export const TEST_CONFIG = 'format_version: 1\nstorage:\n  format: yaml\ntimezone: Asia/Tokyo\n';

export interface TestProjectFiles {
  /** テーブル名 → テーブルファイルの本文（`table:` 行は自動で付ける） */
  tables: Record<string, string>;
  /** config/enums.yaml の本文 */
  enums?: string;
  /** config/base_fields.yaml の本文 */
  baseFields?: string;
  /** sheetcraft.yaml の本文 */
  config?: string;
}

export function testFiles(files: TestProjectFiles): MemoryProjectFs {
  const fs = new MemoryProjectFs({ 'sheetcraft.yaml': files.config ?? TEST_CONFIG });
  if (files.enums !== undefined) fs.write('config/enums.yaml', files.enums);
  if (files.baseFields !== undefined) fs.write('config/base_fields.yaml', files.baseFields);
  for (const [name, body] of Object.entries(files.tables)) fs.write(`tables/${name}.yaml`, `table: ${name}\n${body}`);
  return fs;
}

export async function testProject(files: TestProjectFiles): Promise<Project> {
  const result = await loadProject(testFiles(files));
  if (result.status !== 'ok') throw new Error(`読み込めない: ${JSON.stringify(result)}`);
  return result.project;
}

export async function loadSample(name: string): Promise<Project> {
  const result = await loadProject(await createNodeProjectFs(`${repoRoot()}/samples/${name}`));
  if (result.status !== 'ok') throw new Error(`読み込めない: ${JSON.stringify(result)}`);
  return result.project;
}

export function tableOf(project: Project, name: string): Table {
  const table = project.tables.find((t) => t.name === name);
  if (table === undefined) throw new Error(`テーブル ${name} が無い（${JSON.stringify(project.brokenTables.map((t) => t.diagnostics))}）`);
  return table;
}

/** 主キー（id）の値でレコードの内部番号を探す */
export function uidOf(table: Table, id: number | bigint | string): number {
  const record = table.records.find((r) => {
    const v = r.cells.get('id');
    return v === id || (typeof v === 'bigint' && BigInt(id) === v);
  });
  if (record === undefined) throw new Error(`id ${String(id)} が無い`);
  return record.uid;
}
