// トランザクション（1 回の操作。FR-HIS-03）とコマンドの結果
import type { Cell } from '../model/cell';
import type { CellChange, CellData, Patch } from './patch';
import { cellDataEquals, isCellDataEmpty, toCellData } from './patch';
import type { InputError, InputParams } from './input';

/** 元に戻した（やり直した）後に選択すべき範囲の手がかり。画面は、表示中のものだけを選ぶ */
export interface FocusHint {
  table: number;
  /** レコードの uid（表示順は画面が決める）。空なら行を指定しない */
  records: number[];
  /** 列名。空なら列を指定しない */
  columns: string[];
}

export interface Transaction {
  /** 操作の名前の文言コード（edit.op.*。「元に戻す: 貼り付け」などに使う） */
  label: string;
  patches: Patch[];
  /** 逆のパッチ（当てる順）。EditSession.apply で埋まる */
  inverse: Patch[];
  /** 影響したテーブルの uid。先頭が主に操作したテーブル（元に戻すときに表示する。FR-HIS-02） */
  tables: number[];
  focus?: FocusHint;
}

/** コマンドの失敗の 1 件。対象のセルや行があれば、その位置も持つ */
export interface EditFailure {
  /** 文言コード（edit.input.* / edit.error.*） */
  code: string;
  params: InputParams;
  /** 入力欄に出す文言コード（入力値の変換の失敗のとき） */
  hint?: string;
  /** リストの要素で失敗したとき、その位置（1 から数える） */
  index?: number;
  table?: number;
  /** レコードの uid。貼り付けで追加する行では undefined */
  record?: number;
  column?: string;
  /** 対象の範囲（呼び出し側が渡した 2 次元の配列）の中の行・列の位置（0 から数える） */
  row?: number;
  col?: number;
  /** 変換しようとしたテキスト */
  input?: string;
}

export type CommandResult = { ok: true; tx: Transaction } | { ok: false; failures: EditFailure[] };

export function failed(failures: EditFailure[]): CommandResult {
  return { ok: false, failures };
}

export function failure(code: string, params: InputParams = {}, extra: Partial<EditFailure> = {}): CommandResult {
  return { ok: false, failures: [{ code, params, ...extra }] };
}

export function inputFailure(error: InputError, extra: Partial<EditFailure> = {}): EditFailure {
  const f: EditFailure = { code: error.code, params: { ...error.params }, hint: error.hint, ...extra };
  if (error.index !== undefined) f.index = error.index;
  return f;
}

/**
 * コマンドがパッチを組み立てる道具。同じテーブルのセルの変更が続くときは 1 つの setCells にまとめる。
 * パッチは組み立て時点のモデルに対して順に当てられる前提で作る
 */
export class TxBuilder {
  readonly patches: Patch[] = [];
  private readonly tableSet: number[] = [];
  private pending: { table: number; cells: CellChange[] } | null = null;

  /** 影響したテーブルとして記録する（先に記録したものが先頭） */
  touch(table: number): void {
    if (!this.tableSet.includes(table)) this.tableSet.push(table);
  }

  private flush(): void {
    if (this.pending !== null && this.pending.cells.length > 0) {
      this.patches.push({ op: 'setCells', table: this.pending.table, cells: this.pending.cells });
    }
    this.pending = null;
  }

  add(patch: Patch): void {
    this.flush();
    this.patches.push(patch);
    if (patch.op === 'addTable') this.touch(patch.table.uid);
    else if (patch.op !== 'setCommon') this.touch(patch.table);
  }

  /** セルを next にする。今のセル（old）と同じ中身なら何もしない。変えたら true */
  setCell(table: number, record: number, column: string, old: Cell | undefined, next: CellData | null): boolean {
    if (cellDataEquals(old === undefined ? null : toCellData(old), next)) return false;
    if (this.pending === null || this.pending.table !== table) {
      this.flush();
      this.pending = { table, cells: [] };
    }
    this.pending.cells.push({ record, column, cell: isCellDataEmpty(next) ? null : next });
    this.touch(table);
    return true;
  }

  get isEmpty(): boolean {
    return this.patches.length === 0 && (this.pending === null || this.pending.cells.length === 0);
  }

  build(label: string, focus?: FocusHint): Transaction {
    this.flush();
    const tx: Transaction = { label, patches: this.patches, inverse: [], tables: [...this.tableSet] };
    if (focus !== undefined) {
      tx.focus = focus;
      tx.tables = [focus.table, ...tx.tables.filter((t) => t !== focus.table)];
    }
    return tx;
  }

  result(label: string, focus?: FocusHint): CommandResult {
    return { ok: true, tx: this.build(label, focus) };
  }
}

/** 何も変えない操作（空のトランザクション）。EditSession.apply は履歴に積まない */
export function emptyResult(label: string, focus?: FocusHint): CommandResult {
  return new TxBuilder().result(label, focus);
}
