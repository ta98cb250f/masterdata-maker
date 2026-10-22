// プロジェクト全体の編集セッション（FR-HIS-01〜04、FR-FIO-02〜05、P-43、P-44）
import { IoCode } from '../io/codes';
import { serializeCommonPart, serializeTable } from '../io/serialize';
import type { ColorDef, CommonPartName, EnumDef } from '../model/common';
import { COMMON_PART_NAMES } from '../model/common';
import { defaultBaseFields, defaultColors, defaultEnums } from '../model/defaults';
import type { FieldDef } from '../model/field';
import type { Project } from '../model/project';
import { compareNames, joinPath, resolveProjectPaths } from '../model/project';
import type { SourceFile, StorageFormat } from '../model/source';
import { extensionOf } from '../model/source';
import type { BrokenTable, Table } from '../model/table';
import { DEFAULT_HISTORY_LIMIT, UndoHistory } from '../sheet/history';
import type { Patch } from './patch';
import { applyPatch, applyPatches, commonVersion, patchTable, tableListVersion, tableVersion, toTableData } from './patch';
import type { CommandResult, EditFailure, FocusHint, Transaction } from './transaction';

export type EditEvent =
  /** patches は当てた順のパッチ（Worker に同じ順で送れば同じ状態になる） */
  | { kind: 'apply' | 'undo' | 'redo'; transaction: Transaction; patches: readonly Patch[] }
  /**
   * 外部で書き換えられたファイルを読み込み直した（FR-FIO-07。履歴には積まない）。patches は当てた順のパッチ、
   * tables は置き換えた・取り除いたテーブルの uid、historyCleared は履歴を消したか
   */
  | { kind: 'reload'; patches: readonly Patch[]; tables: readonly number[]; historyCleared: boolean }
  /** 保存の完了、または基準の変更（未保存の印が変わる） */
  | { kind: 'saved' };

export type EditListener = (event: EditEvent) => void;

export type SaveTarget =
  /** state は planSave の時点のテーブルの状態の番号（markSaved で基準にする） */
  | { kind: 'table'; table: number; name: string; state: number }
  | { kind: 'common'; part: CommonPartName };

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
  /** 読み込んだときのテキスト、または最後に保存したテキスト */
  text: string | null;
  /** そのときのテーブルの状態の番号 */
  state: number;
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

/** 読み込み直すテーブル（FR-FIO-07）。next が null なら、ファイルが消されたのでテーブルを取り除く */
export interface TableReload {
  /** 置き換えるテーブル（読み込みエラーのテーブルでもよい）の uid。next はこの uid で置き換える */
  uid: number;
  /** 読み直したファイルを parseTableFile で読んだもの（レコードの uid はプロジェクトの採番から取ること） */
  next: Table | BrokenTable | null;
}

/** 読み込み直す共通設定。next が null なら、ファイルが消されたので既定値に戻す */
export type CommonReload =
  | { part: 'enums'; next: { items: EnumDef[]; source: SourceFile } | null }
  | { part: 'base_fields'; next: { items: FieldDef[]; source: SourceFile } | null }
  | { part: 'colors'; next: { items: ColorDef[]; source: SourceFile } | null };

export interface ReloadRequest {
  tables?: readonly TableReload[];
  common?: readonly CommonReload[];
}

/** エディタの内容で上書きするファイル。text はファイルの今のテキスト（消されていれば null） */
export interface KeepRequest {
  tables?: readonly { uid: number; text: string | null }[];
  common?: readonly { part: CommonPartName; text: string | null }[];
}

function defaultCommonItems(part: CommonPartName): EnumDef[] | FieldDef[] | ColorDef[] {
  if (part === 'enums') return defaultEnums();
  if (part === 'base_fields') return defaultBaseFields();
  return defaultColors();
}

function compareTableEntries(a: Table | BrokenTable, b: Table | BrokenTable): number {
  return compareNames(a.name, b.name) || compareNames(a.source?.path ?? '', b.source?.path ?? '');
}

export class EditSession {
  readonly project: Project;
  private readonly history: UndoHistory<Transaction>;
  private readonly listeners = new Set<EditListener>();
  private readonly tableBaselines = new Map<number, TableBaseline>();
  private readonly commonBaselines = new Map<CommonPartName, CommonBaseline>();
  private readonly tableTexts = new Map<number, { version: number; text: string | null }>();
  private readonly commonTexts = new Map<CommonPartName, { version: number; text: string | null }>();
  /**
   * テーブルの状態の番号。トランザクションを当てると新しい番号になり、元に戻すと前の番号に戻る。
   * 基準と同じ番号なら中身も基準と同じなので、正規形のテキストを作らずに「未保存でない」と分かる
   */
  private readonly states = new Map<number, number>();
  private readonly txStates = new WeakMap<Transaction, { id: number; prev: Map<number, number> }>();
  private nextState = 1;
  private revisionValue = 0;

  constructor(project: Project, options: EditSessionOptions = {}) {
    this.project = project;
    this.history = new UndoHistory<Transaction>(options.historyLimit ?? DEFAULT_HISTORY_LIMIT);
    // 基準は読み込んだテキスト。開いた直後は状態の番号が基準と同じなので、正規形でないファイルでも未保存にしない
    for (const table of project.tables) {
      this.tableBaselines.set(table.uid, {
        name: table.name,
        path: table.source?.path ?? null,
        format: this.formatOf(table),
        text: table.source?.text ?? null,
        state: 0,
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
    this.enterNewState(entry);
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
    this.enterNewState(entry);
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
    for (const [table, state] of this.txStates.get(entry)?.prev ?? []) this.states.set(table, state);
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
    const meta = this.txStates.get(entry);
    if (meta !== undefined) for (const table of meta.prev.keys()) this.states.set(table, meta.id);
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

  // ---- 外部での変更（FR-FIO-07） ----

  /**
   * 外部で書き換えられたファイルを読み込み直す。テーブルは uid のまま中身を置き換え、読み直したテキストを基準にする
   * （そのテーブルの未保存の変更は消える）。共通設定は読み直した値にする。
   * 読み込み直したテーブル・共通設定を指す履歴は当てられなくなるので、そういう項目が 1 つでもあれば履歴をすべて消す
   * （共通列は全テーブルの列なので、共通列を読み込み直したら履歴は必ず消す）。履歴には積まない
   */
  reloadFiles(request: ReloadRequest): { historyCleared: boolean } {
    const patches: Patch[] = [];
    const touched = new Set<number>();
    const parts = new Set<CommonPartName>();
    const apply = (patch: Patch) => {
      applyPatch(this.project, patch);
      patches.push(patch);
    };
    // 共通設定を先に（共通列はテーブルの列になるので、テーブルを読み直すより前に変える）
    for (const item of request.common ?? []) {
      const items = item.next?.items ?? defaultCommonItems(item.part);
      // 共通列のフィールド番号は作り直さない（手での編集と同じく、保存・出力のときに列に合わせる。P-63）
      const protos = item.part === 'base_fields' ? { protos: [] } : {};
      apply({ op: 'setCommon', part: item.part, items, isDefault: item.next === null, ...protos } as Patch);
      this.project.common[item.part].source = item.next?.source ?? null;
      // 基準は開いたときと同じく、読んだ内容を正規形にしたテキスト（正規形でないファイルでも未保存にしない）
      this.commonBaselines.set(item.part, { path: item.next?.source.path ?? null, text: this.commonText(item.part) });
      parts.add(item.part);
    }
    for (const { uid, next } of request.tables ?? []) {
      const current = this.project.tables.find((t) => t.uid === uid);
      const brokenIndex = this.project.brokenTables.findIndex((t) => t.uid === uid);
      if (current !== undefined) apply({ op: 'removeTable', table: uid });
      else if (brokenIndex >= 0) this.project.brokenTables.splice(brokenIndex, 1);
      else continue;
      touched.add(uid);
      this.tableTexts.delete(uid);
      this.tableBaselines.delete(uid);
      this.states.delete(uid);
      if (next === null) continue;
      let replacement: Table | BrokenTable = next;
      if (next.kind === 'table') {
        const other = [...this.project.tables, ...this.project.brokenTables].find((t) => t.uid !== uid && t.name === next.name);
        // 同じ名前のテーブルが他にあれば、開いたときと同じく読み込みエラーにする
        if (other !== undefined && next.source !== null) {
          replacement = {
            kind: 'broken',
            uid,
            name: next.name,
            source: next.source,
            diagnostics: [
              ...next.diagnostics,
              {
                severity: 'error',
                code: IoCode.duplicateTableName,
                file: next.source.path,
                table: next.name,
                params: { name: next.name, others: other.source?.path ?? '' },
              },
            ],
          };
        }
      }
      if (replacement.kind === 'broken') {
        this.project.brokenTables.push({ ...replacement, uid });
        this.project.brokenTables.sort(compareTableEntries);
        continue;
      }
      const data = toTableData(replacement);
      data.uid = uid;
      apply({ op: 'addTable', table: data });
      const state = this.nextState++;
      this.states.set(uid, state);
      this.tableBaselines.set(uid, {
        name: replacement.name,
        path: replacement.source?.path ?? null,
        format: this.formatOf(replacement),
        text: replacement.source?.text ?? null,
        state,
      });
    }
    const refers = (tx: Transaction) =>
      parts.has('base_fields') ||
      [...tx.patches, ...tx.inverse].some((p) => {
        const table = patchTable(p);
        // 共通列の変更は全テーブルのフィールド番号を持つので、テーブルを 1 つでも読み直したら当てられない（P-63）
        return (
          (table !== null && touched.has(table)) ||
          (p.op === 'setCommon' && (parts.has(p.part) || (p.part === 'base_fields' && touched.size > 0)))
        );
      });
    const historyCleared = this.history.some(refers);
    if (historyCleared) this.history.clear();
    this.emit({ kind: 'reload', patches, tables: [...touched], historyCleared });
    return { historyCleared };
  }

  /**
   * 外部で書き換えられたファイルを、エディタの内容で上書きすることにする。基準をそのファイルの今のテキストにするので、
   * エディタの内容と違えば未保存になり、次の保存で書き込む（消されたファイルは作り直す）
   */
  keepEditorContent(request: KeepRequest): void {
    for (const { uid, text } of request.tables ?? []) {
      const table = this.project.tables.find((t) => t.uid === uid);
      const baseline = this.tableBaselines.get(uid);
      if (table === undefined || baseline === undefined) continue;
      // 今の内容がファイルと同じなら未保存にしない
      const same = text !== null && baseline.name === table.name && this.tableText(table) === text;
      this.tableBaselines.set(uid, { ...baseline, text, state: same ? this.stateOf(uid) : -1 });
      if (table.source !== null && text !== null) table.source = { ...table.source, text };
    }
    for (const { part, text } of request.common ?? []) {
      const common = this.project.common[part];
      const baseline = this.commonBaselines.get(part);
      this.commonBaselines.set(part, { path: baseline?.path ?? common.source?.path ?? null, text });
      if (common.source !== null && text !== null) common.source = { ...common.source, text };
    }
    this.emit({ kind: 'saved' });
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

  /** トランザクションが変えたテーブルに新しい状態の番号を振る（元に戻すときのために前の番号を覚える） */
  private enterNewState(entry: Transaction): void {
    const touched = new Set<number>();
    for (const patch of entry.patches) {
      const table = patchTable(patch);
      if (table !== null) touched.add(table);
      // 共通列はすべてのテーブルの列（書き出す内容も変わる）
      else if (patch.op === 'setCommon' && patch.part === 'base_fields') for (const t of this.project.tables) touched.add(t.uid);
    }
    const id = this.nextState++;
    const prev = new Map<number, number>();
    for (const table of touched) {
      prev.set(table, this.stateOf(table));
      this.states.set(table, id);
    }
    this.txStates.set(entry, { id, prev });
  }

  private stateOf(table: number): number {
    return this.states.get(table) ?? 0;
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
   * 元に戻して読み込んだ（保存した）ときの状態に戻れば未保存でなくなる。新しく作ったテーブルは未保存。
   * 状態の番号が基準と同じならテキストを作らずに答える。違えば正規形のテキストを作って比べる（版数でメモ化する。
   * 1 万行 × 50 列では数百ミリ秒かかるので、画面は isTableModified で印を出し、正確な判定は保存や終了の確認で使える）
   */
  isTableDirty(table: number): boolean {
    const t = this.project.tables.find((x) => x.uid === table);
    if (t === undefined) return false;
    const baseline = this.tableBaselines.get(table);
    if (baseline === undefined) return true;
    if (baseline.state === this.stateOf(table)) return false;
    return baseline.name !== t.name || baseline.text !== this.tableText(t);
  }

  /**
   * 読み込み（保存）の後に変更があり、元に戻して基準の状態に戻っていないか（テキストを作らないので速い）。
   * 手で元の値に入力し直した場合は true のまま（正確には isTableDirty）
   */
  isTableModified(table: number): boolean {
    if (!this.project.tables.some((x) => x.uid === table)) return false;
    const baseline = this.tableBaselines.get(table);
    return baseline === undefined || baseline.state !== this.stateOf(table);
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
      files.push({ path, text, format, target: { kind: 'table', table: table.uid, name: table.name, state: this.stateOf(table.uid) } });
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
    return { files, remove: toRemove };
  }

  /**
   * 保存の完了を知らせる。書き込んだテキストを新しい基準にし（未保存の印が消える）、モデルの読み込み元の情報も更新する。
   * 履歴は消さない（FR-HIS-02）。書き込めたファイルと消せたファイルだけを渡す
   */
  markSaved(files: readonly SaveFile[], removed: readonly string[] = []): void {
    const removedSet = new Set(removed);
    // 削除したテーブルの基準は、そのファイルを消した（または別のテーブルで上書きした）ら要らない
    const written = new Set(files.map((f) => f.path));
    for (const [uid, baseline] of [...this.tableBaselines]) {
      if (baseline.path === null || this.project.tables.some((t) => t.uid === uid)) continue;
      if (removedSet.has(baseline.path) || written.has(baseline.path)) this.tableBaselines.delete(uid);
    }
    for (const file of files) {
      const source = { path: file.path, format: file.format, text: file.text };
      if (file.target.kind === 'table') {
        const uid = file.target.table;
        this.tableBaselines.set(uid, { name: file.target.name, path: file.path, format: file.format, text: file.text, state: file.target.state });
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

  /**
   * 変更したが、正規形のテキストが読み込んだ（保存した）ファイルと同じに戻ったテーブル（手で元の値に入れ直したなど）を保存済みにする。
   * 書き込まなくてもファイルと同じなので、未保存の印（isTableModified）を消すために保存の後に呼ぶ。保存済みにしたテーブルの uid を返す
   */
  markUnchangedSaved(): number[] {
    const settled: number[] = [];
    for (const table of this.project.tables) {
      const baseline = this.tableBaselines.get(table.uid);
      if (baseline === undefined || baseline.text === null || baseline.state === this.stateOf(table.uid)) continue;
      if (baseline.name !== table.name || this.tableText(table) !== baseline.text) continue;
      this.tableBaselines.set(table.uid, { ...baseline, state: this.stateOf(table.uid) });
      settled.push(table.uid);
    }
    if (settled.length > 0) this.emit({ kind: 'saved' });
    return settled;
  }
}
