// アプリの状態（React の外に置き、useSyncExternalStore で購読する）
import type {
  AdvanceKey,
  ApplyResult,
  BrokenTable,
  ClipboardData,
  CommandResult,
  Diagnostic,
  Direction,
  EditEvent,
  EditFailure,
  Locale,
  MessageParams,
  Platform,
  Project,
  Selection,
  Table,
} from '@sheetcraft/core';
import {
  COMMON_PART_NAMES,
  Calculator,
  EditSession,
  SerializeError,
  advanceInSelection,
  affectedTables,
  cellEditText,
  clampPos,
  compareNames,
  enterInput,
  extendTo,
  formatDiagnostic,
  formatInputError,
  formatInputHint,
  formatMessage,
  invalidateForPatches,
  isFieldEditable,
  loadProject,
  moveCell,
  selectCell,
  selectColRange,
  selectRowRange,
} from '@sheetcraft/core';
import type { CommandDef } from '../commands/registry';
import { CommandRegistry } from '../commands/registry';
import type { ProjectSource } from '../fs/types';
import { errorMessage } from '../fs/text';
import type { SheetModel } from '../sheet/model';
import { buildSheetModel } from '../sheet/model';
import { computeOrder } from '../sheet/sortFilter';
import type {
  AppState,
  ClipboardMark,
  DialogEntry,
  EditingState,
  MenuEntry,
  PanelPosition,
  StatusMessage,
  TableIssues,
  TableViewState,
  ValidationState,
} from './types';
import type { Validator, ValidatorFactory } from './validation';
import { allTableNames, changedTablesOf, mainThreadValidator, summarizeIssues } from './validation';

export interface AppStoreOptions {
  commands?: Iterable<CommandDef>;
  /** 検査の実行役（既定はメインスレッドで検査する） */
  validator?: ValidatorFactory;
  /** 編集から検査までの待ち時間（ミリ秒）。続けて編集したときにまとめる。FR-VAL-09 の 300 ミリ秒以内に収める */
  validationDelay?: number;
  locale?: Locale;
  platform?: Platform;
  /** 位置の分かるパネル（右・下）の識別子（togglePanel で位置を引く） */
  panelPositions?: ReadonlyMap<string, PanelPosition>;
}

/** 本ツールの中でコピーした内容（FR-CLP-06）。クリップボードの text/plain と一致すれば、値・式・色・メモを持ち込む */
export interface InternalClipboard {
  data: ClipboardData;
  tsv: string;
}

export interface SheetTab {
  uid: number;
  name: string;
  label: string;
  broken: boolean;
}

const EMPTY_VALIDATION: ValidationState = { version: 0, tables: new Map(), common: [], running: false };

function detectPlatform(): Platform {
  const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator;
  const p = nav?.platform ?? nav?.userAgent ?? '';
  return /Mac|iPhone|iPad|iPod/i.test(p) ? 'mac' : 'other';
}

function sameSelection(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind || a.anchor.row !== b.anchor.row || a.anchor.col !== b.anchor.col) return false;
  if (a.active.row !== b.active.row || a.active.col !== b.active.col || a.ranges.length !== b.ranges.length) return false;
  return a.ranges.every((r, i) => {
    const s = b.ranges[i];
    return r.top === s.top && r.left === s.left && r.bottom === s.bottom && r.right === s.right;
  });
}

/** 行・列の数が変わったときに選択を表の中に収める（行全体・列全体の選択は形を作り直す） */
export function fitSelection(sel: Selection, size: { rows: number; cols: number }): Selection {
  const inside = (r: { top: number; left: number; bottom: number; right: number }) =>
    r.bottom < size.rows && r.right < size.cols && r.top >= 0 && r.left >= 0;
  if (sel.kind === 'cells' && sel.ranges.every(inside) && sel.anchor.row < size.rows && sel.anchor.col < size.cols) return sel;
  const anchor = clampPos(sel.anchor, size);
  const active = clampPos(sel.active, size);
  return extendTo({ ...sel, anchor }, active, size);
}

export class AppStore {
  private state: AppState;
  private readonly listeners = new Set<() => void>();
  readonly commands: CommandRegistry;
  readonly platform: Platform;
  private readonly validatorFactory: ValidatorFactory;
  private readonly validationDelay: number;
  private readonly panelPositions: ReadonlyMap<string, PanelPosition>;
  private validator: Validator | null = null;
  private unsubscribeSession: (() => void) | null = null;
  private readonly sheetCache = new Map<number, { key: string; order: unknown; model: SheetModel }>();
  private readonly scrolls = new Map<number, { top: number; left: number }>();
  private pendingValidation: { tables: Set<string>; all: boolean } | null = null;
  private validationTimer: ReturnType<typeof setTimeout> | null = null;
  private validationChain: Promise<void> = Promise.resolve();
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private modifiedCache: { revision: number; value: boolean } | null = null;
  private focusHandler: (() => void) | null = null;
  private nextKey = 1;
  private saving = false;
  /** 本ツールの中でコピーした内容 */
  clipboard: InternalClipboard | null = null;
  /** Ctrl+Shift+V を押した印（続く paste のイベントで値のみ貼り付けにする。FR-CLP-07） */
  pasteValuesPending = false;

  constructor(options: AppStoreOptions = {}) {
    this.commands = new CommandRegistry(options.commands ?? []);
    this.platform = options.platform ?? detectPlatform();
    this.validatorFactory = options.validator ?? mainThreadValidator;
    this.validationDelay = options.validationDelay ?? 60;
    this.panelPositions = options.panelPositions ?? new Map();
    this.state = {
      locale: options.locale ?? 'ja',
      phase: 'start',
      project: null,
      session: null,
      calc: null,
      source: null,
      revision: 0,
      activeTable: null,
      views: new Map(),
      validation: EMPTY_VALIDATION,
      editing: null,
      panels: { right: null, bottom: null },
      dialogs: [],
      contextMenu: null,
      status: null,
      clipboardMark: null,
      reveal: null,
      loadError: null,
      lastFolder: null,
    };
  }

  // ---- 状態と購読 ----

  getState = (): AppState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    for (const listener of [...this.listeners]) listener();
  }

  /** 文言を引く（今の言語） */
  t(key: string, params?: MessageParams): string {
    return formatMessage(key, params, this.state.locale);
  }

  setLocale(locale: Locale): void {
    this.setState({ locale });
  }

  get project(): Project | null {
    return this.state.project;
  }

  get session(): EditSession | null {
    return this.state.session;
  }

  get calc(): Calculator | null {
    return this.state.calc;
  }

  // ---- プロジェクトを開く・閉じる ----

  /** ファイルの読み書きの口からプロジェクトを読み込んで開く。開けなければ false（開いていたプロジェクトはそのまま） */
  async open(source: ProjectSource): Promise<boolean> {
    const previous = this.state.phase;
    this.setState({ phase: 'loading', loadError: null });
    let errors: string[];
    try {
      const result = await loadProject(source.fs);
      if (result.status === 'ok') {
        this.openLoaded(result.project, source);
        return true;
      }
      errors =
        result.status === 'not-project'
          ? [this.t('ui.open.notProject', { name: source.name })]
          : result.diagnostics.map((d) => this.formatDiagnosticLine(d));
    } catch (e) {
      errors = [errorMessage(e)];
    }
    this.setState({ phase: previous === 'open' ? 'open' : 'start', loadError: errors });
    if (previous === 'open') this.openDialog('message', { titleKey: 'ui.open.failedTitle', items: errors });
    return false;
  }

  /** 読み込み済みのプロジェクトを開く */
  openLoaded(project: Project, source: ProjectSource): void {
    this.disposeProject();
    const calc = new Calculator(project);
    const session = new EditSession(project);
    this.validator = this.validatorFactory(project, calc);
    this.unsubscribeSession = session.subscribe((event) => this.onEditEvent(event));
    this.clipboard = null;
    this.setState({
      phase: 'open',
      project,
      session,
      calc,
      source,
      revision: 0,
      views: new Map(),
      validation: EMPTY_VALIDATION,
      editing: null,
      dialogs: [],
      contextMenu: null,
      clipboardMark: null,
      reveal: null,
      loadError: null,
      activeTable: null,
    });
    const first = this.tabs()[0];
    this.setState({ activeTable: first?.uid ?? null });
    this.scheduleValidation('all', 0);
  }

  /** プロジェクトを閉じる（未保存の確認は呼び出し側で行う） */
  closeProject(): void {
    this.disposeProject();
    this.setState({
      phase: 'start',
      project: null,
      session: null,
      calc: null,
      source: null,
      activeTable: null,
      views: new Map(),
      validation: EMPTY_VALIDATION,
      editing: null,
      dialogs: [],
      contextMenu: null,
      clipboardMark: null,
    });
  }

  private disposeProject(): void {
    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    this.validator?.dispose?.();
    this.validator = null;
    if (this.validationTimer !== null) clearTimeout(this.validationTimer);
    this.validationTimer = null;
    this.pendingValidation = null;
    this.sheetCache.clear();
    this.scrolls.clear();
    this.modifiedCache = null;
  }

  // ---- 編集の通知 ----

  private onEditEvent(event: EditEvent): void {
    const { project, calc } = this.state;
    if (project === null || calc === null) return;
    const patch: Partial<AppState> = { revision: this.state.revision + 1 };
    if (event.kind !== 'saved') {
      invalidateForPatches(calc, event.patches);
      this.validator?.notifyPatches?.(event.patches);
      const changed = changedTablesOf(project, event.patches);
      this.scheduleValidation(changed.all ? 'all' : changed.tables);
      patch.clipboardMark = null;
      if (event.kind === 'apply' && this.clipboard?.data.source?.cut === true) this.clipboard = null;
    }
    // 消えたテーブルを表示していたら、別のテーブルにする
    let active = this.state.activeTable;
    if (active !== null && this.entry(active) === undefined) active = this.tabs()[0]?.uid ?? null;
    // 元に戻す・やり直しでは、そのトランザクションのテーブルを表示する（FR-HIS-02）
    if (event.kind === 'undo' || event.kind === 'redo') {
      const target = event.transaction.tables.find((uid) => this.entry(uid) !== undefined);
      if (target !== undefined) active = target;
    }
    patch.activeTable = active;
    this.setState(patch);
    this.fitSelections();
    if ((event.kind === 'undo' || event.kind === 'redo') && active !== null) this.focusTransaction(event.transaction, active);
  }

  /** 行・列の数が変わったテーブルの選択を表の中に収める */
  private fitSelections(): void {
    let changed = false;
    const views = new Map(this.state.views);
    for (const [uid, view] of views) {
      const sheet = this.sheet(uid);
      if (sheet === null) continue;
      const fitted = fitSelection(view.selection, sheet.size);
      if (fitted !== view.selection) {
        views.set(uid, { ...view, selection: fitted });
        changed = true;
      }
    }
    if (changed) this.setState({ views });
  }

  /** 元に戻した・やり直した範囲を選ぶ */
  private focusTransaction(tx: { focus?: { table: number; records: number[]; columns: string[] } }, table: number): void {
    const focus = tx.focus;
    const sheet = this.sheet(table);
    if (focus === undefined || focus.table !== table || sheet === null || sheet.size.rows === 0 || sheet.size.cols === 0) return;
    const rows = focus.records.map((uid) => sheet.rowOf(uid)).filter((r) => r >= 0);
    const cols = focus.columns.map((name) => sheet.colOf(name)).filter((c) => c >= 0);
    let sel: Selection | null = null;
    if (rows.length > 0 && cols.length > 0) {
      const anchor = { row: Math.min(...rows), col: Math.min(...cols) };
      const end = { row: Math.max(...rows), col: Math.max(...cols) };
      sel = extendTo(selectCell(anchor, sheet.size), end, sheet.size);
    } else if (rows.length > 0) {
      sel = selectRowRange(Math.min(...rows), Math.max(...rows), sheet.size);
    } else if (cols.length > 0) {
      sel = selectColRange(Math.min(...cols), Math.max(...cols), sheet.size);
    }
    if (sel !== null) this.setSelection(sel, { reveal: true, table });
  }

  // ---- 検査（FR-VAL-09） ----

  /** 変更のあったテーブルの検査を予約する。影響を受けるテーブル（affectedTables）もまとめて検査する */
  scheduleValidation(changed: Iterable<string> | 'all', delay = this.validationDelay): void {
    const pending = (this.pendingValidation ??= { tables: new Set(), all: false });
    if (changed === 'all') pending.all = true;
    else for (const name of changed) pending.tables.add(name);
    if (this.validationTimer !== null) clearTimeout(this.validationTimer);
    this.validationTimer = setTimeout(() => {
      this.validationTimer = null;
      void this.flushValidation();
    }, delay);
  }

  /** 予約した検査をすぐに行う（テストや保存の前に使う） */
  flushValidation(): Promise<void> {
    if (this.validationTimer !== null) {
      clearTimeout(this.validationTimer);
      this.validationTimer = null;
    }
    const pending = this.pendingValidation;
    this.pendingValidation = null;
    if (pending === null) return this.validationChain;
    this.validationChain = this.validationChain.then(() => this.runValidation(pending));
    return this.validationChain;
  }

  private async runValidation(pending: { tables: Set<string>; all: boolean }): Promise<void> {
    const { project, calc } = this.state;
    const validator = this.validator;
    if (project === null || calc === null || validator === null) return;
    const names = pending.all ? allTableNames(project) : affectedTablesSafe(project, calc, pending.tables);
    this.setState((s) => ({ validation: { ...s.validation, running: true } }));
    let output;
    try {
      output = await validator.run({ tables: names, common: pending.all });
    } catch (e) {
      this.setState((s) => ({ validation: { ...s.validation, running: false } }));
      this.showStatus(this.t('ui.validation.failed', { message: errorMessage(e) }), 'error');
      return;
    }
    // 検査の間にプロジェクトを閉じた・開き直したら捨てる
    if (this.state.project !== project) return;
    const tables = new Map(pending.all ? [] : this.state.validation.tables);
    const present = new Set(allTableNames(project));
    for (const name of [...tables.keys()]) if (!present.has(name)) tables.delete(name);
    for (const [name, diagnostics] of output.tables) tables.set(name, summarizeIssues(diagnostics));
    this.setState((s) => ({
      validation: {
        version: s.validation.version + 1,
        tables,
        common: output.common ?? s.validation.common,
        running: this.pendingValidation !== null,
      },
    }));
  }

  /** テーブルの検査の結果 */
  issues(name: string): TableIssues | undefined {
    return this.state.validation.tables.get(name);
  }

  formatDiagnosticLine(d: Diagnostic): string {
    const message = formatDiagnostic(d, this.state.locale);
    if (d.file === undefined) return message;
    const where = d.line === undefined ? d.file : `${d.file}:${d.line}${d.column === undefined ? '' : `:${d.column}`}`;
    return `${where}: ${message}`;
  }

  // ---- テーブル ----

  /** シートタブの並び（P-06: テーブル名の昇順。読み込みエラーのテーブルも含む） */
  tabs(): SheetTab[] {
    const project = this.state.project;
    if (project === null) return [];
    const entries: SheetTab[] = [
      ...project.tables.map((t) => ({ uid: t.uid, name: t.name, label: t.display_name ?? t.name, broken: false })),
      ...project.brokenTables.map((t) => ({ uid: t.uid, name: t.name, label: t.name, broken: true })),
    ];
    return entries.sort((a, b) => compareNames(a.name, b.name) || a.uid - b.uid);
  }

  /** テーブル（読み込みエラーのテーブルを含む） */
  entry(uid: number): Table | BrokenTable | undefined {
    const project = this.state.project;
    if (project === null) return undefined;
    return project.tables.find((t) => t.uid === uid) ?? project.brokenTables.find((t) => t.uid === uid);
  }

  /** 編集できるテーブル。省略時は表示中のテーブル */
  table(uid: number | null = this.state.activeTable): Table | undefined {
    if (uid === null) return undefined;
    const e = this.entry(uid);
    return e?.kind === 'table' ? e : undefined;
  }

  setActiveTable(uid: number): void {
    if (this.state.activeTable === uid || this.entry(uid) === undefined) return;
    if (this.state.editing !== null && !this.commitEdit(null)) return;
    this.setState({ activeTable: uid, contextMenu: null });
  }

  /** 隣のシートへ（Ctrl+Shift+PageDown / PageUp） */
  moveActiveTable(delta: number): void {
    const tabs = this.tabs();
    if (tabs.length === 0) return;
    const i = tabs.findIndex((t) => t.uid === this.state.activeTable);
    const next = tabs[Math.max(0, Math.min(tabs.length - 1, (i < 0 ? 0 : i) + delta))];
    this.setActiveTable(next.uid);
  }

  // ---- 表示の状態 ----

  /** テーブルの表示の形（表示中の列・行の並び）。読み込みエラーのテーブルは null */
  sheet(uid: number | null = this.state.activeTable): SheetModel | null {
    const { project, session } = this.state;
    if (uid === null || project === null || session === null) return null;
    const table = this.table(uid);
    if (table === undefined) return null;
    const view = this.state.views.get(uid);
    const order = view?.order ?? null;
    const key = `${session.tableVersion(uid)}:${session.commonVersion()}:${table.records.length}`;
    const cached = this.sheetCache.get(uid);
    if (cached !== undefined && cached.key === key && cached.order === order && cached.model.table === table) return cached.model;
    const model = buildSheetModel(project, table, { order, orderKnown: view?.orderKnown ?? null });
    this.sheetCache.set(uid, { key, order, model });
    return model;
  }

  /** テーブルの表示の状態（無ければ既定の状態） */
  view(uid: number): TableViewState {
    const existing = this.state.views.get(uid);
    if (existing !== undefined) return existing;
    const sheet = this.sheet(uid);
    return {
      selection: selectCell({ row: 0, col: 0 }, sheet?.size ?? { rows: 0, cols: 0 }),
      sort: [],
      filters: [],
      onlyIssues: false,
      order: null,
      orderKnown: null,
    };
  }

  updateView(uid: number, update: (view: TableViewState) => Partial<TableViewState>): void {
    const view = this.view(uid);
    const next = { ...view, ...update(view) };
    const views = new Map(this.state.views);
    views.set(uid, next);
    this.setState({ views });
  }

  /** 表示中のテーブルの選択 */
  selection(uid: number | null = this.state.activeTable): Selection | null {
    if (uid === null || this.table(uid) === undefined) return null;
    return this.view(uid).selection;
  }

  /** 選択を変える。reveal なら、動く端（active）が見えるようにスクロールする */
  setSelection(sel: Selection, options: { reveal?: boolean; table?: number } = {}): void {
    const uid = options.table ?? this.state.activeTable;
    if (uid === null) return;
    const current = this.view(uid).selection;
    const reveal = options.reveal ? { table: uid, pos: sel.active, seq: (this.state.reveal?.seq ?? 0) + 1 } : this.state.reveal;
    if (sameSelection(current, sel) && reveal === this.state.reveal) return;
    const views = new Map(this.state.views);
    views.set(uid, { ...this.view(uid), selection: sel });
    this.setState({ views, reveal });
  }

  /** スクロールの位置（テーブルを切り替えても残す。描画のたびには通知しない） */
  scrollPosition(uid: number): { top: number; left: number } {
    return this.scrolls.get(uid) ?? { top: 0, left: 0 };
  }

  saveScrollPosition(uid: number, top: number, left: number): void {
    this.scrolls.set(uid, { top, left });
  }

  /** 並べ替え・フィルタの条件から行の並びを作り直す（条件を変えたときに呼ぶ） */
  applySortFilter(uid: number): void {
    const calc = this.state.calc;
    const table = this.table(uid);
    if (calc === null || table === undefined) return;
    const view = this.view(uid);
    const order = computeOrder(calc, table, view, this.issues(table.name));
    this.updateView(uid, () => ({ order, orderKnown: order === null ? null : new Set(table.records.map((r) => r.uid)) }));
    this.fitSelections();
  }

  // ---- 編集 ----

  /** コマンドの結果を当てる。失敗はそのまま返す（表示は呼び出し側が決める） */
  apply(result: CommandResult): ApplyResult {
    const session = this.state.session;
    if (session === null) return { ok: false, failures: [] };
    return session.run(result);
  }

  undo(): boolean {
    if (this.state.editing !== null) this.cancelEdit();
    return this.state.session?.undo() !== undefined;
  }

  redo(): boolean {
    if (this.state.editing !== null) this.cancelEdit();
    return this.state.session?.redo() !== undefined;
  }

  /**
   * 選択中のセル（現在のセル）の編集を始める（FR-EDT-01）。
   * mode が edit なら今の中身を残し、overwrite なら text（既定は空）から始める。編集できない列なら始めない（FR-EDT-06）
   */
  beginEdit(options: { origin?: 'cell' | 'formulaBar'; mode?: 'overwrite' | 'edit'; text?: string } = {}): boolean {
    const { project, calc } = this.state;
    const uid = this.state.activeTable;
    const sheet = this.sheet();
    if (project === null || calc === null || uid === null || sheet === null) return false;
    if (this.state.editing !== null) return true;
    const sel = this.view(uid).selection;
    const record = sheet.recordAt(sel.anchor.row);
    const column = sheet.columns[sel.anchor.col];
    if (record === undefined || column === undefined) return false;
    if (!isFieldEditable(column.field)) {
      this.showStatus(this.t('edit.error.readonlyColumn', { column: column.field.display_name ?? column.name }), 'error');
      return false;
    }
    const mode = options.mode ?? 'edit';
    const text = mode === 'edit' ? cellEditText(record.cells.get(column.name), column.field, calc.timeZone) : (options.text ?? '');
    const editing: EditingState = {
      table: uid,
      record: record.uid,
      column: column.name,
      pos: { ...sel.anchor },
      origin: options.origin ?? 'cell',
      mode,
      text,
      error: null,
    };
    this.setState({ editing, contextMenu: null });
    return true;
  }

  setEditText(text: string): void {
    const editing = this.state.editing;
    if (editing === null || editing.text === text) return;
    this.setState({ editing: { ...editing, text, error: null } });
  }

  setEditMode(mode: 'overwrite' | 'edit'): void {
    const editing = this.state.editing;
    if (editing !== null && editing.mode !== mode) this.setState({ editing: { ...editing, mode } });
  }

  cancelEdit(): void {
    if (this.state.editing !== null) this.setState({ editing: null });
  }

  /**
   * 編集を確定する（FR-EDT-04〜05）。型に合わなければ確定させず、理由を editing.error に入れて false を返す。
   * advance があれば、確定した後に選択を動かす
   */
  commitEdit(advance: AdvanceKey | Direction | null = null): boolean {
    const editing = this.state.editing;
    const project = this.state.project;
    if (editing === null) return true;
    if (project === null) {
      this.cancelEdit();
      return true;
    }
    const result = this.apply(
      enterInput(project, { table: editing.table, cells: [{ record: editing.record, column: editing.column }], text: editing.text }),
    );
    if (!result.ok) {
      const f = result.failures[0];
      const error =
        f === undefined
          ? { message: this.t('ui.edit.failed'), hint: '' }
          : { message: formatInputError(f, this.state.locale), hint: f.hint === undefined ? '' : formatInputHint({ hint: f.hint, params: f.params }, this.state.locale) };
      this.setState({ editing: { ...editing, error } });
      return false;
    }
    this.setState({ editing: null });
    if (advance !== null) this.advanceSelection(advance);
    return true;
  }

  /** Enter / Tab（範囲の中を巡回する）や矢印で現在のセルを動かす */
  advanceSelection(advance: AdvanceKey | Direction): void {
    const sheet = this.sheet();
    const sel = this.selection();
    if (sheet === null || sel === null) return;
    const next =
      advance === 'up' || advance === 'down' || advance === 'left' || advance === 'right'
        ? moveCell(sel, advance, sheet.size)
        : advanceInSelection(sel, advance, sheet.size);
    this.setSelection(next, { reveal: true });
  }

  /** 失敗の一覧を文言にする（位置が分かれば「2 行目: …」の形。§5.17 の 3 番） */
  formatFailures(failures: readonly EditFailure[], rowOf?: (f: EditFailure) => number | undefined): string[] {
    const sheet = this.sheet();
    return failures.map((f) => {
      const row = rowOf?.(f) ?? (f.record !== undefined && sheet !== null ? sheet.rowOf(f.record) + 1 || undefined : undefined);
      const column = f.column === undefined ? undefined : (sheet?.columns.find((c) => c.name === f.column)?.field.display_name ?? f.column);
      const message = formatInputError(f, this.state.locale);
      if (row === undefined) return column === undefined ? message : `${column}: ${message}`;
      return column === undefined
        ? formatMessage('edit.failure.atRow', { row, message }, this.state.locale)
        : formatMessage('edit.failure.atCell', { row, column, message }, this.state.locale);
    });
  }

  /** 失敗をダイアログで示す */
  showFailures(titleKey: string, failures: readonly EditFailure[], rowOf?: (f: EditFailure) => number | undefined): void {
    if (failures.length === 0) return;
    this.openDialog('message', { titleKey, items: this.formatFailures(failures, rowOf), tone: 'error' });
  }

  /** コマンドを当て、失敗ならダイアログで示す */
  applyOrReport(result: CommandResult, titleKey = 'ui.edit.failedTitle'): ApplyResult {
    const r = this.apply(result);
    if (!r.ok) this.showFailures(titleKey, r.failures);
    return r;
  }

  // ---- 操作の登録簿 ----

  isEnabled(id: string): boolean {
    const def = this.commands.get(id);
    if (def === undefined) return false;
    try {
      return def.enabled?.(this) ?? true;
    } catch {
      return false;
    }
  }

  /** 操作を呼ぶ。使えなければ何もしない */
  run(id: string, args?: unknown): void | Promise<void> {
    const def = this.commands.get(id);
    if (def === undefined || !this.isEnabled(id)) return;
    this.closeContextMenu();
    try {
      const r = def.run(this, args);
      if (r instanceof Promise) {
        return r.catch((e: unknown) => this.showStatus(this.t('ui.command.failed', { message: errorMessage(e) }), 'error'));
      }
    } catch (e) {
      this.showStatus(this.t('ui.command.failed', { message: errorMessage(e) }), 'error');
    }
  }

  commandLabel(id: string): string {
    const def = this.commands.get(id);
    if (def === undefined) return id;
    return def.label?.(this) ?? this.t(def.labelKey);
  }

  // ---- ダイアログ・パネル・メニュー ----

  /** ダイアログを開く（dialogs/index.ts に登録した識別子）。戻り値は閉じるときの番号 */
  openDialog(id: string, args?: unknown): number {
    const key = this.nextKey++;
    const entry: DialogEntry = { key, id, args };
    this.setState((s) => ({ dialogs: [...s.dialogs, entry], contextMenu: null }));
    return key;
  }

  /** ダイアログを閉じる。key を省略すれば一番手前のもの */
  closeDialog(key?: number): void {
    const dialogs = this.state.dialogs;
    if (dialogs.length === 0) return;
    const target = key ?? dialogs[dialogs.length - 1].key;
    this.setState({ dialogs: dialogs.filter((d) => d.key !== target) });
    if (this.state.dialogs.length === 0) this.focusGrid();
  }

  isDialogOpen(id: string): boolean {
    return this.state.dialogs.some((d) => d.id === id);
  }

  openPanel(id: string, position: PanelPosition = this.panelPositions.get(id) ?? 'right'): void {
    this.setState((s) => ({ panels: { ...s.panels, [position]: id } }));
  }

  closePanel(position: PanelPosition): void {
    if (this.state.panels[position] === null) return;
    this.setState((s) => ({ panels: { ...s.panels, [position]: null } }));
    this.focusGrid();
  }

  isPanelOpen(id: string): boolean {
    return this.state.panels.right === id || this.state.panels.bottom === id;
  }

  togglePanel(id: string, position?: PanelPosition): void {
    const pos = position ?? this.panelPositions.get(id) ?? 'right';
    if (this.state.panels[pos] === id) this.closePanel(pos);
    else this.openPanel(id, pos);
  }

  /** 右クリックメニューを開く（項目は操作の識別子で指す） */
  openContextMenu(x: number, y: number, items: MenuEntry[]): void {
    this.setState({ contextMenu: { x, y, items } });
  }

  closeContextMenu(): void {
    if (this.state.contextMenu !== null) this.setState({ contextMenu: null });
  }

  // ---- 知らせ ----

  showStatus(text: string, kind: StatusMessage['kind'] = 'info'): void {
    const status: StatusMessage = { id: this.nextKey++, kind, text };
    this.setState({ status });
    if (this.statusTimer !== null) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null;
      if (this.state.status?.id === status.id) this.setState({ status: null });
    }, kind === 'error' ? 8000 : 4000);
  }

  // ---- グリッドのフォーカス ----

  /** グリッドが、フォーカスを戻す関数を登録する */
  registerFocusHandler(handler: (() => void) | null): void {
    this.focusHandler = handler;
  }

  focusGrid(): void {
    this.focusHandler?.();
  }

  setClipboardMark(mark: ClipboardMark | null): void {
    this.setState({ clipboardMark: mark });
  }

  // ---- 未保存（FR-FIO-03〜05） ----

  isTableModified(uid: number): boolean {
    return this.state.session?.isTableModified(uid) ?? false;
  }

  /** 未保存の変更があるか（速い判定。手で元の値に戻した場合も未保存とみなす） */
  isProjectModified(): boolean {
    const { session, project, revision } = this.state;
    if (session === null || project === null) return false;
    if (this.modifiedCache?.revision === revision) return this.modifiedCache.value;
    const value =
      project.tables.some((t) => session.isTableModified(t.uid)) ||
      session.removedTableFiles().length > 0 ||
      COMMON_PART_NAMES.some((part) => session.isCommonDirty(part));
    this.modifiedCache = { revision, value };
    return value;
  }

  /** 未保存の変更を捨ててよいか確かめてから then を呼ぶ（NFR-17） */
  confirmDiscard(then: () => void | Promise<void>): void {
    if (!this.isProjectModified()) {
      void then();
      return;
    }
    this.openDialog('confirm', {
      titleKey: 'ui.confirm.discardTitle',
      messageKey: 'ui.confirm.discardMessage',
      confirmKey: 'ui.confirm.discard',
      danger: true,
      onConfirm: then,
    });
  }

  // ---- 保存（FR-FIO-02〜05、08） ----

  get isSaving(): boolean {
    return this.saving;
  }

  /**
   * 変更のあるすべてのテーブル（と共通設定）を保存する。検査エラーがあっても止めない（FR-FIO-08）。
   * 名前を変えた・削除したテーブルのファイルの扱いは planSave に従う（P-43）
   */
  async save(): Promise<void> {
    const { session, source } = this.state;
    if (session === null || source === null || this.saving) return;
    if (this.state.editing !== null && !this.commitEdit(null)) return;
    let plan;
    try {
      plan = session.planSave();
    } catch (e) {
      const message = e instanceof SerializeError ? formatMessage(e.code, e.params, this.state.locale) : errorMessage(e);
      this.openDialog('message', { titleKey: 'ui.save.failedTitle', items: [message], tone: 'error' });
      return;
    }
    if (plan.files.length === 0 && plan.remove.length === 0) {
      this.showStatus(this.t('ui.save.nothing'));
      return;
    }
    this.saving = true;
    this.setState({});
    try {
      const outcome = await source.save(plan);
      session.markSaved(outcome.written, outcome.removed);
      if (outcome.failed.length > 0) {
        this.openDialog('message', {
          titleKey: 'ui.save.failedTitle',
          items: outcome.failed.map((f) => `${f.path}: ${f.message}`),
          tone: 'error',
        });
      } else if (outcome.manualRemove.length > 0) {
        this.openDialog('message', {
          titleKey: 'ui.save.manualRemoveTitle',
          messageKey: 'ui.save.manualRemoveMessage',
          items: outcome.manualRemove,
        });
      }
      const count = outcome.written.length;
      if (outcome.failed.length === 0) {
        this.showStatus(
          outcome.downloaded === undefined
            ? this.t('ui.save.done', { count })
            : this.t('ui.save.downloaded', { count, name: outcome.downloaded }),
        );
      }
    } catch (e) {
      this.openDialog('message', { titleKey: 'ui.save.failedTitle', items: [errorMessage(e)], tone: 'error' });
    } finally {
      this.saving = false;
      this.setState({});
    }
  }
}

/** 影響を受けるテーブル（参照の解決に失敗しても、変更のあったテーブルは必ず検査する） */
function affectedTablesSafe(project: Project, calc: Calculator, changed: ReadonlySet<string>): string[] {
  const names = new Set(changed);
  try {
    for (const name of affectedTables(project, calc, changed)) names.add(name);
  } catch {
    for (const name of allTableNames(project)) names.add(name);
  }
  return [...names].sort(compareNames);
}
