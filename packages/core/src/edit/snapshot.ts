// プロジェクトの複製の受け渡し（計画書 §4.2）。検査用の Web Worker に、内部番号（uid）を保ったまま今のモデルを渡す。
// 受け渡しは構造化複製（postMessage / structuredClone）で行う。構造化複製はクラスのインスタンスをプレーンなオブジェクトにするので、
// RichCell は CellData と同じ形（value・override・color・comment・extra）のオブジェクトになる。受け取った側で RichCell に戻す
import type { Cell, ExtraValue } from '../model/cell';
import type { CommonConfig } from '../model/common';
import type { Diagnostic } from '../model/diagnostic';
import type { Project, ProjectConfig } from '../model/project';
import type { BrokenTable, Table } from '../model/table';
import { UidAllocator } from '../model/uid';
import type { CellData } from './patch';
import { fromCellData } from './patch';

/** 受け渡し用のレコード。値だけのセルは値そのもの、RichCell は CellData の形 */
export interface RecordSnapshot {
  uid: number;
  cells: Map<string, Cell | CellData>;
  extra: [string, ExtraValue][];
}

export interface TableSnapshot extends Omit<Table, 'records'> {
  records: RecordSnapshot[];
}

export interface ProjectSnapshot {
  config: ProjectConfig;
  common: CommonConfig;
  tables: TableSnapshot[];
  brokenTables: BrokenTable[];
  diagnostics: Diagnostic[];
  /** 内部番号の続き（UidAllocator はクラスなので数で渡す） */
  nextUid: number;
}

/**
 * プロジェクトを受け渡し用の形にする。速さのため複製はせず、モデルのオブジェクトをそのまま指す
 * （1 万行 × 50 列でも、ここでの手間は無い）。戻り値は書き換えず、すぐに postMessage か structuredClone に渡すこと
 */
export function snapshotProject(project: Project): ProjectSnapshot {
  return {
    config: project.config,
    common: project.common,
    tables: project.tables,
    brokenTables: project.brokenTables,
    diagnostics: project.diagnostics,
    nextUid: project.uids.peek(),
  };
}

/** 値だけのセル（RawValue）でないオブジェクトは RichCell の複製 */
function isCellObject(cell: Cell | CellData): cell is CellData {
  return typeof cell === 'object' && cell !== null && !Array.isArray(cell);
}

/**
 * 受け渡し用の形（構造化複製したもの）からプロジェクトを作る。内部番号は送った側と同じになる。
 * 速さのため snapshot を書き換えて使う（受け取った複製をそのまま渡す前提）
 */
export function restoreProject(snapshot: ProjectSnapshot): Project {
  for (const table of snapshot.tables) {
    for (const record of table.records) {
      for (const [name, cell] of record.cells) {
        if (!isCellObject(cell)) continue;
        const restored = fromCellData(cell);
        if (restored === undefined) record.cells.delete(name);
        else record.cells.set(name, restored);
      }
    }
  }
  return {
    config: snapshot.config,
    common: snapshot.common,
    tables: snapshot.tables as unknown as Table[],
    brokenTables: snapshot.brokenTables,
    diagnostics: snapshot.diagnostics,
    uids: new UidAllocator(snapshot.nextUid),
  };
}

