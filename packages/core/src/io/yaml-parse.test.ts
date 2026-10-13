import { describe, expect, it } from 'vitest';
import { IoCode } from './codes';
import { parseTableFile } from './parse';
import { parseYaml } from './yaml-parse';

function errors(text: string) {
  const result = parseYaml(text);
  expect(result.node).toBeNull();
  return result.diagnostics.filter((d) => d.severity === 'error');
}

describe('DR-43: アンカー・エイリアス・タグは読み込みエラー', () => {
  it('アンカーとエイリアス', () => {
    expect(errors('a: &x 1\nb: *x\n')).toMatchObject([
      { code: IoCode.yamlAnchorNotAllowed, params: { anchor: 'x' }, line: 1, column: 7 },
      { code: IoCode.yamlAliasNotAllowed, params: { alias: 'x' }, line: 2, column: 4 },
    ]);
  });

  it('コレクションのアンカーとマージキー', () => {
    expect(errors('base: &b { hp: 1 }\nchild:\n  <<: *b\n').map((d) => d.code)).toEqual([
      IoCode.yamlAnchorNotAllowed,
      IoCode.yamlAliasNotAllowed,
    ]);
  });

  it('独自のタグも標準のタグも拒否する', () => {
    expect(errors('a: !custom 3\n')).toMatchObject([{ code: IoCode.yamlTagNotAllowed, params: { tag: '!custom' } }]);
    expect(errors('a: !!str 3\n')).toMatchObject([
      { code: IoCode.yamlTagNotAllowed, params: { tag: 'tag:yaml.org,2002:str' } },
    ]);
    expect(errors('a: !!set { x }\n').map((d) => d.code)).toEqual([IoCode.yamlTagNotAllowed]);
  });

  it('テーブルファイルでは読み込みエラーのテーブル（P-40）になる', () => {
    const table = parseTableFile(
      'tables/t.yaml',
      'table: t\nfields:\n  - &f\n    name: a\n    type: int\nrecords:\n  - id: 1\n    a: !int 3\n',
    );
    expect(table.kind).toBe('broken');
    expect(table.diagnostics.map((d) => d.code)).toEqual([IoCode.yamlAnchorNotAllowed, IoCode.yamlTagNotAllowed]);
  });
});

describe('YAML の構文と構造のエラー', () => {
  it('構文エラーには行と列を付ける', () => {
    expect(errors('a: [1, 2\nb: 3\n')[0]).toMatchObject({ code: IoCode.yamlSyntaxError, line: 2 });
  });

  it('複数のドキュメント', () => {
    expect(errors('a: 1\n---\na: 2\n')).toMatchObject([{ code: IoCode.yamlMultipleDocuments, line: 2 }]);
  });

  it('重複キー（文字列にしたときに同じになるキーも）', () => {
    expect(errors('a: 1\na: 2\n')).toMatchObject([{ code: IoCode.duplicateKey, params: { key: 'a' }, line: 2 }]);
    expect(errors('1: a\n"1": b\n')).toMatchObject([{ code: IoCode.duplicateKey, params: { key: '1' } }]);
  });

  it('%YAML 1.1 の指示は値の解釈が変わるので拒否する。%YAML 1.2 はよい', () => {
    expect(errors('%YAML 1.1\n---\na: NO\n')).toMatchObject([
      { code: IoCode.yamlVersionNotSupported, params: { version: '1.1' } },
    ]);
    const ok = parseYaml('%YAML 1.2\n---\na: NO\n');
    expect(ok.node?.kind).toBe('map');
  });

  it('マッピングをキーにはできない', () => {
    expect(errors('? [a]\n: 1\n')).toMatchObject([{ code: IoCode.yamlComplexKey }]);
  });

  it('引用符なしのスカラーは implicit。キーは元の表記を名前にする', () => {
    const result = parseYaml('1.10: x\ntrue: "y"\nn: |\n  z\n');
    const root = result.node;
    expect(root?.kind).toBe('map');
    if (root?.kind !== 'map') return;
    expect(root.entries.map((e) => e.key)).toEqual(['1.10', 'true', 'n']);
    expect(root.entries.map((e) => e.value.kind === 'scalar' && e.value.implicit)).toEqual([true, false, false]);
  });
});
