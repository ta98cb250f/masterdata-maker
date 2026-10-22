import type { CommonConfig, CommonPart, CommonPartName } from '../model/common';
import { COMMON_PART_NAMES } from '../model/common';
import { defaultBaseFields, defaultColors, defaultEnums } from '../model/defaults';
import type { Diagnostic } from '../model/diagnostic';
import type { Project, ProjectConfig } from '../model/project';
import { compareNames, joinPath, PROJECT_CONFIG_FILES, resolveProjectPaths } from '../model/project';
import type { SourceFile, StorageFormat } from '../model/source';
import { extensionOf, formatFromPath } from '../model/source';
import type { BrokenTable, Table } from '../model/table';
import { UidAllocator } from '../model/uid';
import { IoCode } from './codes';
import type { CommonPartValues } from './parse';
import { parseCommonFile, parseProjectConfigFile, parseTableFile } from './parse';
import { serializeCommonPart, serializeProjectConfig, serializeTable } from './serialize';

// プロジェクトの読み込みと、書き出すべきファイルの一覧（DR-01〜07、P-01、P-02）

/**
 * ファイルの読み込み口。パスはプロジェクトのルートからの相対パス（区切りは `/`、ルートは空文字）。
 * 書き込みは呼び出し側（app / cli）が行う
 */
export interface ProjectFs {
  /** dir の直下のファイル名（サブフォルダは除く）。dir が無ければ [] */
  list(dir: string): Promise<string[]>;
  /** UTF-8 のテキスト。無ければ null */
  read(path: string): Promise<string | null>;
}

export type LoadProjectResult =
  | { status: 'ok'; project: Project }
  /** ルートにプロジェクト設定ファイルが無い（DR-01） */
  | { status: 'not-project' }
  /** プロジェクト設定・共通設定に読み込みエラーがある */
  | { status: 'error'; diagnostics: Diagnostic[] };

const TABLE_FILE_RE = /\.(?:ya?ml|json)$/;

function commonCandidates(files: readonly string[], name: CommonPartName): string[] {
  return files.filter((file) => file === `${name}.yaml` || file === `${name}.yml` || file === `${name}.json`);
}

function defaultItems(name: CommonPartName): CommonPartValues[CommonPartName][] {
  if (name === 'enums') return defaultEnums();
  if (name === 'base_fields') return defaultBaseFields();
  return defaultColors();
}

function toBroken(table: Table, error: Diagnostic): BrokenTable {
  return {
    kind: 'broken',
    uid: table.uid,
    name: table.name,
    source: table.source as SourceFile,
    diagnostics: [...table.diagnostics, error],
  };
}

function compareTables(a: Table | BrokenTable, b: Table | BrokenTable): number {
  return compareNames(a.name, b.name) || compareNames(a.source?.path ?? '', b.source?.path ?? '');
}

export async function loadProject(fs: ProjectFs): Promise<LoadProjectResult> {
  const configTexts = await Promise.all(PROJECT_CONFIG_FILES.map((path) => fs.read(path)));
  const present = PROJECT_CONFIG_FILES.flatMap((path, i) => {
    const text = configTexts[i];
    return text === null ? [] : [{ path, text }];
  });
  if (present.length === 0) return { status: 'not-project' };
  if (present.length > 1) {
    return {
      status: 'error',
      diagnostics: [
        { severity: 'error', code: IoCode.multipleProjectConfigs, params: { files: PROJECT_CONFIG_FILES.join(', ') } },
      ],
    };
  }

  const configFile = parseProjectConfigFile(present[0].path, present[0].text);
  if (!configFile.ok) return { status: 'error', diagnostics: configFile.diagnostics };
  const config = configFile.value;
  const storage = config.storage.format;
  const paths = resolveProjectPaths(config);
  const diagnostics: Diagnostic[] = [...configFile.diagnostics];

  // P-02: 共通設定
  const configDirFiles = await fs.list(paths.configDir);
  const parts = new Map<CommonPartName, CommonPart<unknown>>();
  const commonPaths = new Set<string>();
  let commonFailed = false;
  for (const name of COMMON_PART_NAMES) {
    const candidates = commonCandidates(configDirFiles, name);
    if (candidates.length > 1) {
      diagnostics.push({
        severity: 'error',
        code: IoCode.multipleCommonFiles,
        params: { name, files: candidates.map((file) => joinPath(paths.configDir, file)).join(', ') },
      });
      commonFailed = true;
      continue;
    }
    if (candidates.length === 0) {
      parts.set(name, { items: defaultItems(name), source: null, isDefault: true });
      continue;
    }
    const path = joinPath(paths.configDir, candidates[0]);
    commonPaths.add(path);
    const text = await fs.read(path);
    if (text === null) {
      parts.set(name, { items: defaultItems(name), source: null, isDefault: true });
      continue;
    }
    const format = formatFromPath(path) ?? storage;
    if (format !== storage) {
      diagnostics.push({
        severity: 'warning',
        code: IoCode.formatMismatch,
        file: path,
        params: { path, expected: storage },
      });
    }
    const parsed = parseCommonFile(name, path, text);
    diagnostics.push(...parsed.diagnostics);
    if (!parsed.ok) {
      commonFailed = true;
      continue;
    }
    parts.set(name, { items: parsed.value, source: { path, format, text }, isDefault: false });
  }
  if (commonFailed) return { status: 'error', diagnostics };
  const common = {
    enums: parts.get('enums'),
    base_fields: parts.get('base_fields'),
    colors: parts.get('colors'),
  } as CommonConfig;

  // テーブル: paths.tables の直下の .yaml / .yml / .json（DR-02、DR-04）
  const configPath = present[0].path;
  const tableFiles = (await fs.list(paths.tablesDir))
    .filter((file) => TABLE_FILE_RE.test(file))
    .map((file) => joinPath(paths.tablesDir, file))
    .filter((path) => path !== configPath && !commonPaths.has(path))
    .sort(compareNames);
  const texts = await Promise.all(tableFiles.map((path) => fs.read(path)));

  const uids = new UidAllocator();
  const loaded: (Table | BrokenTable)[] = [];
  tableFiles.forEach((path, i) => {
    const text = texts[i];
    if (text === null) return;
    loaded.push(
      parseTableFile(path, text, { baseFields: common.base_fields.items, uids, storageFormat: storage }),
    );
  });

  // 同じ table 名が複数あれば、どれも編集の対象にしない
  const byName = new Map<string, (Table | BrokenTable)[]>();
  for (const table of loaded) {
    const group = byName.get(table.name);
    if (group === undefined) byName.set(table.name, [table]);
    else group.push(table);
  }
  const tables: Table[] = [];
  const brokenTables: BrokenTable[] = [];
  for (const table of loaded) {
    const group = byName.get(table.name) ?? [];
    if (group.length > 1) {
      const others = group.filter((t) => t !== table).map((t) => t.source?.path ?? '');
      const error: Diagnostic = {
        severity: 'error',
        code: IoCode.duplicateTableName,
        file: table.source?.path,
        table: table.name,
        params: { name: table.name, others: others.join(', ') },
      };
      if (table.kind === 'table') brokenTables.push(toBroken(table, error));
      else brokenTables.push({ ...table, diagnostics: [...table.diagnostics, error] });
    } else if (table.kind === 'table') {
      tables.push(table);
    } else {
      brokenTables.push(table);
    }
  }
  tables.sort(compareTables);
  brokenTables.sort(compareTables);

  return { status: 'ok', project: { config, common, tables, brokenTables, diagnostics, uids } };
}

export interface WriteFile {
  path: string;
  text: string;
  /** 読み込んだときのテキストと違うか（新しいファイルなら true） */
  changed: boolean;
}

export interface ProjectWritePlan {
  /** 書き出すファイル（変更の無いものも含む。changed で判別する） */
  files: WriteFile[];
  /** 形式を変えたときに不要になるファイル */
  remove: string[];
  /** 読み込みエラーがあり書き出さないテーブル（P-40） */
  skipped: BrokenTable[];
}

export interface PlanOptions {
  /**
   * すべてのリソースファイルをこの形式で書く（CLI の convert）。storage.format も書き換える。
   * 省略時は、読み込んだファイルは元の形式・元のパスのまま、新しいファイルは storage.format で書く
   */
  format?: StorageFormat;
}

function replaceExtension(path: string, format: StorageFormat): string {
  return path.replace(TABLE_FILE_RE, `.${extensionOf(format)}`);
}

function targetPath(source: SourceFile | null, fallback: string, format: StorageFormat): string {
  if (source === null) return fallback;
  return source.format === format ? source.path : replaceExtension(source.path, format);
}

function formatFor(source: SourceFile | null, options: PlanOptions, storage: StorageFormat): StorageFormat {
  return options.format ?? source?.format ?? storage;
}

/**
 * 書き出すべきファイルを返す（core は書き込まない）。既定値のままの共通設定はファイルを作らない。
 * 正規形のファイルを読んで何も変えなければ、どれも changed が false になる（DR-30）
 */
export function planProjectWrite(project: Project, options: PlanOptions = {}): ProjectWritePlan {
  const storage = options.format ?? project.config.storage.format;
  const paths = resolveProjectPaths(project.config);
  const files: WriteFile[] = [];
  const remove: string[] = [];
  const add = (path: string, text: string, source: SourceFile | null): void => {
    const changed = source === null || source.path !== path || source.text !== text;
    files.push({ path, text, changed });
    if (source !== null && source.path !== path) remove.push(source.path);
  };

  // プロジェクト設定ファイル自身の形式は拡張子で決める（P-01）
  const config: ProjectConfig = { ...project.config, storage: { ...project.config.storage, format: storage } };
  const configSource = project.config.source;
  const configFormat = configSource?.format ?? storage;
  add(configSource?.path ?? `masterdata-maker.${extensionOf(configFormat)}`, serializeProjectConfig(config, configFormat), configSource);

  for (const name of COMMON_PART_NAMES) {
    const part = project.common[name];
    if (part.isDefault) continue;
    const format = formatFor(part.source, options, storage);
    const path = targetPath(part.source, joinPath(paths.configDir, `${name}.${extensionOf(format)}`), format);
    add(path, serializeCommonPart(project.common, name, format), part.source);
  }

  const baseFields = project.common.base_fields.items;
  for (const table of project.tables) {
    const format = formatFor(table.source, options, storage);
    const path = targetPath(table.source, joinPath(paths.tablesDir, `${table.name}.${extensionOf(format)}`), format);
    add(path, serializeTable(table, baseFields, format), table.source);
  }
  return { files, remove, skipped: [...project.brokenTables] };
}
