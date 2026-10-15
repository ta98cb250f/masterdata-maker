// 式の中の名前の書き換え（FR-COL-03、FR-TBL-02）。
// トークンの位置を使って書き換え、それ以外のテキスト（空白など）はそのまま保つ。
// 先頭の `=` があれば残す。字句解析・構文解析できない式は書き換えない

import { walk } from './ast';
import { stripFormulaPrefix, tokenize } from './lexer';
import { parseFormula } from './parser';
import type { StringNode } from './ast';

interface Edit {
  start: number;
  end: number;
  text: string;
}

function applyEdits(prefix: string, source: string, edits: Edit[]): string {
  let out = source;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return prefix + out;
}

function quote(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/** 同じテーブルの列名の変更。関数名・TRUE / FALSE・文字列の中の語は変えない（列名は大文字と小文字を区別しない） */
export function renameColumnInFormula(formula: string, oldName: string, newName: string): string {
  const { source, offset } = stripFormulaPrefix(formula);
  const lex = tokenize(source);
  if (!lex.ok) return formula;
  const target = oldName.toLowerCase();
  const edits: Edit[] = [];
  const tokens = lex.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || tokens[i + 1]?.type === 'lparen') continue;
    const lower = t.text.toLowerCase();
    if (lower === 'true' || lower === 'false' || lower !== target) continue;
    edits.push({ start: t.start, end: t.end, text: newName });
  }
  return edits.length === 0 ? formula : applyEdits(formula.slice(0, offset), source, edits);
}

/** REF の呼び出しで、第 1・第 3 引数が文字列リテラルのものをたどる */
function forEachRefLiteral(
  formula: string,
  visit: (table: StringNode, column: StringNode, edits: Edit[]) => void,
): string {
  const { offset } = stripFormulaPrefix(formula);
  const parsed = parseFormula(formula);
  if (!parsed.ok) return formula;
  const edits: Edit[] = [];
  walk(parsed.ast, (n) => {
    if (n.type !== 'call' || n.name !== 'REF' || n.args.length !== 3) return;
    const [t, , c] = n.args;
    if (t.type === 'string' && c.type === 'string') visit(t, c, edits);
  });
  return edits.length === 0 ? formula : applyEdits(formula.slice(0, offset), parsed.source, edits);
}

/** `REF("table", …, "col")` の列名の変更。第 1 引数が指定のテーブルのものだけ */
export function renameRefColumnInFormula(
  formula: string,
  table: string,
  oldColumn: string,
  newColumn: string,
): string {
  const target = oldColumn.toLowerCase();
  return forEachRefLiteral(formula, (t, c, edits) => {
    if (t.value === table && c.value.toLowerCase() === target) {
      edits.push({ start: c.start, end: c.end, text: quote(newColumn) });
    }
  });
}

/** REF のテーブル名の変更 */
export function renameRefTableInFormula(formula: string, oldTable: string, newTable: string): string {
  return forEachRefLiteral(formula, (t, _c, edits) => {
    if (t.value === oldTable) edits.push({ start: t.start, end: t.end, text: quote(newTable) });
  });
}
