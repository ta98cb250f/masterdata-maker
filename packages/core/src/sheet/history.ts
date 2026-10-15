// 元に戻す履歴（FR-HIS-01〜04、P-44）。履歴の項目の中身（パッチなど）は呼び出し側が決める

/** 履歴の件数の既定の上限（P-44） */
export const DEFAULT_HISTORY_LIMIT = 200;

export class UndoHistory<T> {
  readonly limit: number;
  private undoStack: T[] = [];
  private redoStack: T[] = [];

  constructor(limit: number = DEFAULT_HISTORY_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`limit must be a positive integer: ${limit}`);
    this.limit = limit;
  }

  /** 項目を追加する。やり直しの履歴は消す。上限を超えたら古いものから捨てる */
  push(entry: T): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
    this.redoStack = [];
  }

  /** 元に戻す項目を取り出し、やり直しの履歴へ移す。無ければ undefined */
  undo(): T | undefined {
    if (this.undoStack.length === 0) return undefined;
    const entry = this.undoStack.pop() as T;
    this.redoStack.push(entry);
    return entry;
  }

  /** やり直す項目を取り出し、元に戻す履歴へ移す。無ければ undefined */
  redo(): T | undefined {
    if (this.redoStack.length === 0) return undefined;
    const entry = this.redoStack.pop() as T;
    this.undoStack.push(entry);
    return entry;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 次に元に戻す項目（取り出さない） */
  peekUndo(): T | undefined {
    return this.undoStack[this.undoStack.length - 1];
  }

  /** 次にやり直す項目（取り出さない） */
  peekRedo(): T | undefined {
    return this.redoStack[this.redoStack.length - 1];
  }

  get undoCount(): number {
    return this.undoStack.length;
  }

  get redoCount(): number {
    return this.redoStack.length;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** 元に戻す・やり直しの履歴の項目のどれかが条件に合うか */
  some(predicate: (entry: T) => boolean): boolean {
    return this.undoStack.some(predicate) || this.redoStack.some(predicate);
  }
}
