// 構文木。start / end は式のテキスト（先頭の `=` を除いた部分）の中の位置（0 始まり。end は含まない）

export type BinaryOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=';
export type UnaryOp = '-' | '+';

interface NodeBase {
  start: number;
  end: number;
}

export interface NumberNode extends NodeBase {
  type: 'number';
  value: number;
}

export interface StringNode extends NodeBase {
  type: 'string';
  value: string;
}

export interface BooleanNode extends NodeBase {
  type: 'boolean';
  value: boolean;
}

/** 同じレコードの列の参照。name は小文字にした列名（P-30） */
export interface ColumnNode extends NodeBase {
  type: 'column';
  name: string;
}

/** 関数呼び出し。name は大文字にした関数名 */
export interface CallNode extends NodeBase {
  type: 'call';
  name: string;
  nameStart: number;
  nameEnd: number;
  args: Node[];
}

export interface UnaryNode extends NodeBase {
  type: 'unary';
  op: UnaryOp;
  operand: Node;
}

/** 後置の % */
export interface PercentNode extends NodeBase {
  type: 'percent';
  operand: Node;
}

export interface BinaryNode extends NodeBase {
  type: 'binary';
  op: BinaryOp;
  left: Node;
  right: Node;
}

/** 括弧 */
export interface GroupNode extends NodeBase {
  type: 'group';
  expr: Node;
}

/** 省略された引数（例: `IF(x, , 1)` の 2 番目） */
export interface BlankNode extends NodeBase {
  type: 'blank';
}

export type Node =
  | NumberNode
  | StringNode
  | BooleanNode
  | ColumnNode
  | CallNode
  | UnaryNode
  | PercentNode
  | BinaryNode
  | GroupNode
  | BlankNode;

/** 括弧を外したノード */
export function unwrapGroup(node: Node): Node {
  let n = node;
  while (n.type === 'group') n = n.expr;
  return n;
}

/** 構文木のノードを深さ優先でたどる */
export function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  switch (node.type) {
    case 'call':
      for (const a of node.args) walk(a, visit);
      break;
    case 'unary':
    case 'percent':
      walk(node.operand, visit);
      break;
    case 'binary':
      walk(node.left, visit);
      walk(node.right, visit);
      break;
    case 'group':
      walk(node.expr, visit);
      break;
    default:
      break;
  }
}
