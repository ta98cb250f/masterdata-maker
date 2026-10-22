// 出力の診断コード。文言は i18n/locales/<locale>/export.json に置く
export const ExportCode = {
  unknownTable: 'export.unknownTable',
  protoMessageConflict: 'export.protoMessageConflict',
  protoFieldConflict: 'export.protoFieldConflict',
  protoInvalidName: 'export.protoInvalidName',
  protoInvalidFieldNumber: 'export.protoInvalidFieldNumber',
  protoFieldNumberConflict: 'export.protoFieldNumberConflict',
  invalidVersion: 'export.invalidVersion',
  invalidRecordVersion: 'export.invalidRecordVersion',
} as const;

export type ExportCodeValue = (typeof ExportCode)[keyof typeof ExportCode];
