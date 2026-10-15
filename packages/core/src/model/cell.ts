// セルの値。型に合わない値も捨てずに保持する（検査でエラーにし、保存では元の値のまま書き戻す）
export type RawValue = number | bigint | string | boolean | RawValue[];

/** 列定義に無いキーや RichCell の知らないキーの値。元の構造のまま保持して書き戻す */
export type ExtraValue = null | boolean | number | bigint | string | ExtraValue[] | ExtraMap;
export type ExtraMap = Map<string, ExtraValue>;

export interface RichCellInit {
  value?: RawValue;
  override?: string;
  color?: string;
  comment?: string;
  extra?: [string, ExtraValue][];
}

/** 値にセル色・メモ・セル単位式を付けたセル（DR-11） */
export class RichCell {
  // declare: 未指定のキーをプロパティとして作らない（ES2022 のクラスフィールドは undefined で作られるため）
  declare value?: RawValue;
  /** セル単位式。先頭の `=` は付けない（P-04） */
  declare override?: string;
  declare color?: string;
  declare comment?: string;
  /** 知らないキー（読み込みエラーになる）。元の順で保持する */
  declare extra?: [string, ExtraValue][];

  constructor(init: RichCellInit = {}) {
    // 未指定のプロパティは作らない（'value' in cell で有無を判別できるように）
    if (init.value !== undefined) this.value = init.value;
    if (init.override !== undefined) this.override = init.override;
    if (init.color !== undefined) this.color = init.color;
    if (init.comment !== undefined) this.comment = init.comment;
    if (init.extra !== undefined && init.extra.length > 0) this.extra = init.extra;
  }

  /** 値以外（セル色・メモ・セル単位式・知らないキー）を持つか */
  hasAnnotations(): boolean {
    return (
      this.override !== undefined ||
      this.color !== undefined ||
      this.comment !== undefined ||
      (this.extra !== undefined && this.extra.length > 0)
    );
  }

  isEmpty(): boolean {
    return this.value === undefined && !this.hasAnnotations();
  }
}

export type Cell = RawValue | RichCell;

export function isRichCell(cell: Cell | undefined): cell is RichCell {
  return cell instanceof RichCell;
}

/** セルに直接入っている値（式は計算しない）。未入力なら undefined */
export function cellValue(cell: Cell | undefined): RawValue | undefined {
  if (cell === undefined) return undefined;
  return cell instanceof RichCell ? cell.value : cell;
}

/** DR-15・P-11: 空文字と空のリストは未入力と同じ */
export function isEmptyValue(value: RawValue | undefined): boolean {
  return value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}
