import { isAlias, isMap, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';
import { IoCode } from './codes';
import type { ParseResult, SrcEntry, SrcNode, SrcPos } from './tree';
import { Reporter } from './tree';

// YAML 1.2 として読み、構文木（tree.ts）にする。
// 複数ドキュメント・アンカー・エイリアス・タグ（DR-43）、1.2 以外の %YAML 指示は読み込みエラー

type YamlNode = ReturnType<typeof parseDocument>['contents'];

export function parseYaml(text: string, reporter: Reporter = new Reporter()): ParseResult {
  const before = reporter.items.length;
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, {
    intAsBigInt: true,
    lineCounter,
    prettyErrors: false,
    uniqueKeys: true,
    version: '1.2',
  });
  const posAt = (offset: number): SrcPos => {
    const lp = lineCounter.linePos(offset);
    return { line: lp.line, column: lp.col };
  };

  for (const error of doc.errors) {
    const at = posAt(error.pos[0]);
    if (error.code === 'MULTIPLE_DOCS') {
      reporter.error(IoCode.yamlMultipleDocuments, at);
    } else if (error.code === 'DUPLICATE_KEY') {
      reporter.error(IoCode.duplicateKey, at, { key: text.slice(error.pos[0], error.pos[1]) });
    } else {
      reporter.error(IoCode.yamlSyntaxError, at, { reason: error.code });
    }
  }
  if (doc.errors.length > 0) return { node: null, diagnostics: reporter.items };

  // %YAML 1.1 などの指示があると値の解釈が変わる（DR-40）
  const yamlDirective = doc.directives?.yaml;
  if (yamlDirective !== undefined && yamlDirective.explicit === true && yamlDirective.version !== '1.2') {
    reporter.error(IoCode.yamlVersionNotSupported, { line: 1, column: 1 }, { version: yamlDirective.version });
    return { node: null, diagnostics: reporter.items };
  }

  for (const warning of doc.warnings) {
    // タグは下の変換で読み込みエラーにする
    if (warning.code === 'TAG_RESOLVE_FAILED') continue;
    reporter.warn(IoCode.yamlParserWarning, posAt(warning.pos[0]), { reason: warning.code });
  }

  const convert = (node: YamlNode, fallbackOffset: number): SrcNode => {
    if (node === null || node === undefined) {
      return { kind: 'scalar', value: null, source: '', implicit: true, pos: posAt(fallbackOffset) };
    }
    const offset = node.range?.[0] ?? fallbackOffset;
    const pos = posAt(offset);
    if (isAlias(node)) {
      reporter.error(IoCode.yamlAliasNotAllowed, pos, { alias: node.source });
      return { kind: 'scalar', value: null, source: '', implicit: true, pos };
    }
    if (node.anchor !== undefined && node.anchor !== null && node.anchor !== '') {
      reporter.error(IoCode.yamlAnchorNotAllowed, pos, { anchor: node.anchor });
    }
    if (node.tag !== undefined && node.tag !== null && node.tag !== '') {
      reporter.error(IoCode.yamlTagNotAllowed, pos, { tag: node.tag });
    }
    if (isScalar(node)) {
      const value = node.value;
      const plain = node.type === 'PLAIN' || node.type === undefined;
      const source = typeof node.source === 'string' ? node.source : String(value);
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'bigint' ||
        typeof value === 'boolean'
      ) {
        return { kind: 'scalar', value, source, implicit: plain, pos };
      }
      reporter.error(IoCode.yamlUnsupportedValue, pos);
      return { kind: 'scalar', value: null, source, implicit: plain, pos };
    }
    if (isSeq(node)) {
      const items = node.items.map((item) => convert(item as YamlNode, offset));
      return { kind: 'seq', items, pos };
    }
    if (isMap(node)) {
      const entries: SrcEntry[] = [];
      const seen = new Set<string>();
      for (const pair of node.items) {
        const keyNode = pair.key as YamlNode;
        const keyOffset = keyNode?.range?.[0] ?? offset;
        const keyPos = posAt(keyOffset);
        let key: string;
        if (keyNode === null || keyNode === undefined) {
          key = '';
        } else if (isScalar(keyNode)) {
          // 文字列以外のキー（例: `1:`、`true:`）は元の表記を名前にする
          key = typeof keyNode.value === 'string' ? keyNode.value : (keyNode.source ?? String(keyNode.value));
          if (keyNode.anchor) reporter.error(IoCode.yamlAnchorNotAllowed, keyPos, { anchor: keyNode.anchor });
          if (keyNode.tag) reporter.error(IoCode.yamlTagNotAllowed, keyPos, { tag: keyNode.tag });
        } else if (isAlias(keyNode)) {
          reporter.error(IoCode.yamlAliasNotAllowed, keyPos, { alias: keyNode.source });
          continue;
        } else {
          reporter.error(IoCode.yamlComplexKey, keyPos);
          continue;
        }
        const value = convert(pair.value as YamlNode, keyNode?.range?.[1] ?? keyOffset);
        if (seen.has(key)) {
          reporter.error(IoCode.duplicateKey, keyPos, { key });
          continue;
        }
        seen.add(key);
        entries.push({ key, keyPos, value });
      }
      return { kind: 'map', entries, pos };
    }
    reporter.error(IoCode.yamlUnsupportedValue, pos);
    return { kind: 'scalar', value: null, source: '', implicit: true, pos };
  };

  const root = convert(doc.contents, 0);
  const failed = reporter.items.slice(before).some((d) => d.severity === 'error');
  return { node: failed ? null : root, diagnostics: reporter.items };
}
