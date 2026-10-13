import type { BoundValue, FieldAnomaly, FieldDef, FieldType, FieldValidation } from '../model/field';
import { ANOMALY_KEYS, FIELD_KEYS, isFieldType, VALIDATION_KEYS } from '../model/field';
import { IoCode } from './codes';
import {
  decodeBool,
  decodeFieldValue,
  decodeInteger,
  decodeNumber,
  decodeStringValue,
  numberForType,
} from './decode-value';
import type { Reporter, SrcEntry, SrcMap, SrcNode } from './tree';

// 列定義（DR-12〜14）。知らないキーは読み込みエラー

function decodeBound(node: SrcNode, type: FieldType, r: Reporter, key: string): BoundValue | undefined {
  if (node.kind === 'scalar') {
    const v = node.value;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'bigint') return numberForType(v, type);
    if (v === null) {
      r.warn(IoCode.nullValueIgnored, node.pos, { key });
      return undefined;
    }
  }
  r.error(IoCode.invalidBound, node.pos, { key });
  return undefined;
}

function decodeAnomalyBound(node: SrcNode, type: FieldType, r: Reporter, key: string): number | bigint | undefined {
  if (node.kind === 'scalar') {
    const v = node.value;
    if (typeof v === 'number' || typeof v === 'bigint') return numberForType(v, type);
    if (v === null) {
      r.warn(IoCode.nullValueIgnored, node.pos, { key });
      return undefined;
    }
  }
  r.error(IoCode.expectedNumber, node.pos, { key });
  return undefined;
}

function decodeValidation(node: SrcNode, type: FieldType, r: Reporter, field: string): FieldValidation | undefined {
  const key = `${field}.validation`;
  if (node.kind === 'scalar' && node.value === null) {
    r.warn(IoCode.nullValueIgnored, node.pos, { key });
    return undefined;
  }
  if (node.kind !== 'map') {
    r.error(IoCode.expectedMapping, node.pos, { key });
    return undefined;
  }
  const result: FieldValidation = {};
  for (const entry of node.entries) {
    const k = `${key}.${entry.key}`;
    switch (entry.key) {
      case 'required':
      case 'unique': {
        const v = decodeBool(entry.value, r, k);
        if (v !== undefined) result[entry.key] = v;
        break;
      }
      case 'min':
      case 'max': {
        const v = decodeBound(entry.value, type, r, k);
        if (v !== undefined) result[entry.key] = v;
        break;
      }
      case 'max_length':
      case 'max_items': {
        const v = decodeInteger(entry.value, r, k);
        if (v !== undefined) result[entry.key] = v;
        break;
      }
      case 'regex': {
        const v = decodeStringValue(entry.value, r, k);
        if (v !== undefined) result.regex = v;
        break;
      }
      default:
        r.error(IoCode.unknownValidationKey, entry.keyPos, { key: entry.key, field });
    }
  }
  return result;
}

function decodeAnomaly(node: SrcNode, type: FieldType, r: Reporter, field: string): FieldAnomaly | undefined {
  const key = `${field}.anomaly`;
  if (node.kind === 'scalar' && node.value === null) {
    r.warn(IoCode.nullValueIgnored, node.pos, { key });
    return undefined;
  }
  if (node.kind !== 'map') {
    r.error(IoCode.expectedMapping, node.pos, { key });
    return undefined;
  }
  const result: FieldAnomaly = {};
  for (const entry of node.entries) {
    const k = `${key}.${entry.key}`;
    switch (entry.key) {
      case 'warn_above':
      case 'warn_below': {
        const v = decodeAnomalyBound(entry.value, type, r, k);
        if (v !== undefined) result[entry.key] = v;
        break;
      }
      case 'warn_deviation': {
        const v = decodeNumber(entry.value, r, k);
        if (v !== undefined) result.warn_deviation = v;
        break;
      }
      default:
        r.error(IoCode.unknownAnomalyKey, entry.keyPos, { key: entry.key, field });
    }
  }
  return result;
}

function findEntry(node: SrcMap, key: string): SrcEntry | undefined {
  return node.entries.find((entry) => entry.key === key);
}

/**
 * 列定義を 1 つ解釈する。name・type が読めなければ null（エラーは報告済み）。
 * `listKey` は診断に出す親のキー（`fields` / `base_fields`）
 */
export function decodeFieldDef(node: SrcNode, reporter: Reporter, listKey: string): FieldDef | null {
  if (node.kind !== 'map') {
    reporter.error(IoCode.expectedMapping, node.pos, { key: listKey });
    return null;
  }
  const nameEntry = findEntry(node, 'name');
  const name = nameEntry === undefined ? undefined : decodeStringValue(nameEntry.value, reporter, 'name');
  if (name === undefined) {
    reporter.error(IoCode.missingKey, node.pos, { key: `${listKey}.name` });
  }
  const label = name ?? '';
  const r = name === undefined ? reporter : reporter.child({ field: name });

  let type: FieldType | undefined;
  const typeEntry = findEntry(node, 'type');
  if (typeEntry === undefined) {
    r.error(IoCode.missingKey, node.pos, { key: `${label}.type` });
  } else {
    const t = decodeStringValue(typeEntry.value, r, `${label}.type`);
    if (t !== undefined) {
      if (isFieldType(t)) type = t;
      else r.error(IoCode.unknownFieldType, typeEntry.value.pos, { field: label, type: t });
    } else {
      r.error(IoCode.missingKey, node.pos, { key: `${label}.type` });
    }
  }

  const field: Partial<FieldDef> = {};
  for (const entry of node.entries) {
    const k = `${label}.${entry.key}`;
    switch (entry.key) {
      case 'name':
      case 'type':
        break;
      case 'display_name':
      case 'description':
      case 'enum_ref':
      case 'ref':
      case 'formula': {
        const v = decodeStringValue(entry.value, r, k);
        if (v !== undefined) field[entry.key] = v;
        break;
      }
      case 'export':
      case 'editable':
      case 'primary': {
        const v = decodeBool(entry.value, r, k);
        if (v !== undefined) field[entry.key] = v;
        break;
      }
      case 'auto': {
        const v = decodeStringValue(entry.value, r, k);
        if (v === 'increment') field.auto = v;
        else if (v !== undefined) r.error(IoCode.invalidAuto, entry.value.pos, { field: label, value: v });
        break;
      }
      case 'default': {
        if (type === undefined) break;
        if (entry.value.kind === 'map') {
          r.error(IoCode.invalidDefault, entry.value.pos, { field: label });
          break;
        }
        const v = decodeFieldValue(entry.value, type, r, k, 'default');
        if (v !== undefined) field.default = v;
        break;
      }
      case 'validation': {
        if (type === undefined) break;
        const v = decodeValidation(entry.value, type, r, label);
        if (v !== undefined) field.validation = v;
        break;
      }
      case 'anomaly': {
        if (type === undefined) break;
        const v = decodeAnomaly(entry.value, type, r, label);
        if (v !== undefined) field.anomaly = v;
        break;
      }
      default: {
        // DR-12: 例えば列の直下の required は validation.required の書き間違い
        const code = (VALIDATION_KEYS as readonly string[]).includes(entry.key)
          ? IoCode.fieldKeyBelongsToValidation
          : (ANOMALY_KEYS as readonly string[]).includes(entry.key)
            ? IoCode.fieldKeyBelongsToAnomaly
            : IoCode.unknownFieldKey;
        r.error(code, entry.keyPos, { key: entry.key, field: label });
      }
    }
  }
  if (name === undefined || type === undefined) return null;

  // DR-14 の順にそろえる（書き出しも同じ順）
  const result: FieldDef = { name, type };
  const target = result as unknown as Record<string, unknown>;
  for (const key of FIELD_KEYS) {
    if (key === 'name' || key === 'type') continue;
    const value = field[key];
    if (value !== undefined) target[key] = value;
  }
  return result;
}

/** 列定義の並び（`fields` / `base_fields`）を解釈する */
export function decodeFieldList(node: SrcNode, r: Reporter, key: string): FieldDef[] {
  if (node.kind === 'scalar' && node.value === null) {
    r.warn(IoCode.nullValueIgnored, node.pos, { key });
    return [];
  }
  if (node.kind !== 'seq') {
    r.error(IoCode.expectedList, node.pos, { key });
    return [];
  }
  const fields: FieldDef[] = [];
  for (const item of node.items) {
    const field = decodeFieldDef(item, r, key);
    if (field !== null) fields.push(field);
  }
  return fields;
}
