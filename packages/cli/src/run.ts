// sheetcraft の CLI（§9.2）。main.ts はこの run を呼ぶだけにして、テストからは run を直接呼ぶ
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import type { Diagnostic, Locale, MessageParams, Project, StorageFormat, Table } from '@sheetcraft/core';
import {
  Calculator,
  emptyView,
  extensionOf,
  formatDiagnostic,
  formatMessage,
  isValidColumnName,
  joinPath,
  loadProject,
  planExport,
  planProjectWrite,
  resolveProjectPaths,
  SerializeError,
  serializeTable,
  validateProject,
} from '@sheetcraft/core';
import { NodeProjectFs, writeFileAtomic } from './node-fs';

export interface Output {
  write(chunk: string): unknown;
}

export interface RunContext {
  /** 相対パスの基準（プロジェクトのフォルダと --out） */
  cwd: string;
  stdout: Output;
  stderr: Output;
}

/** 終了コード: 0 成功、1 検査エラーや --check の不一致、2 使い方の誤りや読み込みの失敗 */
export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

/** コマンドごとに使えるオプション（共通の --lang・--help の他に） */
const COMMAND_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  validate: [],
  export: ['force', 'tables', 'out'],
  new: ['display-name'],
  fmt: ['check'],
  convert: ['to'],
};
const COMMON_OPTIONS = ['lang', 'help'];

const OPTIONS = {
  lang: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  force: { type: 'boolean' },
  tables: { type: 'string' },
  out: { type: 'string' },
  'display-name': { type: 'string' },
  check: { type: 'boolean' },
  to: { type: 'string' },
} as const;

type Values = {
  lang?: string;
  help?: boolean;
  force?: boolean;
  tables?: string;
  out?: string;
  'display-name'?: string;
  check?: boolean;
  to?: string;
};

function isLocale(value: string): value is Locale {
  return value === 'ja' || value === 'en';
}

/** 引数の解析に失敗したときの言語（--lang を手で探す） */
function guessLocale(argv: readonly string[]): Locale {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = a.startsWith('--lang=') ? a.slice('--lang='.length) : a === '--lang' ? argv[i + 1] : undefined;
    if (value !== undefined && isLocale(value)) return value;
  }
  return 'ja';
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

class Cli {
  constructor(
    readonly ctx: RunContext,
    readonly locale: Locale,
  ) {}

  msg(code: string, params?: MessageParams): string {
    return formatMessage(code, params, this.locale);
  }

  out(line: string): void {
    this.ctx.stdout.write(`${line}\n`);
  }

  err(line: string): void {
    this.ctx.stderr.write(`${line}\n`);
  }

  /** 「重大度 ファイル テーブル 主キー 列: メッセージ」（無い項目は -） */
  diagnosticLine(d: Diagnostic): string {
    let file = d.file ?? '-';
    if (d.file !== undefined && d.line !== undefined) {
      file += `:${d.line}${d.column === undefined ? '' : `:${d.column}`}`;
    }
    const severity = this.msg(`cli.severity.${d.severity}`);
    return `${severity} ${file} ${d.table ?? '-'} ${d.recordKey ?? '-'} ${d.field ?? '-'}: ${formatDiagnostic(d, this.locale)}`;
  }

  printDiagnostics(ds: readonly Diagnostic[], to: 'out' | 'err'): void {
    for (const d of ds) {
      const line = this.diagnosticLine(d);
      if (to === 'out') this.out(line);
      else this.err(line);
    }
  }

  summary(ds: readonly Diagnostic[]): string {
    const errors = ds.filter((d) => d.severity === 'error').length;
    return this.msg('cli.validate.summary', { errors, warnings: ds.length - errors });
  }

  /** 表示用のパス（カレントディレクトリからの相対パス） */
  displayPath(abs: string): string {
    const rel = relative(this.ctx.cwd, abs);
    if (rel === '') return '.';
    return isAbsolute(rel) ? rel : rel.split(sep).join('/');
  }

  usageError(code: string, params?: MessageParams): number {
    this.err(this.msg(code, params));
    this.err('');
    this.err(this.msg('cli.usage'));
    return EXIT_USAGE;
  }
}

interface Loaded {
  fs: NodeProjectFs;
  project: Project;
}

async function load(cli: Cli, root: string): Promise<Loaded | null> {
  const fs = new NodeProjectFs(root);
  const result = await loadProject(fs);
  if (result.status === 'not-project') {
    cli.err(cli.msg('cli.error.notProject', { dir: cli.displayPath(root) }));
    return null;
  }
  if (result.status === 'error') {
    cli.printDiagnostics(result.diagnostics, 'err');
    cli.err(cli.msg('cli.error.loadFailed'));
    return null;
  }
  return { fs, project: result.project };
}

/** ファイルを書く。失敗したら文言を出して false */
async function writeFiles(cli: Cli, files: readonly { abs: string; text: string; message: string }[]): Promise<boolean> {
  for (const file of files) {
    try {
      await writeFileAtomic(file.abs, file.text);
    } catch (e) {
      cli.err(cli.msg('cli.error.write', { path: cli.displayPath(file.abs), detail: errorMessage(e) }));
      return false;
    }
    cli.out(file.message);
  }
  return true;
}

// ---- コマンド ----

/** FR-CLI-01: 全テーブルを検査する。エラーがあれば 1（警告だけなら 0） */
async function cmdValidate(cli: Cli, root: string): Promise<number> {
  const loaded = await load(cli, root);
  if (loaded === null) return EXIT_USAGE;
  const { project } = loaded;
  const ds = validateProject(project, new Calculator(project));
  cli.printDiagnostics(ds, 'out');
  cli.out(ds.length === 0 ? cli.msg('cli.validate.ok') : cli.summary(ds));
  return ds.some((d) => d.severity === 'error') ? EXIT_FAILED : EXIT_OK;
}

/** FR-CLI-02: 出力する。エラーがあれば（--force でなければ）書かずに 1 */
async function cmdExport(cli: Cli, root: string, values: Values): Promise<number> {
  const loaded = await load(cli, root);
  if (loaded === null) return EXIT_USAGE;
  const { fs, project } = loaded;
  const tables =
    values.tables === undefined
      ? undefined
      : values.tables
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '');
  if (tables !== undefined) {
    const known = new Set([...project.tables, ...project.brokenTables].map((t) => t.name));
    const unknown = tables.filter((name) => !known.has(name));
    if (unknown.length > 0) {
      for (const name of unknown) cli.err(cli.msg('cli.error.unknownTable', { name }));
      return EXIT_USAGE;
    }
  }
  // --out はカレントディレクトリから、output.out_dir はプロジェクトのルートからの相対パス
  const outDir =
    values.out !== undefined ? resolve(cli.ctx.cwd, values.out) : fs.resolve(resolveProjectPaths(project.config).outDir);
  const result = planExport(project, new Calculator(project), { tables, force: values.force === true, outDir: '' });
  cli.printDiagnostics(result.diagnostics, 'out');
  if (result.diagnostics.length > 0) cli.out(cli.summary(result.diagnostics));
  if (!result.ok) {
    cli.err(cli.msg('cli.export.blocked'));
    return EXIT_FAILED;
  }
  const files = result.files.map((file) => {
    const abs = join(outDir, ...file.path.split('/'));
    return { abs, text: file.text, message: cli.msg('cli.export.wrote', { path: cli.displayPath(abs) }) };
  });
  return (await writeFiles(cli, files)) ? EXIT_OK : EXIT_USAGE;
}

/** FR-CLI-03: 共通列を含むテーブルの雛形（fields と records は空）を作る。既にあれば失敗 */
async function cmdNew(cli: Cli, root: string, name: string | undefined, values: Values): Promise<number> {
  if (name === undefined || name === '') return cli.usageError('cli.error.missingTableName');
  if (!isValidColumnName(name)) {
    cli.err(cli.msg('cli.error.invalidTableName', { name }));
    return EXIT_USAGE;
  }
  const loaded = await load(cli, root);
  if (loaded === null) return EXIT_USAGE;
  const { fs, project } = loaded;
  const paths = resolveProjectPaths(project.config);
  const format: StorageFormat = project.config.storage.format;

  let existing = [...project.tables, ...project.brokenTables].find((t) => t.name === name)?.source?.path;
  for (const ext of ['yaml', 'yml', 'json']) {
    if (existing !== undefined) break;
    const candidate = joinPath(paths.tablesDir, `${name}.${ext}`);
    if ((await fs.read(candidate)) !== null) existing = candidate;
  }
  if (existing !== undefined) {
    cli.err(cli.msg('cli.error.tableExists', { name, path: existing }));
    return EXIT_USAGE;
  }

  const table: Table = {
    kind: 'table',
    uid: project.uids.next(),
    name,
    fields: [],
    records: [],
    view: emptyView(),
    source: null,
    diagnostics: [],
  };
  const displayName = values['display-name'];
  if (displayName !== undefined) table.display_name = displayName;
  const path = joinPath(paths.tablesDir, `${name}.${extensionOf(format)}`);
  const text = serializeTable(table, project.common.base_fields.items, format);
  const ok = await writeFiles(cli, [{ abs: fs.resolve(path), text, message: cli.msg('cli.new.created', { path }) }]);
  return ok ? EXIT_OK : EXIT_USAGE;
}

function planOrReport(cli: Cli, project: Project, format?: StorageFormat): ReturnType<typeof planProjectWrite> | null {
  try {
    return planProjectWrite(project, format === undefined ? {} : { format });
  } catch (e) {
    if (!(e instanceof SerializeError)) throw e;
    cli.err(cli.msg('cli.error.serialize', { detail: formatMessage(e.code, e.params, cli.locale) }));
    return null;
  }
}

/** FR-CLI-04: 全ファイルを正規形で書き直す。--check なら書かずに、正規形でないファイルを一覧して 1 */
async function cmdFmt(cli: Cli, root: string, values: Values): Promise<number> {
  const loaded = await load(cli, root);
  if (loaded === null) return EXIT_USAGE;
  const { fs, project } = loaded;
  const plan = planOrReport(cli, project);
  if (plan === null) return EXIT_USAGE;
  const changed = plan.files.filter((f) => f.changed);
  // P-40: 読み込みエラーのテーブルは書かない
  for (const table of plan.skipped) {
    cli.printDiagnostics(
      table.diagnostics.filter((d) => d.severity === 'error'),
      'err',
    );
    cli.err(cli.msg('cli.fmt.skipped', { path: table.source.path }));
  }
  const incomplete = plan.skipped.length > 0;
  if (values.check === true) {
    for (const file of changed) cli.out(cli.msg('cli.fmt.notCanonical', { path: file.path }));
    if (changed.length === 0 && !incomplete) cli.out(cli.msg('cli.fmt.ok'));
    return changed.length > 0 || incomplete ? EXIT_FAILED : EXIT_OK;
  }
  const files = changed.map((f) => ({ abs: fs.resolve(f.path), text: f.text, message: cli.msg('cli.fmt.wrote', { path: f.path }) }));
  if (!(await writeFiles(cli, files))) return EXIT_USAGE;
  for (const path of plan.remove) await fs.remove(path);
  if (changed.length === 0 && !incomplete) cli.out(cli.msg('cli.fmt.ok'));
  return incomplete ? EXIT_FAILED : EXIT_OK;
}

/** FR-CLI-05: リソースファイル（テーブルと共通設定）の形式を変え、storage.format も書き換え、元のファイルを消す */
async function cmdConvert(cli: Cli, root: string, values: Values): Promise<number> {
  const to = values.to;
  if (to === undefined) return cli.usageError('cli.error.missingTo');
  if (to !== 'yaml' && to !== 'json') return cli.usageError('cli.error.invalidFormat', { value: to });
  const loaded = await load(cli, root);
  if (loaded === null) return EXIT_USAGE;
  const { fs, project } = loaded;
  // 読み込みエラーのテーブルは変換できない。残すと形式が混ざるので、全体を取りやめる
  if (project.brokenTables.length > 0) {
    for (const table of project.brokenTables) {
      cli.printDiagnostics(
        table.diagnostics.filter((d) => d.severity === 'error'),
        'err',
      );
    }
    cli.err(cli.msg('cli.error.brokenTables', { paths: project.brokenTables.map((t) => t.source.path).join(', ') }));
    return EXIT_USAGE;
  }
  const plan = planOrReport(cli, project, to);
  if (plan === null) return EXIT_USAGE;
  const files = plan.files
    .filter((f) => f.changed)
    .map((f) => ({ abs: fs.resolve(f.path), text: f.text, message: cli.msg('cli.convert.wrote', { path: f.path }) }));
  // 新しいファイルをすべて書けてから元のファイルを消す
  if (!(await writeFiles(cli, files))) return EXIT_USAGE;
  for (const path of plan.remove) {
    await fs.remove(path);
    cli.out(cli.msg('cli.convert.removed', { path }));
  }
  cli.out(cli.msg('cli.convert.done', { format: to }));
  return EXIT_OK;
}

/** CLI を実行して終了コードを返す */
export async function run(argv: readonly string[], ctx: RunContext): Promise<number> {
  let values: Values;
  let positionals: string[];
  try {
    const parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true });
    values = parsed.values as Values;
    positionals = parsed.positionals;
  } catch (e) {
    return new Cli(ctx, guessLocale(argv)).usageError('cli.error.parse', { detail: errorMessage(e) });
  }

  const lang = values.lang ?? 'ja';
  if (!isLocale(lang)) return new Cli(ctx, 'ja').usageError('cli.error.invalidLang', { value: lang });
  const cli = new Cli(ctx, lang);
  if (values.help === true) {
    cli.out(cli.msg('cli.usage'));
    return EXIT_OK;
  }

  const [command, ...rest] = positionals;
  if (command === undefined) return cli.usageError('cli.error.missingCommand');
  const allowed = COMMAND_OPTIONS[command];
  if (allowed === undefined) return cli.usageError('cli.error.unknownCommand', { command });
  for (const option of Object.keys(values)) {
    if (!COMMON_OPTIONS.includes(option) && !allowed.includes(option)) {
      return cli.usageError('cli.error.unknownOption', { command, option });
    }
  }

  // new だけはテーブル名を取る。残りの引数はプロジェクトのフォルダ（省略時はカレントディレクトリ）
  const tableName = command === 'new' ? rest.shift() : undefined;
  if (rest.length > 1) return cli.usageError('cli.error.tooManyArguments', { args: rest.join(' ') });
  const root = resolve(ctx.cwd, rest[0] ?? '.');

  switch (command) {
    case 'validate':
      return cmdValidate(cli, root);
    case 'export':
      return cmdExport(cli, root, values);
    case 'new':
      return cmdNew(cli, root, tableName, values);
    case 'fmt':
      return cmdFmt(cli, root, values);
    default:
      return cmdConvert(cli, root, values);
  }
}
