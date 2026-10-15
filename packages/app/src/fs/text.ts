// ファイルの中身をテキストにする。BOM は取り除かずに残す（core の SourceFile.text は読み込んだままのテキスト）
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

export async function blobText(blob: { arrayBuffer(): Promise<ArrayBuffer> }): Promise<string> {
  return decoder.decode(await blob.arrayBuffer());
}

/** パスの最後の要素（ファイル名） */
export function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

/** パスの親のフォルダ（ルートなら空文字） */
export function dirName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message === '' ? e.name : `${e.name}: ${e.message}`;
  return String(e);
}
