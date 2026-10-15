/**
 * 内部用の不変の番号を配る（テーブル・レコードで共用し、プロジェクト全体で一意）。
 * 読み込みでは読んだ順に採番し、編集で追加したものには続きの番号を配る
 */
export class UidAllocator {
  private nextUid: number;

  constructor(start = 1) {
    this.nextUid = start;
  }

  next(): number {
    return this.nextUid++;
  }

  /** 次に配る番号（配らずに見るだけ） */
  peek(): number {
    return this.nextUid;
  }
}
