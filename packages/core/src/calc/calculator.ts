// セルの実効値の計算（P-10、FR-FML-09〜14）。
// セル単位で、必要になったときに再帰的に評価する。評価中のセルの集合で循環参照を見つける（P-33、FR-FML-11）
import type { RawValue } from '../model/cell';
import { cellValue, isEmptyValue, RichCell } from '../model/cell';
import type { FieldDef } from '../model/field';
import type { Project } from '../model/project';
import type { Table, TableRecord } from '../model/table';
import { primaryColumn, tableColumns } from '../model/table';
import {
  checkResultType,
  circularReference,
  DateTimeValue,
  displayValue,
  EMPTY,
  evaluate,
  extractDependencies,
  FList,
  FormulaError,
  ParseCache,
  rawToValue,
  refColumnNotFound,
  refKeyNotFound,
  refTableNotFound,
} from '../formula';
import type { EvalScope, FormulaDependencies, FValue, ParseResult } from '../formula';
import { defaultTimeZone, isValidTimeZone } from '../util/datetime';

/** 実効値がどこから決まったか（P-10） */
export type CellSource = 'value' | 'override' | 'formula' | 'default' | 'empty';

export interface CellResult {
  /** 式から見た値（エラーなら FormulaError） */
  value: FValue;
  /** 出力に使う型付きの値。未入力・式のエラーは undefined */
  raw: RawValue | undefined;
  source: CellSource;
  /** 式のエラー（source が override / formula のときだけ） */
  error?: FormulaError;
}

export interface CalculatorOptions {
  /** 日時の計算に使うタイムゾーン。省略時はプロジェクト設定、それも無ければ実行環境のもの（DR-07） */
  timeZone?: string;
  /** 式の構文解析のキャッシュ（画面で共有する場合に渡す） */
  parseCache?: ParseCache;
}

const EMPTY_RESULT: CellResult = Object.freeze({ value: EMPTY, raw: undefined, source: 'empty' }) as CellResult;

/** 再帰の深さの上限。超えたら、深いところのセルを先に計算してからやり直す（スタックの溢れを防ぐ） */
const MAX_EVAL_DEPTH = 150;

/** REF のキーの照合に使う、主キーの索引のノード（列名には使えない文字で始める） */
const KEY_NODE = '\u0001key';

const SAME_RECORD = 1;
const CROSS_RECORD = 2;

interface CacheEntry {
  /** 評価した式のテキスト（式が変わっていれば使わない） */
  text: string;
  result: CellResult;
}

/** 評価中のセルの印。キャッシュにこれがあるセルに戻ってきたら循環参照 */
const EVALUATING: CacheEntry = { text: '', result: EMPTY_RESULT };

interface TableState {
  table: Table;
  columns: FieldDef[];
  /** 列名 → 列（同じ名前が複数あれば先のもの） */
  byName: Map<string, FieldDef>;
  /** 小文字の列名 → 列（式の中の列名。P-30） */
  byLower: Map<string, FieldDef>;
  /** 小文字の列名 → 列名（キャッシュを捨てるとき） */
  namesByLower: Map<string, string[]>;
  primary: FieldDef | undefined;
  /** 内部番号 → レコード（必要になったときに作る） */
  records: Map<number, TableRecord> | null;
  /** 列名 → 内部番号 → 式の結果 */
  cache: Map<string, Map<number, CacheEntry>>;
  /** 主キーの索引（valueKey → レコード） */
  keyIndex: Map<string, TableRecord> | null;
  /** 評価中の主キーのセルの数（このときに索引が要るのは循環参照） */
  primaryEvaluating: number;
  /** グラフに登録済みの式（小文字の列名 → 式のテキスト） */
  registered: Map<string, Set<string>>;
  /** REF で参照するテーブル（必要になったときに作る） */
  refTables: Set<string> | null;
}

interface Frame {
  state: TableState;
  record: TableRecord;
  column: FieldDef;
}

interface Dependent {
  table: string;
  /** 小文字の列名 */
  column: string;
  flags: number;
}

function nodeKey(table: string, column: string): string {
  return `${table}\u0000${column}`;
}

/** 列レベル式があるか（空の式は無いものとする） */
export function hasColumnFormula(field: FieldDef): field is FieldDef & { formula: string } {
  return field.formula !== undefined && field.formula.trim() !== '';
}

/** セル単位式（空なら undefined） */
export function cellOverride(record: TableRecord, field: string): string | undefined {
  const cell = record.cells.get(field);
  if (!(cell instanceof RichCell) || cell.override === undefined || cell.override.trim() === '') return undefined;
  return cell.override;
}

/**
 * 値の照合用のキー（主キー・unique・ref の照合）。number と bigint の同じ整数は同じキー。
 * 未入力・空文字・エラーは undefined
 */
export function valueKey(v: FValue): string | undefined {
  if (typeof v === 'number') return Number.isInteger(v) ? `i${BigInt(v)}` : `f${v}`;
  if (typeof v === 'bigint') return `i${v}`;
  if (typeof v === 'string') return v === '' ? undefined : `s${v}`;
  if (typeof v === 'boolean') return v ? 'b1' : 'b0';
  if (v instanceof DateTimeValue) return `d${v.epochMs}`;
  if (v instanceof FList) {
    const parts: string[] = [];
    for (const item of v.items) {
      const k = valueKey(item);
      if (k === undefined) return undefined;
      parts.push(k);
    }
    return `l${JSON.stringify(parts)}`;
  }
  return undefined;
}

const DATETIME_CACHE_LIMIT = 100_000;
const dateTimeCache = new Map<string, FValue>();

/** datetime の列の文字列を式の値にする。読むのは文字列だけで決まるので、文字列ごとに覚えておく */
function dateTimeValue(raw: string): FValue {
  let v = dateTimeCache.get(raw);
  if (v === undefined) {
    v = rawToValue(raw, 'datetime');
    if (dateTimeCache.size >= DATETIME_CACHE_LIMIT) dateTimeCache.clear();
    dateTimeCache.set(raw, v);
  }
  return v;
}

/** 深すぎる再帰の印（呼び出し元に返る前に必ず解消される） */
function tooDeep(): FormulaError {
  return new FormulaError('#REF!', 'calc.tooDeep');
}

export class Calculator {
  readonly parseCache: ParseCache;
  private tz: string;
  private readonly explicitTimeZone: string | undefined;
  private readonly states = new Map<Table, TableState>();
  private nameIndex = new Map<string, Table>();
  private enums = new Map<string, readonly string[]>();
  /** 依存先（テーブル → 小文字の列名）→ 依存元のキー → 依存元 */
  private readonly dependents = new Map<string, Map<string, Map<string, Dependent>>>();
  /** テーブルの式が登録した辺（そのテーブルを作り直すときに消す） */
  private readonly outgoing = new Map<string, [string, string, string][]>();
  private readonly depsCache = new Map<string, FormulaDependencies | null>();
  private depth = 0;
  private frontier: Frame | null = null;
  private transientHits = 0;

  constructor(
    readonly project: Project,
    options: CalculatorOptions = {},
  ) {
    this.parseCache = options.parseCache ?? new ParseCache();
    this.explicitTimeZone = options.timeZone;
    this.tz = this.resolveTimeZone();
    this.rebuildIndexes();
  }

  /** 日時の計算と出力に使うタイムゾーン */
  get timeZone(): string {
    return this.tz;
  }

  // ---- 公開 API ----

  /** セルの実効値。テーブル・レコード・列が無ければ未入力 */
  getCell(table: Table | string, recordUid: number, field: string): CellResult {
    const state = this.stateFor(table);
    if (state === undefined) return EMPTY_RESULT;
    const record = this.recordOf(state, recordUid);
    const column = this.columnOf(state, field);
    if (record === undefined || column === undefined) return EMPTY_RESULT;
    return this.evaluateTop({ state, record, column });
  }

  /** テーブルの列（共通列が先） */
  columns(table: Table | string): readonly FieldDef[] {
    return this.stateFor(table)?.columns ?? [];
  }

  /** テーブルの主キーの列 */
  primaryColumn(table: Table | string): FieldDef | undefined {
    return this.stateFor(table)?.primary;
  }

  /** 名前でテーブルを探す（読み込みエラーのテーブルは含まない） */
  findTable(name: string): Table | undefined {
    let t = this.nameIndex.get(name);
    if (t === undefined) {
      // テーブルの追加を知らされていなくても見つけられるように、見つからなければ作り直す
      this.rebuildNameIndex();
      t = this.nameIndex.get(name);
    }
    return t;
  }

  /** 主キーの値でレコードを探す（REF と同じ照合） */
  findRecordByKey(table: Table | string, key: FValue): TableRecord | undefined {
    const state = this.stateFor(table);
    if (state === undefined) return undefined;
    const k = valueKey(key);
    if (k === undefined) return undefined;
    const index = this.keyIndexTop(state);
    return index.get(k);
  }

  /** レコードの主キーの表示用の文字列（診断に付ける。FR-VAL-08）。主キーが無い・未入力なら undefined */
  recordKey(table: Table | string, record: TableRecord): string | undefined {
    const state = this.stateFor(table);
    if (state === undefined || state.primary === undefined) return undefined;
    const raw = this.evaluateTop({ state, record, column: state.primary }).raw;
    if (raw === undefined || Array.isArray(raw)) return undefined;
    return String(raw);
  }

  /** 列挙型の値の一覧。enum_ref が無い・見つからなければ undefined */
  enumValues(field: FieldDef): readonly string[] | undefined {
    return field.enum_ref === undefined ? undefined : this.enums.get(field.enum_ref);
  }

  /** 式の依存関係（構文エラーなら null）。式のテキストごとにキャッシュする */
  formulaDependencies(text: string): FormulaDependencies | null {
    if (this.depsCache.has(text)) return this.depsCache.get(text) ?? null;
    const parsed = this.parseCache.get(text);
    const deps = parsed.ok ? extractDependencies(parsed.ast) : null;
    if (this.depsCache.size >= 10_000) this.depsCache.clear();
    this.depsCache.set(text, deps);
    return deps;
  }

  /** 式の構文解析（キャッシュを使う） */
  parse(text: string): ParseResult {
    return this.parseCache.get(text);
  }

  /** テーブルの式（列レベル式とセル単位式）が REF で参照するテーブル名 */
  formulaRefTables(table: Table | string): ReadonlySet<string> {
    const state = this.stateFor(table);
    if (state === undefined) return new Set();
    if (state.refTables === null) {
      const set = new Set<string>();
      for (const column of state.columns) {
        if (hasColumnFormula(column)) this.addRefTables(set, column.formula);
      }
      for (const record of state.table.records) {
        for (const cell of record.cells.values()) {
          if (cell instanceof RichCell && cell.override !== undefined && cell.override.trim() !== '') {
            this.addRefTables(set, cell.override);
          }
        }
      }
      state.refTables = set;
    }
    return state.refTables;
  }

  /**
   * セルの変更を知らせる。そのセルと、その列に依存する列（同じテーブルの式、他のテーブルの REF）の
   * キャッシュを、列の単位で推移的に捨てる（FR-FML-14）。同じレコードの中だけの依存は、そのレコードだけを捨てる
   */
  invalidateCell(table: Table | string, recordUid: number, field: string): void {
    const t = typeof table === 'string' ? this.findTable(table) : table;
    const name = typeof table === 'string' ? table : table.name;
    const state = t === undefined ? undefined : this.states.get(t);
    if (state !== undefined && state.refTables !== null) {
      const record = this.recordOf(state, recordUid);
      const override = record === undefined ? undefined : cellOverride(record, field);
      if (override !== undefined) this.addRefTables(state.refTables, override);
    }
    this.propagate([[name, field.toLowerCase(), recordUid]]);
  }

  /**
   * テーブルの構造の変化（行の追加・削除・並べ替え、列定義や式の変更、テーブルの追加）を知らせる。
   * そのテーブルの計算結果と、それに依存する他のテーブルのキャッシュを捨てる
   */
  invalidateTable(table: Table | string): void {
    const name = typeof table === 'string' ? table : table.name;
    for (const t of [...this.states.keys()]) {
      if (t === table || t.name === name || (typeof table !== 'string' && t.uid === table.uid)) {
        this.states.delete(t);
      }
    }
    this.removeEdgesOf(name);
    this.rebuildNameIndex();
    const starts: [string, string, number | null][] = [[name, KEY_NODE, null]];
    for (const column of this.dependents.get(name)?.keys() ?? []) starts.push([name, column, null]);
    this.propagate(starts);
  }

  /** すべてのキャッシュを捨てる（テーブルの削除・名前の変更、共通設定・プロジェクト設定の変更など） */
  invalidateAll(): void {
    this.states.clear();
    this.dependents.clear();
    this.outgoing.clear();
    this.tz = this.resolveTimeZone();
    this.rebuildIndexes();
  }

  // ---- 状態 ----

  private resolveTimeZone(): string {
    if (this.explicitTimeZone !== undefined) return this.explicitTimeZone;
    const tz = this.project.config.timezone;
    return tz !== undefined && isValidTimeZone(tz) ? tz : defaultTimeZone();
  }

  private rebuildIndexes(): void {
    this.rebuildNameIndex();
    this.enums = new Map();
    for (const def of this.project.common.enums.items) {
      if (!this.enums.has(def.name)) this.enums.set(def.name, def.values);
    }
  }

  private rebuildNameIndex(): void {
    const index = new Map<string, Table>();
    for (const t of this.project.tables) {
      if (!index.has(t.name)) index.set(t.name, t);
    }
    this.nameIndex = index;
  }

  private stateFor(table: Table | string): TableState | undefined {
    const t = typeof table === 'string' ? this.findTable(table) : table;
    if (t === undefined) return undefined;
    return this.states.get(t) ?? this.createState(t);
  }

  private stateByName(name: string): TableState | undefined {
    const t = this.nameIndex.get(name);
    return t === undefined ? undefined : this.states.get(t);
  }

  private createState(table: Table): TableState {
    const columns = tableColumns(this.project.common.base_fields.items, table);
    const byName = new Map<string, FieldDef>();
    const byLower = new Map<string, FieldDef>();
    const namesByLower = new Map<string, string[]>();
    for (const column of columns) {
      if (byName.has(column.name)) continue;
      byName.set(column.name, column);
      const lower = column.name.toLowerCase();
      if (!byLower.has(lower)) byLower.set(lower, column);
      const names = namesByLower.get(lower);
      if (names === undefined) namesByLower.set(lower, [column.name]);
      else names.push(column.name);
    }
    const state: TableState = {
      table,
      columns,
      byName,
      byLower,
      namesByLower,
      primary: primaryColumn(columns),
      records: null,
      cache: new Map(),
      keyIndex: null,
      primaryEvaluating: 0,
      registered: new Map(),
      refTables: null,
    };
    this.states.set(table, state);
    // 列レベル式の依存関係をグラフに登録する（セル単位式は評価したときに登録する）
    for (const column of byName.values()) {
      if (hasColumnFormula(column)) this.registerFormula(state, column, column.formula);
    }
    return state;
  }

  private recordOf(state: TableState, uid: number): TableRecord | undefined {
    if (state.records === null || !state.records.has(uid)) {
      // 行の追加を知らされていなくても見つけられるように、見つからなければ作り直す
      const map = new Map<number, TableRecord>();
      for (const record of state.table.records) map.set(record.uid, record);
      state.records = map;
    }
    return state.records.get(uid);
  }

  private columnOf(state: TableState, field: string): FieldDef | undefined {
    return state.byName.get(field) ?? state.byLower.get(field.toLowerCase());
  }

  // ---- 依存関係のグラフ（列の単位） ----

  private addRefTables(set: Set<string>, text: string): void {
    const deps = this.formulaDependencies(text);
    if (deps === null) return;
    for (const ref of deps.refs) set.add(ref.table);
  }

  private addEdge(owner: string, fromTable: string, fromColumn: string, to: Dependent): void {
    let byColumn = this.dependents.get(fromTable);
    if (byColumn === undefined) {
      byColumn = new Map();
      this.dependents.set(fromTable, byColumn);
    }
    let deps = byColumn.get(fromColumn);
    if (deps === undefined) {
      deps = new Map();
      byColumn.set(fromColumn, deps);
    }
    const key = nodeKey(to.table, to.column);
    const existing = deps.get(key);
    if (existing === undefined) deps.set(key, { ...to });
    else existing.flags |= to.flags;
    let list = this.outgoing.get(owner);
    if (list === undefined) {
      list = [];
      this.outgoing.set(owner, list);
    }
    list.push([fromTable, fromColumn, key]);
  }

  /** 式の依存関係を、その式を持つ列への辺としてグラフに登録する */
  private registerFormula(state: TableState, column: FieldDef, text: string): void {
    const lower = column.name.toLowerCase();
    let texts = state.registered.get(lower);
    if (texts === undefined) {
      texts = new Set();
      state.registered.set(lower, texts);
    }
    if (texts.has(text)) return;
    texts.add(text);
    const deps = this.formulaDependencies(text);
    if (deps === null) return;
    const owner = state.table.name;
    for (const c of deps.columns) {
      this.addEdge(owner, owner, c, { table: owner, column: lower, flags: SAME_RECORD });
    }
    for (const ref of deps.refs) {
      this.addEdge(owner, ref.table, ref.column, { table: owner, column: lower, flags: CROSS_RECORD });
      // キーの照合は参照先の主キーを使うので、主キーの変化にも依存する
      this.addEdge(owner, ref.table, KEY_NODE, { table: owner, column: lower, flags: CROSS_RECORD });
    }
  }

  private removeEdgesOf(owner: string): void {
    const list = this.outgoing.get(owner);
    if (list === undefined) return;
    for (const [fromTable, fromColumn, key] of list) {
      const byColumn = this.dependents.get(fromTable);
      const deps = byColumn?.get(fromColumn);
      if (deps === undefined) continue;
      deps.delete(key);
      if (deps.size === 0) byColumn?.delete(fromColumn);
    }
    this.outgoing.delete(owner);
  }

  private dropCache(table: string, column: string, uid: number | null): void {
    const state = this.stateByName(table);
    if (state === undefined) return;
    for (const name of state.namesByLower.get(column) ?? []) {
      if (uid === null) state.cache.delete(name);
      else state.cache.get(name)?.delete(uid);
    }
  }

  /** 依存元をたどってキャッシュを捨てる。uid が null なら列全体 */
  private propagate(starts: [string, string, number | null][]): void {
    const doneAll = new Set<string>();
    const doneRecord = new Set<string>();
    const queue = [...starts];
    while (queue.length > 0) {
      const [table, column, uid] = queue.pop() as [string, string, number | null];
      const key = nodeKey(table, column);
      if (doneAll.has(key)) continue;
      if (uid === null) doneAll.add(key);
      else {
        const rk = `${key}\u0000${uid}`;
        if (doneRecord.has(rk)) continue;
        doneRecord.add(rk);
      }
      if (column !== KEY_NODE) {
        this.dropCache(table, column, uid);
        // 主キーが変わったら、キーの索引を捨てて REF の依存元をたどる
        const state = this.stateByName(table);
        if (state?.primary !== undefined && state.primary.name.toLowerCase() === column) {
          state.keyIndex = null;
          queue.push([table, KEY_NODE, null]);
        }
      }
      const deps = this.dependents.get(table)?.get(column);
      if (deps === undefined) continue;
      for (const d of deps.values()) {
        if ((d.flags & CROSS_RECORD) !== 0) queue.push([d.table, d.column, null]);
        if ((d.flags & SAME_RECORD) !== 0) queue.push([d.table, d.column, uid]);
      }
    }
  }

  // ---- 評価 ----

  /**
   * 呼び出し元からの評価。再帰が深すぎたときは、深いところのセルを先に計算してキャッシュし、やり直す
   * （例: 前の行を REF で参照する累計の列を、末尾の行から計算したとき）
   */
  private evaluateTop(frame: Frame): CellResult {
    if (this.depth > 0) return this.compute(frame.state, frame.record, frame.column);
    this.frontier = null;
    const first = this.compute(frame.state, frame.record, frame.column);
    if (this.frontier === null) return first;
    const stack: Frame[] = [frame];
    for (;;) {
      const top = stack[stack.length - 1];
      this.frontier = null;
      const result = this.compute(top.state, top.record, top.column);
      const next = this.frontier as Frame | null;
      if (next === null) {
        stack.pop();
        if (stack.length === 0) return result;
        continue;
      }
      const same = (f: Frame): boolean =>
        f.state === next.state && f.record === next.record && f.column === next.column;
      if (stack.some(same)) {
        // 深い循環: 循環の中のセルに循環参照のエラーを入れて先に進める
        this.storeCircular(next);
      } else {
        stack.push(next);
      }
    }
  }

  private storeCircular(frame: Frame): void {
    const { state, record, column } = frame;
    const override = cellOverride(record, column.name);
    const text = override ?? column.formula ?? '';
    const source: CellSource = override !== undefined ? 'override' : 'formula';
    const e = circularReference();
    let colCache = state.cache.get(column.name);
    if (colCache === undefined) {
      colCache = new Map();
      state.cache.set(column.name, colCache);
    }
    colCache.set(record.uid, { text, result: { value: e, raw: undefined, source, error: e } });
  }

  /** セルの実効値（P-10: セルの値 ＞ セル単位式 ＞ 列レベル式 ＞ 列の default ＞ 未入力） */
  private compute(state: TableState, record: TableRecord, column: FieldDef): CellResult {
    const cell = record.cells.get(column.name);
    const value = cellValue(cell);
    if (!isEmptyValue(value)) {
      const raw = value as RawValue;
      const v = column.type === 'datetime' && typeof raw === 'string' ? dateTimeValue(raw) : rawToValue(raw, column.type);
      return { value: v, raw, source: 'value' };
    }
    if (cell instanceof RichCell && cell.override !== undefined && cell.override.trim() !== '') {
      return this.formulaCell(state, record, column, cell.override, 'override');
    }
    if (hasColumnFormula(column)) return this.formulaCell(state, record, column, column.formula, 'formula');
    if (column.default !== undefined) {
      return { value: rawToValue(column.default, column.type), raw: column.default, source: 'default' };
    }
    return EMPTY_RESULT;
  }

  private formulaCell(
    state: TableState,
    record: TableRecord,
    column: FieldDef,
    text: string,
    source: 'override' | 'formula',
  ): CellResult {
    let colCache = state.cache.get(column.name);
    if (colCache === undefined) {
      colCache = new Map();
      state.cache.set(column.name, colCache);
    }
    const hit = colCache.get(record.uid);
    if (hit === EVALUATING) {
      const e = circularReference();
      return { value: e, raw: undefined, source, error: e };
    }
    if (hit !== undefined && hit.text === text && hit.result.source === source) return hit.result;
    if (this.depth >= MAX_EVAL_DEPTH) {
      this.transientHits++;
      if (this.frontier === null) this.frontier = { state, record, column };
      const e = tooDeep();
      return { value: e, raw: undefined, source, error: e };
    }

    const hitsBefore = this.transientHits;
    const isPrimary = column === state.primary;
    colCache.set(record.uid, EVALUATING);
    if (isPrimary) state.primaryEvaluating++;
    this.depth++;
    let result: CellResult | undefined;
    try {
      if (source === 'override') this.registerFormula(state, column, text);
      result = this.evaluateText(state, record, column, text, source);
    } finally {
      this.depth--;
      if (isPrimary) state.primaryEvaluating--;
      // 深すぎて途中で打ち切った結果はキャッシュしない
      if (result !== undefined && this.transientHits === hitsBefore) colCache.set(record.uid, { text, result });
      else colCache.delete(record.uid);
    }
    return result;
  }

  private evaluateText(
    state: TableState,
    record: TableRecord,
    column: FieldDef,
    text: string,
    source: 'override' | 'formula',
  ): CellResult {
    const parsed = this.parseCache.get(text);
    const value = parsed.ok ? evaluate(parsed.ast, this.scopeFor(state, record)) : parsed.error;
    // FR-FML-12: 結果を列の型で検査する（暗黙の変換はしない。P-13）
    const check = checkResultType(value, column.type, {
      enumValues: this.enumValues(column),
      timeZone: this.tz,
    });
    if (!check.ok) return { value: check.error, raw: undefined, source, error: check.error };
    const raw = check.raw;
    return { value: raw === undefined ? EMPTY : rawToValue(raw, column.type), raw, source };
  }

  private scopeFor(state: TableState, record: TableRecord): EvalScope {
    return {
      timeZone: this.tz,
      column: (name) => {
        const column = state.byLower.get(name);
        return column === undefined ? undefined : this.compute(state, record, column).value;
      },
      ref: (table, key, column) => this.lookupRef(table, key, column),
    };
  }

  /** REF の解決（P-31）。参照先テーブルの主キーで照合する */
  private lookupRef(tableName: string, key: FValue, columnName: string): FValue {
    const table = this.findTable(tableName);
    if (table === undefined) return refTableNotFound(tableName);
    const state = this.states.get(table) ?? this.createState(table);
    const column = state.byLower.get(columnName);
    if (column === undefined) return refColumnNotFound(tableName, columnName);
    if (key instanceof FormulaError) return key;
    const index = this.keyIndex(state);
    if (index instanceof FormulaError) return index;
    const k = valueKey(key);
    const record = k === undefined ? undefined : index.get(k);
    if (record === undefined) return refKeyNotFound(tableName, displayValue(key, this.tz));
    return this.compute(state, record, column).value;
  }

  private keyIndexTop(state: TableState): Map<string, TableRecord> {
    if (state.keyIndex !== null) return state.keyIndex;
    // 主キーのセルを先に（必要なら深い再帰を解消しながら）計算してから索引を作る
    if (state.primary !== undefined) {
      for (const record of state.table.records) this.evaluateTop({ state, record, column: state.primary });
    }
    const index = this.keyIndex(state);
    return index instanceof FormulaError ? new Map() : index;
  }

  /**
   * 主キーの索引。主キーのセルを評価している途中で索引が要るのは循環参照
   * （索引を作るには、評価中のそのセルも含めてすべての主キーが要るため）
   */
  private keyIndex(state: TableState): Map<string, TableRecord> | FormulaError {
    if (state.keyIndex !== null) return state.keyIndex;
    if (state.primaryEvaluating > 0) return circularReference();
    const index = new Map<string, TableRecord>();
    const primary = state.primary;
    if (primary !== undefined) {
      const hitsBefore = this.transientHits;
      for (const record of state.table.records) {
        const k = valueKey(this.compute(state, record, primary).value);
        // 重複したキーは先のレコードを使う（重複は検査でエラーにする）
        if (k !== undefined && !index.has(k)) index.set(k, record);
      }
      if (this.transientHits !== hitsBefore) return tooDeep();
    }
    state.keyIndex = index;
    return index;
  }
}
