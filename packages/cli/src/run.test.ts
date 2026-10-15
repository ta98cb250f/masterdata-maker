import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { run } from './run';

const SAMPLES = fileURLToPath(new URL('../../../samples/', import.meta.url));

const temps: string[] = [];

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sheetcraft-cli-'));
  temps.push(dir);
  return dir;
}

/** サンプルを一時フォルダに複製する */
async function copySample(name: string): Promise<string> {
  const dir = join(await tempDir(), name);
  await cp(join(SAMPLES, name), dir, { recursive: true });
  return dir;
}

/** フォルダの下のファイル（相対パス → 内容） */
async function readTree(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.set(relative(root, path).split(sep).join('/'), await readFile(path, 'utf8'));
    }
  };
  await walk(root);
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

async function cli(args: string[], cwd: string): Promise<Result> {
  let stdout = '';
  let stderr = '';
  const code = await run(args, {
    cwd,
    stdout: { write: (s: string) => (stdout += s) },
    stderr: { write: (s: string) => (stderr += s) },
  });
  return { code, stdout, stderr };
}

async function editFile(path: string, edit: (text: string) => string): Promise<void> {
  await writeFile(path, edit(await readFile(path, 'utf8')), 'utf8');
}

describe('validate（FR-CLI-01）', () => {
  it('サンプルは問題なし（終了コード 0）。プロジェクトのフォルダの既定はカレントディレクトリ', async () => {
    const dir = await copySample('basic-yaml');
    expect(await cli(['validate'], dir)).toEqual({ code: 0, stdout: '問題はありません\n', stderr: '' });
    expect(await cli(['validate', 'basic-yaml', '--lang', 'en'], join(dir, '..'))).toEqual({
      code: 0,
      stdout: 'No problems found\n',
      stderr: '',
    });
  });

  it('エラーがあれば終了コード 1。「重大度 ファイル テーブル 主キー 列: メッセージ」の形で出す', async () => {
    const dir = await copySample('basic-yaml');
    await editFile(join(dir, 'tables/character.yaml'), (t) => t.replace('hp: 650', 'hp: 100000').replace('boss_id: 3', ''));
    await editFile(join(dir, 'tables/stage.yaml'), (t) => t.replace('boss_id: 3', 'boss_id: 9'));
    const result = await cli(['validate'], dir);
    expect(result).toEqual({
      code: 1,
      stdout: [
        'エラー tables/character.yaml character 3 hp: 値 100000 が最大値 99999 を超えています',
        '警告 tables/character.yaml character 3 hp: 値 100000 が警告の上限 5000 を超えています',
        'エラー tables/stage.yaml stage 1 boss_id: 参照先 character.id に値 9 がありません',
        'エラー 2 件、警告 1 件',
        '',
      ].join('\n'),
      stderr: '',
    });
    const en = await cli(['validate', '--lang=en'], dir);
    expect(en.stdout.split('\n')[0]).toBe('error tables/character.yaml character 3 hp: The value 100000 is greater than the maximum 99999');
  });

  it('警告だけなら終了コード 0。読み込み時の警告には行と桁を付ける', async () => {
    const dir = await copySample('basic-yaml');
    await editFile(join(dir, 'tables/character.yaml'), (t) => t.replace('    hp: 650\n', '    hp: 6000\n    extra: 1\n'));
    const result = await cli(['validate'], dir);
    expect(result.code).toBe(0);
    expect(result.stdout.split('\n')).toEqual([
      '警告 tables/character.yaml:79:5 character 3 -: レコードに列定義に無いキー extra があります。値はそのまま残します',
      '警告 tables/character.yaml character 3 hp: 値 6000 が警告の上限 5000 を超えています',
      'エラー 0 件、警告 2 件',
      '',
    ]);
  });
});

describe('使い方の誤りと読み込みの失敗（終了コード 2）', () => {
  it('コマンドが無い・知らないコマンド・使えないオプション・引数が多い・言語の誤り', async () => {
    const dir = await copySample('basic-yaml');
    for (const args of [[], ['nothing'], ['validate', '--force'], ['validate', '--bogus'], ['validate', 'a', 'b'], ['validate', '--lang', 'fr']]) {
      const result = await cli(args, dir);
      expect(result.code, args.join(' ')).toBe(2);
      expect(result.stdout, args.join(' ')).toBe('');
      expect(result.stderr, args.join(' ')).toContain('使い方: sheetcraft');
    }
    expect((await cli(['nothing'], dir)).stderr.split('\n')[0]).toBe('コマンド nothing はありません');
    expect((await cli(['validate', '--force'], dir)).stderr.split('\n')[0]).toBe('validate では --force を使えません');
    const help = await cli(['--help', '--lang', 'en'], dir);
    expect(help.code).toBe(0);
    expect(help.stdout.startsWith('Usage: sheetcraft <command>')).toBe(true);
  });

  it('プロジェクトのフォルダでない・設定ファイルが読めない', async () => {
    const empty = await tempDir();
    expect(await cli(['validate'], empty)).toEqual({
      code: 2,
      stdout: '',
      stderr: '. はプロジェクトのフォルダではありません（sheetcraft.yaml か sheetcraft.json がありません）\n',
    });
    await writeFile(join(empty, 'sheetcraft.yaml'), 'format_version: 1\n');
    const result = await cli(['validate'], empty);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe('エラー sheetcraft.yaml:1:1 - - -: storage がありません\nプロジェクトを読み込めませんでした\n');
  });
});

describe('export（FR-CLI-02）', () => {
  it('出力ファイルを out_dir に書く', async () => {
    const dir = await copySample('basic-json');
    const result = await cli(['export'], dir);
    expect(result).toEqual({
      code: 0,
      stdout: '出力しました: build/character.json\n出力しました: build/skill.json\n出力しました: build/stage.json\n',
      stderr: '',
    });
    const files = await readTree(join(dir, 'build'));
    expect([...files.keys()]).toEqual(['character.json', 'skill.json', 'stage.json']);
    expect(JSON.parse(files.get('stage.json') ?? '')).toEqual([
      { id: 1, version: '0.1.2', name: 'stage_01', boss_id: 3 },
      { id: 2, version: '0.1.11', name: 'stage_02', boss_id: 2 },
    ]);
    expect(files.get('character.json')).toContain('    "effective_hp": 1560,\n');
  });

  it('--tables と --out（カレントディレクトリからの相対パス）', async () => {
    const dir = await copySample('basic-yaml');
    const parent = join(dir, '..');
    const result = await cli(['export', 'basic-yaml', '--tables', 'skill, stage', '--out', 'out'], parent);
    expect(result).toEqual({ code: 0, stdout: '出力しました: out/skill.json\n出力しました: out/stage.json\n', stderr: '' });
    expect([...(await readTree(join(parent, 'out'))).keys()]).toEqual(['skill.json', 'stage.json']);
    const unknown = await cli(['export', '--tables', 'nothing'], dir);
    expect(unknown).toEqual({ code: 2, stdout: '', stderr: 'テーブル nothing はありません\n' });
  });

  it('検査エラーがあれば書かずに終了コード 1。--force なら書く', async () => {
    const dir = await copySample('basic-yaml');
    await editFile(join(dir, 'tables/skill.yaml'), (t) => t.replace('cost: 8', 'cost: -1'));
    const blocked = await cli(['export'], dir);
    expect(blocked).toEqual({
      code: 1,
      stdout: 'エラー tables/skill.yaml skill 2 cost: 値 -1 が最小値 0 より小さいです\nエラー 1 件、警告 0 件\n',
      stderr: '検査エラーがあるため出力しませんでした（--force を付けると出力します）\n',
    });
    expect((await readdir(dir)).includes('build')).toBe(false);
    const forced = await cli(['export', '--force'], dir);
    expect(forced.code).toBe(0);
    expect(forced.stdout).toContain('出力しました: build/skill.json\n');
    expect(await readFile(join(dir, 'build/skill.json'), 'utf8')).toContain('"cost": -1');
  });

  it('--force で出力するとき、列の型に合わない値は null。検査ルールの違反の値はそのまま（P-51）', async () => {
    const dir = await copySample('basic-yaml');
    await editFile(join(dir, 'tables/skill.yaml'), (t) =>
      t.replace('cost: 8', 'cost: abc').replace('element: 光', 'element: 氷').replace('cost: 12', 'cost: -1'),
    );
    const forced = await cli(['export', '--force', '--tables', 'skill'], dir);
    expect(forced).toEqual({
      code: 0,
      stdout:
        'エラー tables/skill.yaml skill 2 cost: int の列に string の値「abc」があります\n' +
        'エラー tables/skill.yaml skill 2 element: 「氷」は列挙型 element の値にありません\n' +
        'エラー tables/skill.yaml skill 3 cost: 値 -1 が最小値 0 より小さいです\n' +
        'エラー 3 件、警告 0 件\n' +
        '出力しました: build/skill.json\n',
      stderr: '',
    });
    expect(JSON.parse(await readFile(join(dir, 'build/skill.json'), 'utf8'))).toEqual([
      { id: 1, version: null, name: 'ファイア', cost: 10, element: '火' },
      { id: 2, version: null, name: 'ヒール', cost: null, element: null },
      { id: 3, version: null, name: 'ウィンド', cost: -1, element: '風' },
    ]);
  });

  it('--format で形式を選ぶ（既定は output.format）。protobuf は .proto と .pb。知らない形式は終了コード 2', async () => {
    const dir = await copySample('basic-yaml');
    const csv = await cli(['export', '--format', 'csv', '--tables', 'stage'], dir);
    expect(csv).toEqual({ code: 0, stdout: '出力しました: build/stage.csv\n', stderr: '' });
    expect(await readFile(join(dir, 'build/stage.csv'), 'utf8')).toBe('id,version,name,boss_id\n1,0.1.2,stage_01,3\n2,0.1.11,stage_02,2\n');
    const pb = await cli(['export', '--format', 'protobuf', '--tables', 'stage'], dir);
    expect(pb).toEqual({ code: 0, stdout: '出力しました: build/stage.proto\n出力しました: build/stage.pb\n', stderr: '' });
    expect(await readFile(join(dir, 'build/stage.proto'), 'utf8')).toContain('message StageTable {\n  repeated Stage records = 1;\n}\n');
    // 1 レコード目: id = 1、version = "0.1.2"、name = "stage_01"、boss_id = 3
    expect([...(await readFile(join(dir, 'build/stage.pb'))).subarray(0, 23)]).toEqual([
      0x0a, 21, 0x08, 1, 0x12, 5, ...Buffer.from('0.1.2'), 0x1a, 8, ...Buffer.from('stage_01'), 0x20, 3,
    ]);
    await editFile(join(dir, 'sheetcraft.yaml'), (t) => t.replace('format: json', 'format: csv'));
    expect((await cli(['export', '--tables', 'skill'], dir)).stdout).toBe('出力しました: build/skill.csv\n');
    const bad = await cli(['export', '--format', 'xml'], dir);
    expect(bad).toEqual({ code: 2, stdout: '', stderr: '--format には json・yaml・csv・protobuf のいずれかを指定してください（xml が指定されました）\n' });
  });

  it('--until を付けると version がその版以下のレコードだけを出す。版の書式の誤りは終了コード 2（FR-OUT-07）', async () => {
    const dir = await copySample('basic-yaml');
    const result = await cli(['export', '--format', 'csv', '--tables', 'stage', '--until', '0.1.10'], dir);
    expect(result).toEqual({ code: 0, stdout: '出力しました: build/stage.csv\n', stderr: '' });
    expect(await readFile(join(dir, 'build/stage.csv'), 'utf8')).toBe('id,version,name,boss_id\n1,0.1.2,stage_01,3\n');
    // version が空のレコード（character の 1 と 2）は常に出す
    await cli(['export', '--tables', 'character', '--until', '0.1.1'], dir);
    const ids = (JSON.parse(await readFile(join(dir, 'build/character.json'), 'utf8')) as { id: number }[]).map((r) => r.id);
    expect(ids).toEqual([1, 2]);
    const bad = await cli(['export', '--until', '0.1'], dir);
    expect(bad).toEqual({
      code: 2,
      stdout: '',
      stderr: '--until にはセマンティック バージョニングの版（例: 1.2.3）を指定してください（0.1 が指定されました）\n',
    });
    const en = await cli(['export', '--until', '0.1', '--lang', 'en'], dir);
    expect(en).toEqual({ code: 2, stdout: '', stderr: '--until must be a semantic version such as 1.2.3 (0.1 was given)\n' });
  });

  it('protobuf でメッセージ名が重なれば、--force でも書かずに 1（P-63）', async () => {
    const dir = await copySample('basic-yaml');
    await writeFile(join(dir, 'tables/stage_table.yaml'), 'table: stage_table\nfields: []\nrecords: []\n');
    const result = await cli(['export', '--format', 'protobuf', '--force'], dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('StageTable');
    expect(result.stderr).toBe('Protocol Buffers で出力できない名前があるため出力しませんでした（--force でも出力できません）\n');
    expect(await readdir(dir)).not.toContain('build');
  });
});

describe('new（FR-CLI-03）', () => {
  it('テーブルの雛形を storage.format で作る。既にあれば失敗', async () => {
    const dir = await copySample('basic-yaml');
    const created = await cli(['new', 'enemy', '--display-name', '敵'], dir);
    expect(created).toEqual({ code: 0, stdout: '作りました: tables/enemy.yaml\n', stderr: '' });
    expect(await readFile(join(dir, 'tables/enemy.yaml'), 'utf8')).toBe('table: enemy\ndisplay_name: 敵\nfields: []\nrecords: []\n');
    // 作ったテーブルは読み込めて、検査も通る
    expect((await cli(['validate'], dir)).code).toBe(0);
    expect(await cli(['new', 'enemy'], dir)).toEqual({ code: 2, stdout: '', stderr: 'テーブル enemy は既にあります（tables/enemy.yaml）\n' });
    expect((await cli(['new', 'skill'], dir)).stderr).toBe('テーブル skill は既にあります（tables/skill.yaml）\n');
    expect((await cli(['new', 'Bad-Name'], dir)).code).toBe(2);
    expect((await cli(['new'], dir)).code).toBe(2);

    const json = await copySample('basic-json');
    expect((await cli(['new', 'enemy'], json)).stdout).toBe('作りました: tables/enemy.json\n');
    expect(await readFile(join(json, 'tables/enemy.json'), 'utf8')).toBe('{\n  "table": "enemy",\n  "fields": [],\n  "records": []\n}\n');
  });
});

describe('fmt（FR-CLI-04）', () => {
  for (const sample of ['basic-yaml', 'basic-json']) {
    it(`${sample}: 正規形のサンプルは変わらない（§5.17 の 7 番）`, async () => {
      const dir = await copySample(sample);
      const before = await readTree(dir);
      expect(await cli(['fmt', '--check'], dir)).toEqual({ code: 0, stdout: 'すべてのファイルが正規形です\n', stderr: '' });
      expect(await cli(['fmt'], dir)).toEqual({ code: 0, stdout: 'すべてのファイルが正規形です\n', stderr: '' });
      expect(await readTree(dir)).toEqual(before);
    });
  }

  it('正規形でないファイルを --check で一覧し（書かない）、fmt で書き直す', async () => {
    const dir = await copySample('basic-yaml');
    const original = await readTree(dir);
    const messy = (original.get('tables/skill.yaml') ?? '')
      .replace('  - id: 1\n    name: ファイア\n    cost: 10\n    element: 火\n', '  - { cost: 10, id: 1, element: "火", name: ファイア }\n')
      .replace(/\n/g, '\r\n');
    await writeFile(join(dir, 'tables/skill.yaml'), messy);
    await writeFile(join(dir, 'sheetcraft.yaml'), `# 設定\n${original.get('sheetcraft.yaml') ?? ''}`);
    expect(await cli(['fmt', '--check'], dir)).toEqual({
      code: 1,
      stdout: '正規形ではありません: sheetcraft.yaml\n正規形ではありません: tables/skill.yaml\n',
      stderr: '',
    });
    expect(await readFile(join(dir, 'tables/skill.yaml'), 'utf8')).toBe(messy);
    expect(await cli(['fmt'], dir)).toEqual({
      code: 0,
      stdout: '書き直しました: sheetcraft.yaml\n書き直しました: tables/skill.yaml\n',
      stderr: '',
    });
    expect(await readTree(dir)).toEqual(original);
    expect((await cli(['fmt', '--check'], dir)).code).toBe(0);
  });

  it('読み込みエラーのテーブルは書かない（P-40）', async () => {
    const dir = await copySample('basic-yaml');
    const broken = 'table: broken\nfields:\n  - { name: v, type: int, required: true }\nrecords: []\n';
    await writeFile(join(dir, 'tables/broken.yaml'), broken);
    const check = await cli(['fmt', '--check'], dir);
    expect(check.code).toBe(1);
    expect(check.stdout).toBe('');
    expect(check.stderr).toBe(
      'エラー tables/broken.yaml:3:27 broken - v: 列 v の定義に知らないキー required があります。validation.required の書き間違いではありませんか\n' +
        '読み込みエラーがあるため書き直しませんでした: tables/broken.yaml\n',
    );
    expect((await cli(['fmt'], dir)).code).toBe(1);
    expect(await readFile(join(dir, 'tables/broken.yaml'), 'utf8')).toBe(broken);
  });
});

describe('convert（FR-CLI-05）', () => {
  it('YAML → JSON → YAML と変換すると元のファイルと一致する', async () => {
    const dir = await copySample('basic-yaml');
    const original = await readTree(dir);
    const toJson = await cli(['convert', '--to', 'json'], dir);
    expect(toJson.code).toBe(0);
    expect(toJson.stdout.split('\n')).toEqual([
      '書き出しました: sheetcraft.yaml',
      '書き出しました: config/enums.json',
      '書き出しました: config/base_fields.json',
      '書き出しました: config/colors.json',
      '書き出しました: tables/character.json',
      '書き出しました: tables/skill.json',
      '書き出しました: tables/stage.json',
      '削除しました: config/enums.yaml',
      '削除しました: config/base_fields.yaml',
      '削除しました: config/colors.yaml',
      '削除しました: tables/character.yaml',
      '削除しました: tables/skill.yaml',
      '削除しました: tables/stage.yaml',
      'リソースファイルの形式を json にしました',
      '',
    ]);
    // 設定ファイル自身の形式は拡張子で決まる（P-01）。それ以外は basic-json と同じ
    const converted = await readTree(dir);
    const jsonSample = await readTree(join(SAMPLES, 'basic-json'));
    expect([...converted.keys()]).toEqual([...[...jsonSample.keys()].filter((p) => p !== 'sheetcraft.json'), 'sheetcraft.yaml'].sort());
    for (const [path, text] of converted) {
      if (path === 'sheetcraft.yaml') expect(text).toContain('storage:\n  format: json\n');
      else expect(text, path).toBe(jsonSample.get(path));
    }
    expect((await cli(['validate'], dir)).code).toBe(0);

    expect((await cli(['convert', '--to', 'yaml'], dir)).code).toBe(0);
    expect(await readTree(dir)).toEqual(original);
  });

  it('--to が無い・正しくない、読み込みエラーのテーブルがある', async () => {
    const dir = await copySample('basic-json');
    expect((await cli(['convert'], dir)).code).toBe(2);
    expect((await cli(['convert', '--to', 'xml'], dir)).stderr.split('\n')[0]).toBe('--to には yaml か json を指定してください（xml が指定されました）');
    await writeFile(join(dir, 'tables/broken.json'), '{ "table": "broken", }\n');
    const before = await readTree(dir);
    const result = await cli(['convert', '--to', 'yaml'], dir);
    expect(result.code).toBe(2);
    expect(result.stderr.split('\n').at(-2)).toBe('読み込みエラーのあるテーブルがあるため変換できません: tables/broken.json');
    expect(await readTree(dir)).toEqual(before);
  });
});
