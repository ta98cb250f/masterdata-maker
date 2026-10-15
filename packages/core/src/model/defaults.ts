import type { ColorDef, EnumDef } from './common';
import type { FieldDef } from './field';

// P-02: 共通設定のファイルが無いときの既定値。画面の文言ではなく、ファイルに書かれるデータの既定値

/** DR-21: 既定の共通列 */
export function defaultBaseFields(): FieldDef[] {
  return [
    { name: 'id', type: 'int', display_name: 'ID', editable: false, primary: true, auto: 'increment' },
    { name: 'version', type: 'string', display_name: 'バージョン' },
  ];
}

/** DR-22: 既定のセル色（Googleスプレッドシートの淡い 8 色） */
export function defaultColors(): ColorDef[] {
  return [
    { key: 'red', color: '#f4cccc', label: '赤' },
    { key: 'orange', color: '#fce5cd', label: 'オレンジ' },
    { key: 'yellow', color: '#fff2cc', label: '黄' },
    { key: 'green', color: '#d9ead3', label: '緑' },
    { key: 'cyan', color: '#d0e0e3', label: 'シアン' },
    { key: 'blue', color: '#cfe2f3', label: '青' },
    { key: 'purple', color: '#d9d2e9', label: '紫' },
    { key: 'magenta', color: '#ead1dc', label: 'マゼンタ' },
  ];
}

export function defaultEnums(): EnumDef[] {
  return [];
}
