// 出力の診断コード。文言は i18n/locales/<locale>/export.json に置く
export const ExportCode = {
  unknownTable: 'export.unknownTable',
} as const;

export type ExportCodeValue = (typeof ExportCode)[keyof typeof ExportCode];
