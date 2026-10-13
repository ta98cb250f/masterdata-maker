import type { RawValue } from './cell';

// DR-13: フィールド型は 11 種
export const FIELD_TYPES = [
  'int',
  'int64',
  'float',
  'string',
  'bool',
  'enum',
  'datetime',
  'list<int>',
  'list<float>',
  'list<string>',
  'list<enum>',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];
export type ListFieldType = 'list<int>' | 'list<float>' | 'list<string>' | 'list<enum>';
export type ScalarFieldType = Exclude<FieldType, ListFieldType>;

export function isFieldType(value: string): value is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(value);
}

export function isListType(type: FieldType): type is ListFieldType {
  return type.startsWith('list<');
}

/** リスト型なら要素の型、それ以外はその型自身 */
export function elementType(type: FieldType): ScalarFieldType {
  switch (type) {
    case 'list<int>':
      return 'int';
    case 'list<float>':
      return 'float';
    case 'list<string>':
      return 'string';
    case 'list<enum>':
      return 'enum';
    default:
      return type;
  }
}

/** min / max の値。数値・BigInt（int64 列）・datetime の文字列のいずれか */
export type BoundValue = number | bigint | string;

export interface FieldValidation {
  required?: boolean;
  min?: BoundValue;
  max?: BoundValue;
  max_length?: number;
  max_items?: number;
  regex?: string;
  unique?: boolean;
}

export const VALIDATION_KEYS = ['required', 'min', 'max', 'max_length', 'max_items', 'regex', 'unique'] as const;
export type ValidationKey = (typeof VALIDATION_KEYS)[number];

export interface FieldAnomaly {
  warn_above?: number | bigint;
  warn_below?: number | bigint;
  warn_deviation?: number;
}

export const ANOMALY_KEYS = ['warn_above', 'warn_below', 'warn_deviation'] as const;
export type AnomalyKey = (typeof ANOMALY_KEYS)[number];

export type AutoKind = 'increment';

/**
 * 列定義（DR-14）。省略可能なキーは、ファイルに書かれていたときだけ値を持つ
 * （既定値と同じでも、明示されていれば保持して書き戻す）
 */
export interface FieldDef {
  name: string;
  type: FieldType;
  display_name?: string;
  description?: string;
  export?: boolean;
  editable?: boolean;
  primary?: boolean;
  auto?: AutoKind;
  enum_ref?: string;
  ref?: string;
  formula?: string;
  /** 列の型の値（リストも可）。`""` と `[]` もそのまま保持する（J-02、P-11） */
  default?: RawValue;
  validation?: FieldValidation;
  anomaly?: FieldAnomaly;
}

/** DR-14・DR-32: 列定義のキーの順 */
export const FIELD_KEYS = [
  'name',
  'type',
  'display_name',
  'description',
  'export',
  'editable',
  'primary',
  'auto',
  'enum_ref',
  'ref',
  'formula',
  'default',
  'validation',
  'anomaly',
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

/** 出力対象か（既定は true） */
export function isFieldExported(field: FieldDef): boolean {
  return field.export ?? true;
}

/** 編集できるか（既定は true。自動採番の列は編集できない。FR-EDT-06） */
export function isFieldEditable(field: FieldDef): boolean {
  return (field.editable ?? true) && field.auto === undefined;
}

export function cloneFieldDef(field: FieldDef): FieldDef {
  const copy: FieldDef = { ...field };
  if (field.default !== undefined) copy.default = cloneRawValue(field.default);
  if (field.validation !== undefined) copy.validation = { ...field.validation };
  if (field.anomaly !== undefined) copy.anomaly = { ...field.anomaly };
  return copy;
}

export function cloneRawValue(value: RawValue): RawValue {
  return Array.isArray(value) ? value.map(cloneRawValue) : value;
}
