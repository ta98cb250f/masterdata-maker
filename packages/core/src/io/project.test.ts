import { describe, expect, it } from 'vitest';
import { RichCell } from '../model/cell';
import type { Project } from '../model/project';
import { allLoadDiagnostics } from '../model/project';
import { IoCode } from './codes';
import { MemoryProjectFs } from './memory-fs';
import { parseTableFile } from './parse';
import type { LoadProjectResult } from './project';
import { loadProject, planProjectWrite } from './project';
import { serializeProjectConfig, serializeTable } from './serialize';
import { createNodeProjectFs, readTree, repoRoot } from './testing-node-fs';

const SAMPLES = ['basic-yaml', 'basic-json'] as const;

function ok(result: LoadProjectResult): Project {
  if (result.status !== 'ok') throw new Error(`読み込めない: ${JSON.stringify(result)}`);
  return result.project;
}

async function loadSample(name: string): Promise<Project> {
  return ok(await loadProject(await createNodeProjectFs(`${repoRoot()}/samples/${name}`)));
}

const CONFIG_YAML = 'format_version: 1\nstorage:\n  format: yaml\n';

describe('NFR-16・DR-30: サンプルの往復', () => {
  for (const sample of SAMPLES) {
    it(`${sample}: 読み込んで何も変えずに書き出すと、どのファイルも 1 バイトも変わらない`, async () => {
      const root = `${repoRoot()}/samples/${sample}`;
      const project = await loadSample(sample);
      expect(allLoadDiagnostics(project)).toEqual([]);
      expect(project.brokenTables).toEqual([]);
      const plan = planProjectWrite(project);
      const onDisk = await readTree(root);
      // サンプルのすべてのファイルが書き出しの対象になっていて、内容が一致する
      expect(plan.files.map((f) => f.path).sort()).toEqual([...onDisk.keys()].sort());
      for (const file of plan.files) {
        expect(file.text, file.path).toBe(onDisk.get(file.path));
        expect(file.changed, file.path).toBe(false);
      }
      expect(plan.remove).toEqual([]);
      expect(plan.skipped).toEqual([]);
    });
  }

  it('basic-yaml と basic-json は同じデータで、形式だけが違う', async () => {
    const fromYaml = await loadSample('basic-yaml');
    const jsonFiles = await readTree(`${repoRoot()}/samples/basic-json`);
    const converted = planProjectWrite(fromYaml, { format: 'json' });
    for (const file of converted.files) {
      if (file.path === 'sheetcraft.yaml') {
        // 設定ファイル自身の形式は拡張子で決まる（P-01）。JSON にすると basic-json と一致する
        const config = { ...fromYaml.config, storage: { format: 'json' as const } };
        expect(serializeProjectConfig(config, 'json')).toBe(jsonFiles.get('sheetcraft.json'));
        expect(file.text).toBe(CONFIG_YAML.replace('yaml\n', 'json\n') + 'timezone: Asia/Tokyo\npaths:\n  tables: tables/\n  config: config/\noutput:\n  format: json\n  out_dir: build/\n');
        continue;
      }
      expect(file.text, file.path).toBe(jsonFiles.get(file.path));
    }
    expect(converted.remove.sort()).toEqual([
      'config/base_fields.yaml',
      'config/colors.yaml',
      'config/enums.yaml',
      'tables/character.yaml',
      'tables/skill.yaml',
      'tables/stage.yaml',
    ]);
  });

  it('YAML → モデル → JSON → モデル → YAML で元に戻る', async () => {
    const project = await loadSample('basic-yaml');
    const base = project.common.base_fields.items;
    for (const table of project.tables) {
      const original = table.source?.text;
      const json = serializeTable(table, base, 'json');
      const fromJson = parseTableFile(`tables/${table.name}.json`, json, { baseFields: base });
      expect(fromJson.kind).toBe('table');
      if (fromJson.kind !== 'table') continue;
      expect(fromJson.diagnostics).toEqual([]);
      expect(serializeTable(fromJson, base, 'yaml')).toBe(original);
    }
  });

  it('サンプルの中身: 型ごとの値・BigInt・RichCell・セル単位式・共通設定', async () => {
    const project = await loadSample('basic-json');
    expect(project.tables.map((t) => t.name)).toEqual(['character', 'skill', 'stage']);
    expect(project.config.timezone).toBe('Asia/Tokyo');
    const character = project.tables[0];
    const [r1, r2, r3] = character.records;
    expect(r1.cells.get('power')).toBe(9007199254740993n);
    expect(r1.cells.get('start_at')).toBe('2026-10-13T12:00:00+09:00');
    expect(r1.cells.get('code')).toBe('NO');
    expect(r1.cells.get('skill_ids')).toEqual([1, 3]);
    expect(r1.cells.get('element')).toEqual(['火', '光']);
    expect(r2.cells.get('code')).toBe('1.10');
    expect(r2.cells.get('memo')).toBe('一行目\n二行目');
    expect(r2.cells.get('effective_hp')).toEqual(new RichCell({ override: 'hp * 2' }));
    expect(r3.cells.get('version')).toBe('0.1.2');
    expect(character.fields.find((f) => f.name === 'effective_hp')?.formula).toBe('hp * (1 + defense / 100)');
    expect(project.common.enums.items.map((e) => e.name)).toEqual(['rarity', 'element']);
    expect(project.common.enums.items[0].values).toEqual(['N', 'R', 'SR', 'SSR']);
    expect(project.common.colors.items).toHaveLength(8);
    expect(project.common.base_fields.isDefault).toBe(false);
    // 内部番号はプロジェクト全体で一意
    const uids = project.tables.flatMap((t) => [t.uid, ...t.records.map((r) => r.uid)]);
    expect(new Set(uids).size).toBe(uids.length);
  });
});

describe('プロジェクトの読み込み（DR-01〜07、P-01、P-02）', () => {
  it('設定ファイルが無ければプロジェクトではない。両方あればエラー', async () => {
    expect(await loadProject(new MemoryProjectFs({ 'tables/a.yaml': 'table: a\n' }))).toEqual({ status: 'not-project' });
    const both = await loadProject(new MemoryProjectFs({ 'sheetcraft.yaml': CONFIG_YAML, 'sheetcraft.json': '{}' }));
    expect(both).toMatchObject({ status: 'error', diagnostics: [{ code: IoCode.multipleProjectConfigs }] });
  });

  it('設定ファイルの知らないキー・新しすぎる版・形式の指定漏れはエラー', async () => {
    const cases: [string, string][] = [
      [`${CONFIG_YAML}foo: 1\n`, IoCode.unknownConfigKey],
      [`${CONFIG_YAML}paths:\n  table: x/\n`, IoCode.unknownConfigKey],
      ['format_version: 2\nstorage:\n  format: yaml\n', IoCode.unsupportedFormatVersion],
      ['format_version: 0\nstorage:\n  format: yaml\n', IoCode.invalidFormatVersion],
      ['format_version: 1\n', IoCode.missingKey],
      ['storage:\n  format: yaml\n', IoCode.missingKey],
      ['format_version: 1\nstorage:\n  format: toml\n', IoCode.invalidStorageFormat],
      [`${CONFIG_YAML}output:\n  format: csv\n`, IoCode.invalidOutputFormat],
    ];
    for (const [text, code] of cases) {
      const result = await loadProject(new MemoryProjectFs({ 'sheetcraft.yaml': text }));
      expect(result, text).toMatchObject({ status: 'error', diagnostics: [{ code, file: 'sheetcraft.yaml' }] });
    }
  });

  it('使えないタイムゾーンは警告にとどめる', async () => {
    const project = ok(await loadProject(new MemoryProjectFs({ 'sheetcraft.yaml': `${CONFIG_YAML}timezone: Mars/Base\n` })));
    expect(project.diagnostics).toMatchObject([{ severity: 'warning', code: IoCode.invalidTimezone }]);
    expect(project.config.timezone).toBe('Mars/Base');
  });

  it('共通設定のファイルが無ければ既定値を使い、保存してもファイルを作らない', async () => {
    const fs = new MemoryProjectFs({
      'sheetcraft.yaml': CONFIG_YAML,
      'tables/a.yaml': 'table: a\nfields: []\nrecords:\n  - id: 1\n    version: "1.0"\n',
    });
    const project = ok(await loadProject(fs));
    expect(project.common.base_fields).toMatchObject({ isDefault: true, source: null });
    expect(project.common.base_fields.items.map((f) => f.name)).toEqual(['id', 'version']);
    expect(project.common.colors.items.map((c) => c.key)).toEqual([
      'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta',
    ]);
    expect(project.common.enums.items).toEqual([]);
    expect(project.tables[0].diagnostics).toEqual([]);
    const plan = planProjectWrite(project);
    expect(plan.files.map((f) => [f.path, f.changed])).toEqual([
      ['sheetcraft.yaml', false],
      ['tables/a.yaml', false],
    ]);
  });

  it('paths で置き場所を変えられる（DR-05）。共通列の定義がテーブルの読み込みに使われる', async () => {
    const fs = new MemoryProjectFs({
      'sheetcraft.yaml': `${CONFIG_YAML}paths:\n  tables: data/\n  config: ./common\n`,
      'common/base_fields.yaml': 'base_fields:\n  - name: key\n    type: string\n    primary: true\n',
      'data/a.yaml': 'table: a\nfields: []\nrecords:\n  - key: k1\n    id: 1\n',
    });
    const project = ok(await loadProject(fs));
    const table = project.tables[0];
    expect(table.records[0].cells.get('key')).toBe('k1');
    // 既定の id は共通列ではないので、列定義に無いキーになる（DR-34）
    expect(table.diagnostics).toMatchObject([{ code: IoCode.unknownRecordKey, params: { key: 'id' }, recordKey: 'k1' }]);
  });

  it('共通設定の読み込みエラーはプロジェクトのエラー。同じ種類のファイルが複数あってもエラー', async () => {
    const broken = await loadProject(
      new MemoryProjectFs({ 'sheetcraft.yaml': CONFIG_YAML, 'config/enums.yaml': 'enums:\n  - name: a\n    vals: [x]\n' }),
    );
    expect(broken).toMatchObject({ status: 'error' });
    if (broken.status === 'error') {
      expect(broken.diagnostics.map((d) => d.code)).toEqual([IoCode.unknownEnumKey, IoCode.missingKey]);
    }
    const twice = await loadProject(
      new MemoryProjectFs({
        'sheetcraft.yaml': CONFIG_YAML,
        'config/colors.yaml': 'colors: []\n',
        'config/colors.json': '{ "colors": [] }',
      }),
    );
    expect(twice).toMatchObject({ status: 'error', diagnostics: [{ code: IoCode.multipleCommonFiles }] });
  });

  it('列挙型の値は文字列。引用符なしの数値は復元して警告する', async () => {
    const project = ok(
      await loadProject(
        new MemoryProjectFs({
          'sheetcraft.yaml': CONFIG_YAML,
          'config/enums.yaml': 'enums:\n  - name: grade\n    values: [1, 2.50, "3"]\n',
        }),
      ),
    );
    expect(project.common.enums.items).toEqual([{ name: 'grade', values: ['1', '2.50', '3'] }]);
    expect(project.diagnostics.map((d) => d.code)).toEqual([IoCode.numberRestoredAsString, IoCode.numberRestoredAsString]);
    expect(planProjectWrite(project).files.find((f) => f.path === 'config/enums.yaml')?.text).toBe(
      'enums:\n  - name: grade\n    values: ["1", "2.50", "3"]\n',
    );
  });

  it('DR-02・DR-04 の警告と、table 名の重複、読み込みエラーのテーブル、並び順（P-06）', async () => {
    const fs = new MemoryProjectFs({
      'sheetcraft.yaml': CONFIG_YAML,
      'tables/zeta.yaml': 'table: zeta\nfields: []\nrecords: []\n',
      'tables/alpha.json': '{ "table": "alpha", "fields": [], "records": [] }',
      'tables/beta.yml': 'table: b\nfields: []\nrecords: []\n',
      'tables/dup1.yaml': 'table: dup\nfields: []\nrecords: []\n',
      'tables/dup2.yaml': 'table: dup\nfields: []\nrecords: []\n',
      'tables/bad.yaml': 'table: bad\nfields: []\nrecords: []\nextra: 1\n',
      'tables/readme.md': '# 無視する',
      'tables/sub/x.yaml': 'table: x\n',
    });
    const project = ok(await loadProject(fs));
    expect(project.tables.map((t) => [t.name, t.source?.path])).toEqual([
      ['alpha', 'tables/alpha.json'],
      ['b', 'tables/beta.yml'],
      ['zeta', 'tables/zeta.yaml'],
    ]);
    expect(project.tables[0].diagnostics).toMatchObject([{ code: IoCode.formatMismatch, params: { expected: 'yaml' } }]);
    expect(project.tables[1].diagnostics).toMatchObject([
      { code: IoCode.fileNameMismatch, params: { path: 'tables/beta.yml', expected: 'b.yml' } },
    ]);
    expect(project.brokenTables.map((t) => [t.name, t.source.path, t.diagnostics.map((d) => d.code)])).toEqual([
      ['bad', 'tables/bad.yaml', [IoCode.unknownTableKey]],
      ['dup', 'tables/dup1.yaml', [IoCode.fileNameMismatch, IoCode.duplicateTableName]],
      ['dup', 'tables/dup2.yaml', [IoCode.fileNameMismatch, IoCode.duplicateTableName]],
    ]);
    const plan = planProjectWrite(project);
    expect(plan.skipped.map((t) => t.source.path)).toEqual(['tables/bad.yaml', 'tables/dup1.yaml', 'tables/dup2.yaml']);
    // 違う形式・違う名前のファイルも、保存では元のパスに書く
    expect(plan.files.map((f) => [f.path, f.changed])).toEqual([
      ['sheetcraft.yaml', false],
      ['tables/alpha.json', true],
      ['tables/beta.yml', false],
      ['tables/zeta.yaml', false],
    ]);
  });

  it('形式を変えた書き出し（convert）は拡張子を替え、元のファイルを消す一覧を返す', async () => {
    const fs = new MemoryProjectFs({
      'sheetcraft.yaml': CONFIG_YAML,
      'config/colors.yaml': 'colors:\n  - key: red\n    color: "#ff0000"\n',
      'tables/a.yml': 'table: a\nfields: []\nrecords:\n  - id: 1\n',
    });
    const plan = planProjectWrite(ok(await loadProject(fs)), { format: 'json' });
    expect(plan.files.map((f) => [f.path, f.changed])).toEqual([
      ['sheetcraft.yaml', true],
      ['config/colors.json', true],
      ['tables/a.json', true],
    ]);
    expect(plan.files[0].text).toBe('format_version: 1\nstorage:\n  format: json\n');
    expect(plan.files[1].text).toBe('{\n  "colors": [\n    { "key": "red", "color": "#ff0000" }\n  ]\n}\n');
    expect(plan.remove).toEqual(['config/colors.yaml', 'tables/a.yml']);
  });

  it('JSON の設定ファイル', async () => {
    const config = '{\n  "format_version": 1,\n  "storage": {\n    "format": "json"\n  },\n  "paths": {}\n}\n';
    const project = ok(await loadProject(new MemoryProjectFs({ 'sheetcraft.json': config })));
    expect(project.config).toMatchObject({ format_version: 1, storage: { format: 'json' }, paths: {} });
    expect(planProjectWrite(project).files).toEqual([{ path: 'sheetcraft.json', text: config, changed: false }]);
  });
});
