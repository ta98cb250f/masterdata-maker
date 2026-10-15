// パッチに合わせて Calculator のキャッシュを捨てる（画面のメインスレッドと検査用の Worker で共用する）
import type { Patch } from '../edit/patch';
import type { Calculator } from './calculator';

/** setCells のセルがこれより多ければ、セルごとではなくテーブル全体を捨てる（その方が速い） */
const MANY_CELLS = 2000;

/**
 * 当てた後のパッチ 1 つに合わせてキャッシュを捨てる。
 * - setCells: セルごとに invalidateCell（多ければ invalidateTable）
 * - 行・列の構造の変化: invalidateTable
 * - テーブルの追加・削除・名前の変更、共通設定（列挙型・共通列）の変更: invalidateAll
 * - 表示設定・表示名・セル色のプリセット: 計算に影響しないので何もしない
 */
export function invalidateForPatch(calc: Calculator, patch: Patch): void {
  switch (patch.op) {
    case 'setView':
    case 'setTableDisplayName':
      return;
    case 'setCommon':
      if (patch.part !== 'colors') calc.invalidateAll();
      return;
    case 'setTableName':
    case 'addTable':
    case 'removeTable':
      calc.invalidateAll();
      return;
    default:
      break;
  }
  const table = calc.project.tables.find((t) => t.uid === patch.table);
  if (table === undefined) {
    calc.invalidateAll();
    return;
  }
  if (patch.op === 'setCells' && patch.cells.length <= MANY_CELLS) {
    for (const change of patch.cells) calc.invalidateCell(table, change.record, change.column);
    return;
  }
  calc.invalidateTable(table);
}

/** パッチの列（当てた順）に合わせてキャッシュを捨てる */
export function invalidateForPatches(calc: Calculator, patches: readonly Patch[]): void {
  for (const patch of patches) invalidateForPatch(calc, patch);
}
