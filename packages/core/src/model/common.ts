import type { FieldDef } from './field';
import type { SourceFile } from './source';

/** 列挙型（DR-20） */
export interface EnumDef {
  name: string;
  display_name?: string;
  values: string[];
}

/** セル色のプリセット（DR-22） */
export interface ColorDef {
  key: string;
  color: string;
  label?: string;
}

export type CommonPartName = 'enums' | 'base_fields' | 'colors';

export const COMMON_PART_NAMES: readonly CommonPartName[] = ['enums', 'base_fields', 'colors'];

/** 共通設定の 1 ファイル分（P-02） */
export interface CommonPart<T> {
  items: T[];
  /** 読み込み元。ファイルが無かったときは null */
  source: SourceFile | null;
  /**
   * 既定値か（ファイルが無かった）。既定値のままなら保存してもファイルを作らない。
   * 画面で編集したら false にする
   */
  isDefault: boolean;
}

export interface CommonConfig {
  enums: CommonPart<EnumDef>;
  base_fields: CommonPart<FieldDef>;
  colors: CommonPart<ColorDef>;
}
