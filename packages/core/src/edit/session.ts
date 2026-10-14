// プロジェクト全体の編集セッション（FR-HIS-01〜04、FR-FIO-02〜05、P-43、P-44）
import { serializeCommonPart, serializeTable } from '../io/serialize';
import type { CommonPartName } from '../model/common';
import { COMMON_PART_NAMES } from '../model/common';
import type { Project } from '../model/project';
import { joinPath, resolveProjectPaths } from '../model/project';
import type { StorageFormat } from '../model/source';
import { extensionOf } from '../model/source';
import type { Table } from '../model/table';
import { DEFAULT_HISTORY_LIMIT, UndoHistory } from '../sheet/history';
import type { Patch } from './patch';
import { applyPatches, commonVersion, tableListVersion, tableVersion } from './patch';
import type { CommandResult, EditFailure, FocusHint, Transaction } from './transaction';

export type EditEvent =
  /** patches は当てた順のパッチ（Worker に同じ順で送れば同じ状態になる） */
  | { kind: 'apply' | 'undo' | 'redo'; transaction: Transaction; patches: readonly Patch[] }
  /** 保存の完了（未保存の印が変わる） */
  | { kind: 'saved' };

export type EditListener = (event: EditEvent) => void;

export type SaveTarget = { kind: 'table'; table: number; name: string } | { kind: 'common'; part: CommonPartName };

export interface SaveFile {
  /** プロジェクトのルートからの相対パス */
  path: string;
  text: string;
  format: StorageFormat;
  target: SaveTarget;
}

export interface SavePlan {
  /** 書き込むファイル（変更のあるものだけ。FR-FIO-02） */
  files: SaveFile[];
  /** 消すファイル（削除したテーブル、名前を変えたテーブルの元のファイル。P-43） */
  remove: string[];
}

export interface EditSessionOptions {
  /** 履歴の件数の上限（既定は 200。P-44） */
  historyLimit?: number;
}

interface TableBaseline {
  name: string;
  /** 読み込んだ（保存した）ファイル。新しいテーブルなら無い */
  path: string | null;
  format: StorageFormat;
  /** 読み込んだときの内容を正規形にしたテキスト、または最後に保存したテキスト */
  text: string | null;
}

interface CommonBaseline {
  path: string | null;
  /** 既定値のまま（ファイルを作らない）なら null */
  text: string | null;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export type ApplyResult = { ok: true; tx: Transaction } | { ok: false; failures: EditFailure[] };

export class EditSession {
  readonly project: Project;
  private readonly history: UndoHistory<Transaction>;
  private readonly listeners = new Set<EditListener>();
  private readonly tableBaselines = new Map<number, TableBaseline>();
  private readonly commonBaselines = new Map<CommonPartName, CommonBaseline>();
  private readonly tableTexts = new Map<number, { version: number; text: string | null }>();
  private readonly commonTexts = new Map<CommonPartName, { version: number; text: string | null }>();
  private revisionValue = 0;

  constructor(project: Project, options: EditSessionOptions = {}) {
    this.project = project;
    this.history = new UndoHistory<Transaction>(options.historyLimit ?? DEFAULT_HISTORY_LIMIT);
    // 基準は「読み込んだ内容を正規形にしたテキスト」。手で書いたファイルが正規形でなくても、開いた直後は未保存にしない
    for (const table of project.tables) {
      this.tableBaselines.set(table.uid, {
        name: table.name,
        path: table.source?.path ?? null,
        format: this.formatOf(table),
        text: this.tableText(table),
      });
    }
    for (const part of COMMON_PART_NAMES) {
      this.commonBaselines.set(part, { path: project.common[part].source?.path ?? null, text: this.commonText(part) });
    }
  }

  // ---- 適用・元に戻す・やり直す ----

  /** トランザクションを当てて履歴に積み、当てたもの（逆のパッチ入り）を返す。空のトランザクションは積まない */
  apply(tx: Transaction): Transaction {
    if (tx.patches.length === 0) return tx;
    const inverse = applyPatches(this.project, tx.patches);
    const entry: Transaction = { ...tx, inverse };
    this.history.push(entry);
    this.emit({ kind: 'apply', transaction: entry, patches: entry.patches });
    return entry;
  }

  /** コマンドの結果を当てる。失敗ならそのまま返す */
  run(result: CommandResult): ApplyResult {
    return result.ok ? { ok: true, tx: this.apply(result.tx) } : result;
  }

  /**
   * 複数のコマンドを順に当て、1 つの操作として履歴に積む（例: 列の設定のダイアログで、列名と型と設定をまとめて変える）。
   * 各コマンドは前のコマンドを当てた後のモデルで作る。1 つでも失敗したら、当てたものを戻して失敗を返す
   */
  applyGroup(label: string, steps: readonly ((project: Project) => CommandResult)[]): ApplyResult {
    const patches: Patch[] = [];
    const inverses: Patch[][] = [];
    const tables: number[] = [];
    let focus: FocusHint | undefined;
    for (const step of steps) {
      const r = step(this.project);
      if (!r.ok) {
        for (let i = inverses.length - 1; i >= 0; i--) applyPatches(this.project, inverses[i]);
        return r;
      }
      if (r.tx.patches.length === 0) continue;
      inverses.push(applyPatches(this.project, r.tx.patches));
      patches.push(...r.tx.patches);
      for (const t of r.tx.tables) if (!tables.includes(t)) tables.push(t);
      if (r.tx.focus !== undefined) focus = r.tx.focus;
    }
    const entry: Transaction = { label, patches, inverse: inverses.reverse().flat(), tables };
    if (focus !== undefined) {
      entry.focus = focus;
      entry.tables = [focus.table, ...tables.filter((t) => t !== focus.table)];
    }
    if (patches.length === 0) return { ok: true, tx: entry };
    this.history.push(entry);
    this.emit({ kind: 'apply', transaction: entry, patches });
    return { ok: true, tx: entry };
  }

  /** 元に戻す。戻したトランザクション（画面はその tables[0] を表示する。FR-HIS-02）を返す。無ければ undefined */
  undo(): Transaction | undefined {
    const entry = this.history.peekUndo();
    if (entry === undefined) return undefined;
    try {
      applyPatches(this.project, entry.inverse);
    } catch (e) {
      // モデルと履歴が食い違っている（パッチ以外でモデルを書き換えたなど）。履歴を続けられないので消す
      this.history.clear();
      throw e;
    }
    this.history.undo();
    this.emit({ kind: 'undo', transaction: entry, patches: entry.inverse });
    return entry;
  }

  /** やり直す。やり直したトランザクションを返す。無ければ undefined */
  redo(): Transaction | undefined {
    const entry = this.history.peekRedo();
    if (entry === undefined) return undefined;
    let inverse: Patch[];
    try {
      inverse = applyPatches(this.project, entry.patches);
    } catch (e) {
      this.history.clear();
      throw e;
    }
    entry.inverse = inverse;
    this.history.redo();
    this.emit({ kind: 'redo', transaction: entry, patches: entry.patches });
    return entry;
  }

  canUndo(): boolean {
    return this.history.canUndo();
  }

  canRedo(): boolean {
    return this.history.canRedo();
  }

  /** 次に元に戻す操作の名前の文言コード（メニューの「元に戻す: 貼り付け」用） */
  undoLabel(): string | undefined {
    return this.history.peekUndo()?.label;
  }

  redoLabel(): string | undefined {
    return this.history.peekRedo()?.label;
  }

  get undoCount(): number {
    return this.history.undoCount;
  }

  get redoCount(): number {
    return this.history.redoCount;
  }

  // ---- 変更の購読 ----

  /** 変更を購読する（Worker への転送・画面の再描画）。戻り値で購読をやめる */
  subscribe(listener: EditListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 変更（適用・元に戻す・やり直す・保存）のたびに増える数（useSyncExternalStore のスナップショットに使える） */
  get revision(): number {
    return this.revisionValue;
  }

  private emit(event: EditEvent): void {
    this.revisionValue++;
    for (const listener of [...this.listeners]) listener(event);
  }

  // ---- 版数 ----

  tableVersion(table: number): number {
    return tableVersion(this.project, table);
  }

  commonVersion(): number {
    return commonVersion(this.project);
  }

  tableListVersion(): number {
    return tableListVersion(this.project);
  }

  // ---- 未保存の判定（FR-FIO-03〜05） ----

  private formatOf(table: Table): StorageFormat {
    return table.source?.format ?? this.project.config.storage.format;
  }

  private commonFormat(part: CommonPartName): StorageFormat {
    return this.project.common[part].source?.format ?? this.project.config.storage.format;
  }

  /** 今の内容を正規形にしたテキスト（版数でメモ化する）。書き出せない値（NaN など）があれば null */
  private tableText(table: Table): string | null {
    const version = tableVersion(this.project, table.uid);
    const cached = this.tableTexts.get(table.uid);
    if (cached !== undefined && cached.version === version) return cached.text;
    let text: string | null;
    try {
      text = serializeTable(table, this.project.common.base_fields.items, this.formatOf(table));
    } catch {
      text = null;
    }
    this.tableTexts.set(table.uid, { version, text });
    return text;
  }

  private commonText(part: CommonPartName): string | null {
    const version = commonVersion(this.project);
    const cached = this.commonTexts.get(part);
    if (cached !== undefined && cached.version === version) return cached.text;
    let text: string | null = null;
    if (!this.project.common[part].isDefault) {
      try {
        text = serializeCommonPart(this.project.common, part, this.commonFormat(part));
      } catch {
        text = null;
      }
    }
    this.commonTexts.set(part, { version, text });
    return text;
  }

  /**
   * テーブルに未保存の変更があるか: 今の内容を正規形にしたテキストが、読み込んだ（最後に保存した）テキストと違うか。
   * 元に戻して保存時の内容に戻れば未保存でなくなる。新しく作ったテーブルは未保存
   */
  isTableDirty(table: number): boolean {
    const t = this.project.tables.find((x) => x.uid === table);
    if (t === undefined) return false;
    const baseline = this.tableBaselines.get(table);
    if (baseline === undefined) return true;
    return baseline.name !== t.name || baseline.text !== this.tableText(t);
  }

  /** 未保存の変更があるテーブルの uid（project.tables の順） */
  dirtyTables(): number[] {
    return this.project.tables.filter((t) => this.isTableDirty(t.uid)).map((t) => t.uid);
  }

  /** 削除したテーブルのうち、ファイルがまだ残っているもののパス */
  removedTableFiles(): string[] {
    const present = new Set(this.project.tables.map((t) => t.uid));
    const paths: string[] = [];
    for (const [uid, baseline] of this.tableBaselines) {
      if (!present.has(uid) && baseline.path !== null) paths.push(baseline.path);
    }
    return paths.sort();
  }

  isCommonDirty(part: CommonPartName): boolean {
    return (this.commonBaselines.get(part)?.text ?? null) !== this.commonText(part);
  }

  /** 保存していない変更が 1 つでもあるか（ページを閉じる前の確認。FR-FIO-05） */
  hasUnsavedChanges(): boolean {
    return (
      this.dirtyTables().length > 0 || COMMON_PART_NAMES.some((part) => this.isCommonDirty(part)) || this.removedTableFiles().length > 0
    );
  }

  /**
   * 保存で書き込むファイルと消すファイル（FR-FIO-02、P-43）。モデルは変えない。
   * 名前を変えたテーブルは `<元のフォルダ>/<新しい名前>.<拡張子>` に書き、元のファイルを消す。
   * 書き出せない値（NaN・Infinity。DR-35）があれば SerializeError を投げる
   */
  planSave(): SavePlan {
    const storage = this.project.config.storage.format;
    const paths = resolveProjectPaths(this.project.config);
    const files: SaveFile[] = [];
    const remove: string[] = [];
    const baseFields = this.project.common.base_fields.items;
    for (const table of this.project.tables) {
      if (!this.isTableDirty(table.uid)) continue;
      const baseline = this.tableBaselines.get(table.uid);
      const format = baseline?.format ?? this.formatOf(table);
      const fileName = `${table.name}.${extensionOf(format)}`;
      let path: string;
      if (baseline !== undefined && baseline.path !== null) {
        if (baseline.name === table.name) {
          path = baseline.path;
        } else {
          path = joinPath(dirOf(baseline.path), fileName);
          if (path !== baseline.path) remove.push(baseline.path);
        }
      } else {
        path = joinPath(paths.tablesDir, fileName);
      }
      const text = serializeTable(table, baseFields, format);
      files.push({ path, text, format, target: { kind: 'table', table: table.uid, name: table.name } });
    }
    remove.push(...this.removedTableFiles());
    for (const part of COMMON_PART_NAMES) {
      if (!this.isCommonDirty(part)) continue;
      const common = this.project.common[part];
      const baseline = this.commonBaselines.get(part);
      const format = this.commonFormat(part);
      const path = common.source?.path ?? baseline?.path ?? joinPath(paths.configDir, `${part}.${extensionOf(format)}`);
      if (common.isDefault) {
        if (baseline?.path != null) remove.push(baseline.path);
        continue;
      }
      files.push({ path, text: serializeCommonPart(this.project.common, part, format), format, target: { kind: 'common', part } });
    }
    const written = new Set(files.map((f) => f.path));
    const toRemove = [...new Set(remove)].filter((p) => !written.has(p)).sort();
    void storage;
    return { files, remove: toRemove };
  }

  /**
   * 保存の完了を知らせる。書き込んだテキストを新しい基準にし（未保存の印が消える）、モデルの読み込み元の情報も更新する。
   * 履歴は消さない（FR-HIS-02）。書き込めたファイルと消せたファイルだけを渡す
   */
  markSaved(files: readonly SaveFile[], removed: readonly string[] = []): void {
    const removedSet = new Set(removed);
    for (const [uid, baseline] of [...this.tableBaselines]) {
      if (baseline.path !== null && removedSet.has(baseline.path) && !this.project.tables.some((t) => t.uid === uid)) {
        this.tableBaselines.delete(uid);
      }
    }
    for (const file of files) {
      const source = { path: file.path, format: file.format, text: file.text };
      if (file.target.kind === 'table') {
        const uid = file.target.table;
        this.tableBaselines.set(uid, { name: file.target.name, path: file.path, format: file.format, text: file.text });
        const table = this.project.tables.find((t) => t.uid === uid);
        if (table !== undefined) table.source = source;
      } else {
        this.commonBaselines.set(file.target.part, { path: file.path, text: file.text });
        this.project.common[file.target.part].source = source;
      }
    }
    for (const part of COMMON_PART_NAMES) {
      const baseline = this.commonBaselines.get(part);
      if (baseline?.path != null && removedSet.has(baseline.path) && this.project.common[part].isDefault) {
        this.commonBaselines.set(part, { path: null, text: null });
      }
    }
    this.emit({ kind: 'saved' });
  }
}
