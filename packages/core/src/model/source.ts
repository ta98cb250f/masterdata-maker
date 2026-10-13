// リソースファイルの形式と、読み込み元のファイルの情報
export type StorageFormat = 'yaml' | 'json';

export const STORAGE_FORMATS: readonly StorageFormat[] = ['yaml', 'json'];

export interface SourceFile {
  /** プロジェクトのルートからの相対パス（区切りは `/`） */
  path: string;
  /** 拡張子から決めた形式 */
  format: StorageFormat;
  /** 読み込んだときのテキスト（BOM や CRLF もそのまま） */
  text: string;
}

/** 拡張子から形式を決める。対象外の拡張子なら null */
export function formatFromPath(path: string): StorageFormat | null {
  if (/\.ya?ml$/.test(path)) return 'yaml';
  if (/\.json$/.test(path)) return 'json';
  return null;
}

/** 形式の標準の拡張子（`.` を含まない） */
export function extensionOf(format: StorageFormat): string {
  return format === 'yaml' ? 'yaml' : 'json';
}
