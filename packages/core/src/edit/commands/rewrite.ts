// 名前の変更に伴う、列定義（formula・ref）とセル単位式の書き換え（FR-COL-03、FR-TBL-02）
import type { FieldDef } from '../../model/field';
import { cloneFieldDef } from '../../model/field';
import type { Project } from '../../model/project';
import type { Table, TableView } from '../../model/table';
import { recordsOf } from '../helpers';
import { cloneView, toCellData } from '../patch';
import type { TxBuilder } from '../transaction';

export interface DefinitionRewrite {
  /** 式（列レベル式・セル単位式）の書き換え。owner はその式を持つテーブル（共通列の式なら null） */
  formula?: (formula: string, owner: Table | null) => string;
  /** 列定義の ref（`<テーブル>.<列>`）の書き換え */
  ref?: (ref: string) => string;
  /** 先に当てるパッチで変わった後の列名（列名の変更で使う） */
  nameAfter?: (owner: Table, name: string) => string;
  /** 共通列の定義（先に名前を変えたもの）。省略すれば今の定義 */
  baseFields?: FieldDef[];
  /** 共通列の定義を、書き換えが無くても setCommon で入れ直す（baseFields を渡したとき） */
  forceBaseFields?: boolean;
}

/** `<テーブル>.<列>` を分ける。形が違えば null */
export function splitRef(ref: string): { table: string; column: string } | null {
  const i = ref.indexOf('.');
  if (i <= 0 || i === ref.length - 1) return null;
  return { table: ref.slice(0, i), column: ref.slice(i + 1) };
}

function rewriteField(field: FieldDef, owner: Table | null, rw: DefinitionRewrite, name: string): FieldDef | null {
  // 名前だけの違い（先の renameField で済んでいる）は変更に数えない
  let changed = false;
  const next = cloneFieldDef(field);
  next.name = name;
  if (field.formula !== undefined && rw.formula !== undefined) {
    const f = rw.formula(field.formula, owner);
    if (f !== field.formula) {
      next.formula = f;
      changed = true;
    }
  }
  if (field.ref !== undefined && rw.ref !== undefined) {
    const r = rw.ref(field.ref);
    if (r !== field.ref) {
      next.ref = r;
      changed = true;
    }
  }
  return changed ? next : null;
}

/**
 * プロジェクト全体の列定義とセル単位式を書き換えるパッチを b に加える。
 * 共通列は setCommon、テーブルの列は updateField、セル単位式は setCells にする
 */
export function addDefinitionRewrites(project: Project, b: TxBuilder, rw: DefinitionRewrite): void {
  const base = rw.baseFields ?? project.common.base_fields.items;
  let baseChanged = rw.forceBaseFields === true;
  const nextBase = base.map((field) => {
    const r = rewriteField(field, null, rw, field.name);
    if (r !== null) baseChanged = true;
    return r ?? cloneFieldDef(field);
  });
  if (baseChanged) b.add({ op: 'setCommon', part: 'base_fields', items: nextBase, isDefault: false });

  const nameAfter = rw.nameAfter ?? ((_owner: Table, name: string) => name);
  for (const table of project.tables) {
    for (const field of table.fields) {
      const after = nameAfter(table, field.name);
      const r = rewriteField(field, table, rw, after);
      if (r === null) continue;
      b.add({ op: 'updateField', table: table.uid, name: after, field: r });
    }
    if (rw.formula === undefined) continue;
    for (const record of recordsOf(project, table).values()) {
      for (const [column, cell] of record.cells) {
        const data = toCellData(cell);
        if (data.override === undefined) continue;
        const f = rw.formula(data.override, table);
        if (f === data.override) continue;
        b.setCell(table.uid, record.uid, nameAfter(table, column), cell, { ...data, override: f });
      }
    }
  }
}

/** 表示設定の中の列名を変える。変わらなければ null */
export function renameInView(view: TableView, from: string, to: string): TableView | null {
  const hasWidth = view.column_widths.some(([name]) => name === from);
  const hasHidden = view.hidden_columns?.includes(from) === true;
  if (!hasWidth && !hasHidden) return null;
  const next = cloneView(view);
  next.column_widths = next.column_widths.map(([name, width]) => [name === from ? to : name, width]);
  if (next.hidden_columns !== undefined) next.hidden_columns = next.hidden_columns.map((name) => (name === from ? to : name));
  return next;
}
