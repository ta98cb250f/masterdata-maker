// テスト専用: サンプルの読み込みと、プロジェクトを正規形のテキストにしたスナップショット
import { loadProject } from '../io/project';
import { serializeCommonPart, serializeTable } from '../io/serialize';
import { createNodeProjectFs, repoRoot } from '../io/testing-node-fs';
import { COMMON_PART_NAMES } from '../model/common';
import type { Project } from '../model/project';
import type { Table } from '../model/table';
import type { Patch } from './patch';
import { applyPatch } from './patch';
import type { EditSession } from './session';

export async function loadSample(name: 'basic-yaml' | 'basic-json' = 'basic-yaml'): Promise<Project> {
  const result = await loadProject(await createNodeProjectFs(`${repoRoot()}/samples/${name}`));
  if (result.status !== 'ok') throw new Error(`サンプルを読み込めない: ${JSON.stringify(result)}`);
  return result.project;
}

export function tableNamed(project: Project, name: string): Table {
  const table = project.tables.find((t) => t.name === name);
  if (table === undefined) throw new Error(`テーブル ${name} が無い`);
  return table;
}

/** レコードの uid（ファイル上の順） */
export function recordUids(project: Project, name: string): number[] {
  return tableNamed(project, name).records.map((r) => r.uid);
}

/** プロジェクトの全テーブルと共通設定を正規形にしたテキスト（内部番号と並びも含める） */
export function snapshot(project: Project): string {
  const parts: string[] = [];
  const base = project.common.base_fields.items;
  for (const table of [...project.tables].sort((a, b) => a.uid - b.uid)) {
    const format = table.source?.format ?? project.config.storage.format;
    parts.push(`# table ${table.uid} ${table.name} [${table.records.map((r) => r.uid).join(',')}]`);
    parts.push(serializeTable(table, base, format));
  }
  parts.push(`# order ${project.tables.map((t) => t.name).join(',')}`);
  for (const part of COMMON_PART_NAMES) {
    const common = project.common[part];
    parts.push(`# ${part} default=${common.isDefault}`);
    parts.push(serializeCommonPart(project.common, part, project.config.storage.format));
  }
  return parts.join('\n');
}

/** 構造化複製（Worker への postMessage と同じ）。core の型検査には DOM や Node の型が無いので globalThis から取る */
export function structuredCloneOf<T>(value: T): T {
  return (globalThis as unknown as { structuredClone<U>(v: U): U }).structuredClone(value);
}

/** セッションの通知を構造化複製して、別のプロジェクト（Worker 側のモデル）に当てる */
export function mirror(session: EditSession, replica: Project): () => void {
  return session.subscribe((event) => {
    if (event.kind === 'saved') return;
    const patches: Patch[] = structuredCloneOf([...event.patches]);
    for (const patch of patches) applyPatch(replica, patch);
  });
}
