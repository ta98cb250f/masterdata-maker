import type { ColorDef, CommonPartName, EnumDef } from '../model/common';
import type { FieldDef } from '../model/field';
import type { ProjectConfig } from '../model/project';
import { CURRENT_FORMAT_VERSION, isOutputFormat } from '../model/project';
import type { SourceFile, StorageFormat } from '../model/source';
import { IoCode } from './codes';
import { decodeFieldList } from './decode-field';
import { decodeInteger, decodeStringElement, decodeStringValue } from './decode-value';
import type { Reporter, SrcMap, SrcNode } from './tree';

// プロジェクト設定（P-01）と共通設定（P-02）

function asMap(node: SrcNode, r: Reporter, key: string): SrcMap | null {
  if (node.kind === 'map') return node;
  r.error(IoCode.expectedMapping, node.pos, { key });
  return null;
}

/** IANA のタイムゾーン名として使えるか（DR-07） */
export function isValidTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export function decodeProjectConfig(root: SrcNode | null, r: Reporter, source: SourceFile): ProjectConfig | null {
  if (root === null) return null;
  if (root.kind !== 'map') {
    r.error(IoCode.rootNotMapping, root.pos);
    return null;
  }
  let formatVersion: number | undefined;
  let storageFormat: StorageFormat | undefined;
  let timezone: string | undefined;
  let paths: ProjectConfig['paths'];
  let output: ProjectConfig['output'];

  for (const entry of root.entries) {
    switch (entry.key) {
      case 'format_version': {
        const v = decodeInteger(entry.value, r, 'format_version');
        if (v === undefined) break;
        if (v > CURRENT_FORMAT_VERSION) {
          r.error(IoCode.unsupportedFormatVersion, entry.value.pos, {
            version: v,
            supported: CURRENT_FORMAT_VERSION,
          });
        } else if (v < 1) {
          r.error(IoCode.invalidFormatVersion, entry.value.pos, { version: v });
        }
        formatVersion = v;
        break;
      }
      case 'storage': {
        const map = asMap(entry.value, r, 'storage');
        if (map === null) break;
        for (const e of map.entries) {
          if (e.key !== 'format') {
            r.error(IoCode.unknownConfigKey, e.keyPos, { key: `storage.${e.key}` });
            continue;
          }
          const v = decodeStringValue(e.value, r, 'storage.format');
          if (v === 'yaml' || v === 'json') storageFormat = v;
          else if (v !== undefined) r.error(IoCode.invalidStorageFormat, e.value.pos, { value: v });
        }
        if (storageFormat === undefined && !map.entries.some((e) => e.key === 'format')) {
          r.error(IoCode.missingKey, map.pos, { key: 'storage.format' });
        }
        break;
      }
      case 'timezone': {
        const v = decodeStringValue(entry.value, r, 'timezone');
        if (v === undefined) break;
        // 使えないタイムゾーンは警告にとどめる（画面はブラウザのタイムゾーンで代用する）
        if (!isValidTimeZone(v)) r.warn(IoCode.invalidTimezone, entry.value.pos, { value: v });
        timezone = v;
        break;
      }
      case 'paths': {
        const map = asMap(entry.value, r, 'paths');
        if (map === null) break;
        paths = {};
        for (const e of map.entries) {
          if (e.key !== 'tables' && e.key !== 'config') {
            r.error(IoCode.unknownConfigKey, e.keyPos, { key: `paths.${e.key}` });
            continue;
          }
          const v = decodeStringValue(e.value, r, `paths.${e.key}`);
          if (v !== undefined) paths[e.key] = v;
        }
        break;
      }
      case 'output': {
        const map = asMap(entry.value, r, 'output');
        if (map === null) break;
        output = {};
        for (const e of map.entries) {
          if (e.key === 'format') {
            const v = decodeStringValue(e.value, r, 'output.format');
            if (v !== undefined && isOutputFormat(v)) output.format = v;
            else if (v !== undefined) r.error(IoCode.invalidOutputFormat, e.value.pos, { value: v });
          } else if (e.key === 'out_dir') {
            const v = decodeStringValue(e.value, r, 'output.out_dir');
            if (v !== undefined) output.out_dir = v;
          } else {
            r.error(IoCode.unknownConfigKey, e.keyPos, { key: `output.${e.key}` });
          }
        }
        break;
      }
      default:
        r.error(IoCode.unknownConfigKey, entry.keyPos, { key: entry.key });
    }
  }
  if (formatVersion === undefined && !root.entries.some((e) => e.key === 'format_version')) {
    r.error(IoCode.missingKey, root.pos, { key: 'format_version' });
  }
  if (!root.entries.some((e) => e.key === 'storage')) {
    r.error(IoCode.missingKey, root.pos, { key: 'storage' });
  }
  if (r.hasErrors() || formatVersion === undefined || storageFormat === undefined) return null;

  const config: ProjectConfig = { format_version: formatVersion, storage: { format: storageFormat }, source };
  if (timezone !== undefined) config.timezone = timezone;
  if (paths !== undefined) config.paths = paths;
  if (output !== undefined) config.output = output;
  return config;
}

/** 共通設定のファイルのトップレベル（`enums:` などの 1 キー）から並びを取り出す */
function commonList(root: SrcNode | null, r: Reporter, name: CommonPartName): SrcNode[] | null {
  if (root === null) return null;
  if (root.kind !== 'map') {
    r.error(IoCode.rootNotMapping, root.pos);
    return null;
  }
  let list: SrcNode[] | null = null;
  let found = false;
  for (const entry of root.entries) {
    if (entry.key !== name) {
      r.error(IoCode.unknownCommonKey, entry.keyPos, { key: entry.key });
      continue;
    }
    found = true;
    const v = entry.value;
    if (v.kind === 'seq') list = v.items;
    else if (v.kind === 'scalar' && v.value === null) {
      r.warn(IoCode.nullValueIgnored, v.pos, { key: name });
      list = [];
    } else r.error(IoCode.expectedList, v.pos, { key: name });
  }
  if (!found) r.error(IoCode.missingKey, root.pos, { key: name });
  return list;
}

export function decodeEnums(root: SrcNode | null, r: Reporter): EnumDef[] | null {
  const list = commonList(root, r, 'enums');
  if (list === null) return null;
  const result: EnumDef[] = [];
  for (const node of list) {
    const map = asMap(node, r, 'enums');
    if (map === null) continue;
    let name: string | undefined;
    let displayName: string | undefined;
    let values: string[] | undefined;
    for (const entry of map.entries) {
      if (entry.key === 'name') name = decodeStringValue(entry.value, r, 'enums.name');
      else if (entry.key === 'display_name') {
        displayName = decodeStringValue(entry.value, r, `${name ?? ''}.display_name`);
      }
    }
    const label = name ?? '';
    for (const entry of map.entries) {
      if (entry.key === 'name' || entry.key === 'display_name') continue;
      if (entry.key !== 'values') {
        r.error(IoCode.unknownEnumKey, entry.keyPos, { key: entry.key, enum: label });
        continue;
      }
      const v = entry.value;
      if (v.kind !== 'seq') {
        r.error(IoCode.expectedList, v.pos, { key: `${label}.values` });
        continue;
      }
      values = [];
      for (const item of v.items) {
        const s = decodeStringElement(item, r, `${label}.values`);
        if (s !== undefined) values.push(s);
      }
    }
    if (name === undefined) r.error(IoCode.missingKey, map.pos, { key: 'enums.name' });
    if (values === undefined) r.error(IoCode.missingKey, map.pos, { key: `${label}.values` });
    if (name === undefined || values === undefined) continue;
    result.push(displayName === undefined ? { name, values } : { name, display_name: displayName, values });
  }
  return r.hasErrors() ? null : result;
}

export function decodeBaseFields(root: SrcNode | null, r: Reporter): FieldDef[] | null {
  if (root === null) return null;
  const list = commonList(root, r, 'base_fields');
  if (list === null) return null;
  const fields = decodeFieldList({ kind: 'seq', items: list, pos: root.pos }, r, 'base_fields');
  return r.hasErrors() ? null : fields;
}

export function decodeColors(root: SrcNode | null, r: Reporter): ColorDef[] | null {
  const list = commonList(root, r, 'colors');
  if (list === null) return null;
  const result: ColorDef[] = [];
  for (const node of list) {
    const map = asMap(node, r, 'colors');
    if (map === null) continue;
    let key: string | undefined;
    let color: string | undefined;
    let label: string | undefined;
    const keyEntry = map.entries.find((e) => e.key === 'key');
    if (keyEntry !== undefined) key = decodeStringValue(keyEntry.value, r, 'colors.key');
    const name = key ?? '';
    for (const entry of map.entries) {
      switch (entry.key) {
        case 'key':
          break;
        case 'color':
          color = decodeStringValue(entry.value, r, `${name}.color`);
          break;
        case 'label':
          label = decodeStringValue(entry.value, r, `${name}.label`);
          break;
        default:
          r.error(IoCode.unknownColorKey, entry.keyPos, { key: entry.key, color: name });
      }
    }
    if (key === undefined) r.error(IoCode.missingKey, map.pos, { key: 'colors.key' });
    if (color === undefined) r.error(IoCode.missingKey, map.pos, { key: `${name}.color` });
    if (key === undefined || color === undefined) continue;
    const def: ColorDef = { key, color };
    if (label !== undefined) def.label = label;
    result.push(def);
  }
  return r.hasErrors() ? null : result;
}
