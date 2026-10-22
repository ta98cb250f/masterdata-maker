// 共通設定の編集（FR-TBL-03）: 列挙型・共通列・セル色のプリセットを、タブで分けたダイアログで編集する。
// 3 つのタブの変更は「保存」でまとめて 1 回の操作にする（元に戻すと全部戻る）
import type { FieldType } from '@masterdata-maker/core';
import { formatInputError, inputContext } from '@masterdata-maker/core';
import { useMemo, useRef, useState } from 'react';
import { DialogFrame } from '../components/Dialog';
import { completionColumnsOf } from '../sheet/complete';
import type { AppStore } from '../store/AppStore';
import { useT } from '../store/hooks';
import type { DraftErrors, DraftKey, FieldError } from './columnDraft';
import { ColumnForm } from './ColumnForm';
import type { BaseFieldDraft, ColorDraft, CommonDraft, EnumDraft, EnumValueDraft } from './commonDraft';
import {
  baseFieldValueCount,
  colorUsage,
  commonDraftErrors,
  commonDraftOf,
  countCells,
  draftId,
  enumUsage,
  enumValueCounts,
  enumValues,
  hasCommonErrors,
  newBaseFieldDraft,
  newEnumValueDraft,
  planCommonChange,
} from './commonDraft';
import { Failures, Field, errorText, useLocale } from './formParts';
import type { DialogProps } from './registry';
import { defineDialog } from './registry';

export type CommonTab = 'enums' | 'base_fields' | 'colors';

export interface CommonSettingsArgs {
  tab?: CommonTab;
  /** 共通列のタブで選んでおく列 */
  field?: string;
}

/** 使われていない名前（prefix_1、prefix_2、…） */
function freshName(prefix: string, used: readonly string[]): string {
  let i = 1;
  while (used.includes(`${prefix}_${i}`)) i++;
  return `${prefix}_${i}`;
}

/** 消した項目の注意（消しても保存はできる） */
function deletionWarnings(store: AppStore, draft: CommonDraft): string[] {
  const project = store.project;
  if (project === null) return [];
  const t = (k: string, p?: Record<string, string | number>) => store.t(k, p);
  const out: string[] = [];
  const keptEnums = new Set(draft.enums.map((d) => d.original));
  for (const e of project.common.enums.items) {
    if (keptEnums.has(e.name)) continue;
    const used = enumUsage(project, e.name);
    if (used.length > 0) out.push(t('ui.settings.warn.enumUsed', { name: e.name, columns: used.join(', ') }));
  }
  for (const d of draft.enums) {
    const def = d.original === null ? undefined : project.common.enums.items.find((e) => e.name === d.original);
    if (def === undefined) continue;
    // 空にした行は削除。消した値をもう一度足した場合は削除ではない
    const kept = new Set([...d.values.filter((v) => v.value.trim() !== '').map((v) => v.original), ...enumValues(d.values)]);
    const deleted = def.values.filter((v) => !kept.has(v));
    if (deleted.length === 0) continue;
    const counts = enumValueCounts(project, def.name);
    for (const v of deleted) {
      const n = counts.get(v) ?? 0;
      if (n > 0) out.push(t('ui.settings.warn.enumValueUsed', { name: d.name.trim(), value: v, count: n }));
    }
  }
  const keptBase = new Set(draft.baseFields.map((d) => d.original?.name));
  for (const f of project.common.base_fields.items) {
    if (keptBase.has(f.name)) continue;
    const n = baseFieldValueCount(project, f.name);
    if (n > 0) out.push(t('ui.settings.warn.baseFieldValues', { name: f.name, count: n }));
  }
  const keptColors = new Set(draft.colors.map((d) => d.original));
  for (const c of project.common.colors.items) {
    if (keptColors.has(c.key)) continue;
    const n = countCells(colorUsage(project, c.key));
    if (n > 0) out.push(t('ui.settings.warn.colorUsed', { key: c.key, count: n }));
  }
  return out;
}

function CommonSettingsDialog({ store, args, close }: DialogProps<CommonSettingsArgs | undefined>) {
  const t = useT();
  const locale = useLocale();
  const project = store.project;
  const tz = store.calc?.timeZone ?? 'UTC';
  const [draft, setDraft] = useState<CommonDraft>(() => (project === null ? { enums: [], baseFields: [], colors: [] } : commonDraftOf(project, tz)));
  const [tab, setTab] = useState<CommonTab>(args?.tab ?? 'enums');
  const [enumId, setEnumId] = useState<number | null>(() => draft.enums[0]?.id ?? null);
  const [baseId, setBaseId] = useState<number | null>(() => (draft.baseFields.find((d) => d.draft.name === args?.field) ?? draft.baseFields[0])?.id ?? null);
  const [attempted, setAttempted] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  const errors = useMemo(
    () => (project === null ? { enums: new Map(), colors: new Map(), baseFields: new Map() } : commonDraftErrors(project, draft, inputContext(project))),
    [project, draft],
  );
  const warnings = useMemo(() => deletionWarnings(store, draft), [store, draft]);

  const change = (patch: Partial<CommonDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setFailures([]);
  };

  const submit = () => {
    setAttempted(true);
    const session = store.session;
    if (project === null || session === null || hasCommonErrors(errors)) return;
    const plan = planCommonChange(project, draft, inputContext(project), locale);
    if (plan.steps.length === 0) {
      close();
      return;
    }
    const r = session.applyGroup('ui.settings.op', plan.steps);
    if (!r.ok) {
      store.calc?.invalidateAll();
      setFailures(r.failures.map((f) => formatInputError(f, locale)));
      return;
    }
    close();
  };

  const tabs: [CommonTab, string, boolean][] = [
    ['enums', t('ui.settings.tab.enums'), errors.enums.size > 0],
    ['base_fields', t('ui.settings.tab.baseFields'), errors.baseFields.size > 0],
    ['colors', t('ui.settings.tab.colors'), errors.colors.size > 0],
  ];

  return (
    <DialogFrame
      title={t('ui.settings.title')}
      onClose={close}
      width={900}
      testId="common-settings-dialog"
      footer={
        <>
          <button type="button" className="sc-button" onClick={close}>
            {t('ui.dialog.cancel')}
          </button>
          <button type="button" className="sc-button primary" onClick={submit} data-testid="settings-ok">
            {t('ui.settings.save')}
          </button>
        </>
      }
    >
      <div className="sc-tabbar" role="tablist">
        {tabs.map(([id, label, invalid]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`sc-tabbar-item${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
            data-testid={`settings-tab-${id}`}
          >
            {label}
            {attempted && invalid ? ' ⚠' : ''}
          </button>
        ))}
      </div>
      <Failures items={failures} testId="settings-failures" />
      {tab === 'enums' && (
        <EnumsTab
          store={store}
          items={draft.enums}
          selected={enumId}
          onSelect={setEnumId}
          errors={errors.enums}
          showErrors={attempted}
          onChange={(enums) => change({ enums })}
        />
      )}
      {tab === 'base_fields' && (
        <BaseFieldsTab
          store={store}
          items={draft.baseFields}
          selected={baseId}
          onSelect={setBaseId}
          errors={errors.baseFields}
          showErrors={attempted}
          onChange={(baseFields) => change({ baseFields })}
          timeZone={tz}
        />
      )}
      {tab === 'colors' && <ColorsTab items={draft.colors} errors={errors.colors} showErrors={attempted} onChange={(colors) => change({ colors })} />}
      {warnings.length > 0 && (
        <div className="sc-form-note" data-testid="settings-warnings" style={{ marginTop: 12 }}>
          <ul className="sc-dialog-list">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </DialogFrame>
  );
}

interface TabProps<T, E> {
  items: T[];
  errors: Map<number, E>;
  showErrors: boolean;
  onChange(items: T[]): void;
}

function replaceItem<T extends { id: number }>(items: T[], id: number, patch: Partial<T>): T[] {
  return items.map((x) => (x.id === id ? { ...x, ...patch } : x));
}

function EnumsTab({
  store,
  items,
  selected,
  onSelect,
  errors,
  showErrors,
  onChange,
}: TabProps<EnumDraft, Partial<Record<'name' | 'values', FieldError>>> & { store: AppStore; selected: number | null; onSelect(id: number | null): void }) {
  const t = useT();
  const locale = useLocale();
  const current = items.find((x) => x.id === selected) ?? null;
  const e = current === null ? undefined : errors.get(current.id);
  const show = (k: 'name' | 'values') => showErrors || (current !== null && (k === 'name' ? current.name !== current.original : true));
  const usage = current?.original === null || current === null || store.project === null ? [] : enumUsage(store.project, current.original);

  const add = () => {
    const name = freshName('enum', items.map((x) => x.name));
    const item: EnumDraft = { id: draftId(), original: null, name, display_name: '', values: [] };
    onChange([...items, item]);
    onSelect(item.id);
  };
  const remove = () => {
    if (current === null) return;
    const i = items.indexOf(current);
    const next = items.filter((x) => x.id !== current.id);
    onChange(next);
    onSelect(next[Math.min(i, next.length - 1)]?.id ?? null);
  };

  return (
    <div className="sc-master-detail" data-testid="settings-enums">
      <div className="sc-master">
        <div className="sc-master-list" role="listbox" aria-label={t('ui.settings.tab.enums')}>
          {items.map((x) => (
            <button
              key={x.id}
              type="button"
              role="option"
              aria-selected={x.id === selected}
              className={`sc-master-item${x.id === selected ? ' active' : ''}${showErrors && errors.has(x.id) ? ' invalid' : ''}`}
              onClick={() => onSelect(x.id)}
              data-testid={`enum-item-${x.name}`}
            >
              <span>{x.name === '' ? t('ui.settings.unnamed') : x.name}</span>
              <span className="sc-master-item-sub">
                {x.display_name !== '' ? `${x.display_name} · ` : ''}
                {t('ui.settings.valueCount', { count: enumValues(x.values).length })}
              </span>
            </button>
          ))}
        </div>
        <div className="sc-master-actions">
          <button type="button" className="sc-button small" onClick={add} data-testid="enum-add">
            {t('ui.settings.add')}
          </button>
          <button type="button" className="sc-button small" onClick={remove} disabled={current === null} data-testid="enum-remove">
            {t('ui.settings.remove')}
          </button>
        </div>
      </div>
      {current === null ? (
        <p className="sc-form-info">{t('ui.settings.empty')}</p>
      ) : (
        <div className="sc-form">
          <Field label={t('ui.settings.enum.name')} htmlFor="enum-name" error={show('name') ? errorText(e?.name, locale) : undefined} hint={current.original !== null ? t('ui.settings.enum.renameHint') : undefined}>
            <input id="enum-name" className="sc-text mono" value={current.name} spellCheck={false} onChange={(ev) => onChange(replaceItem(items, current.id, { name: ev.target.value }))} data-testid="enum-name" />
          </Field>
          <Field label={t('ui.settings.enum.displayName')} htmlFor="enum-display">
            <input id="enum-display" className="sc-text" value={current.display_name} onChange={(ev) => onChange(replaceItem(items, current.id, { display_name: ev.target.value }))} data-testid="enum-display" />
          </Field>
          <Field label={t('ui.settings.enum.values')} error={show('values') ? errorText(e?.values, locale) : undefined} hint={t('ui.settings.enum.valuesHint')}>
            <EnumValuesEditor
              key={current.id}
              store={store}
              enumName={current.original}
              values={current.values}
              onChange={(values) => onChange(replaceItem(items, current.id, { values }))}
            />
          </Field>
          {usage.length > 0 && <p className="sc-form-info">{t('ui.settings.enum.usedBy', { columns: usage.join(', ') })}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * 列挙型の値の一覧。1 行に 1 つの入力欄で、行はもとの値を覚えている（文字を変えると、保存のときにその値のセルも書き換える）。
 * Enter で下に行を足し、複数行の貼り付けは行に分ける
 */
function EnumValuesEditor({
  store,
  enumName,
  values,
  onChange,
}: {
  store: AppStore;
  /** もとの列挙型の名前。新しく足した列挙型は null */
  enumName: string | null;
  values: EnumValueDraft[];
  onChange(values: EnumValueDraft[]): void;
}) {
  const t = useT();
  const project = store.project;
  const counts = useMemo(() => (project === null || enumName === null ? new Map<string, number>() : enumValueCounts(project, enumName)), [project, enumName]);
  // 足した行に入力の焦点を移す（autoFocus は行を作ったときだけ効く）
  const created = useRef(new Set<number>());

  const insert = (index: number, texts: string[]) => {
    const rows = texts.map((v) => newEnumValueDraft(v));
    rows.forEach((r) => created.current.add(r.id));
    onChange([...values.slice(0, index), ...rows, ...values.slice(index)]);
  };
  const move = (i: number, delta: number) => {
    const next = [...values];
    const [x] = next.splice(i, 1);
    next.splice(i + delta, 0, x);
    onChange(next);
  };

  return (
    <div data-testid="enum-values">
      <table className="sc-color-table">
        <tbody>
          {values.map((x, i) => {
            const renamed = x.original !== null && x.value.trim() !== '' && x.value.trim() !== x.original;
            return (
              <tr key={x.id} data-testid={`enum-value-row-${i}`}>
                <td>
                  <input
                    className="sc-text mono"
                    value={x.value}
                    aria-label={t('ui.settings.enum.value', { index: i + 1 })}
                    spellCheck={false}
                    autoFocus={created.current.has(x.id)}
                    onChange={(ev) => onChange(replaceItem(values, x.id, { value: ev.target.value }))}
                    onKeyDown={(ev) => {
                      if (ev.key !== 'Enter' || ev.nativeEvent.isComposing) return;
                      ev.preventDefault();
                      insert(i + 1, ['']);
                    }}
                    onPaste={(ev) => {
                      const lines = ev.clipboardData.getData('text/plain').split(/\r?\n/).map((v) => v.trim()).filter((v) => v !== '');
                      if (lines.length < 2) return;
                      ev.preventDefault();
                      if (x.value.trim() === '') {
                        const rows = lines.slice(1).map((v) => newEnumValueDraft(v));
                        onChange([...values.slice(0, i), { ...x, value: lines[0] }, ...rows, ...values.slice(i + 1)]);
                      } else insert(i + 1, lines);
                    }}
                    data-testid="enum-value"
                  />
                  {renamed && (
                    <div className="sc-field-hint" data-testid="enum-value-renamed">
                      {t('ui.settings.enum.valueRenamed', { from: x.original as string, count: counts.get(x.original as string) ?? 0 })}
                    </div>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="sc-button small" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('ui.settings.moveUp')}>
                    ↑
                  </button>{' '}
                  <button type="button" className="sc-button small" onClick={() => move(i, 1)} disabled={i === values.length - 1} aria-label={t('ui.settings.moveDown')}>
                    ↓
                  </button>{' '}
                  <button type="button" className="sc-button small" onClick={() => onChange(values.filter((y) => y.id !== x.id))} data-testid="enum-value-remove">
                    {t('ui.settings.remove')}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="sc-master-actions" style={{ marginTop: 4 }}>
        <button type="button" className="sc-button small" onClick={() => insert(values.length, [''])} data-testid="enum-value-add">
          {t('ui.settings.enum.addValue')}
        </button>
      </div>
    </div>
  );
}

function BaseFieldsTab({
  store,
  items,
  selected,
  onSelect,
  errors,
  showErrors,
  onChange,
  timeZone,
}: TabProps<BaseFieldDraft, DraftErrors> & { store: AppStore; selected: number | null; onSelect(id: number | null): void; timeZone: string }) {
  const t = useT();
  const current = items.find((x) => x.id === selected) ?? null;
  const columns = useMemo(() => completionColumnsOf(items.map((x) => ({ name: x.draft.name, type: x.draft.type, display_name: x.draft.display_name || undefined }))), [items]);

  const add = () => {
    const used = [...items.map((x) => x.draft.name), ...(store.project?.tables.flatMap((tb) => tb.fields.map((f) => f.name)) ?? [])];
    const item = newBaseFieldDraft(freshName('field', used), 'string' as FieldType, timeZone);
    onChange([...items, item]);
    onSelect(item.id);
  };
  const remove = () => {
    if (current === null) return;
    const i = items.indexOf(current);
    const next = items.filter((x) => x.id !== current.id);
    onChange(next);
    onSelect(next[Math.min(i, next.length - 1)]?.id ?? null);
  };
  const move = (delta: -1 | 1) => {
    if (current === null) return;
    const i = items.indexOf(current);
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="sc-master-detail" data-testid="settings-base-fields">
      <div className="sc-master">
        <div className="sc-master-list" role="listbox" aria-label={t('ui.settings.tab.baseFields')}>
          {items.map((x) => (
            <button
              key={x.id}
              type="button"
              role="option"
              aria-selected={x.id === selected}
              className={`sc-master-item${x.id === selected ? ' active' : ''}${showErrors && errors.has(x.id) ? ' invalid' : ''}`}
              onClick={() => onSelect(x.id)}
              data-testid={`base-item-${x.draft.name}`}
            >
              <span>{x.draft.name}</span>
              <span className="sc-master-item-sub">
                {x.draft.type}
                {x.draft.display_name !== '' ? ` · ${x.draft.display_name}` : ''}
              </span>
            </button>
          ))}
        </div>
        <div className="sc-master-actions">
          <button type="button" className="sc-button small" onClick={add} data-testid="base-add">
            {t('ui.settings.add')}
          </button>
          <button type="button" className="sc-button small" onClick={remove} disabled={current === null} data-testid="base-remove">
            {t('ui.settings.remove')}
          </button>
          <button type="button" className="sc-button small" onClick={() => move(-1)} disabled={current === null || items.indexOf(current) === 0} aria-label={t('ui.settings.moveUp')}>
            ↑
          </button>
          <button type="button" className="sc-button small" onClick={() => move(1)} disabled={current === null || items.indexOf(current) === items.length - 1} aria-label={t('ui.settings.moveDown')}>
            ↓
          </button>
        </div>
        <p className="sc-form-info">{t('ui.settings.baseFieldsNote')}</p>
      </div>
      {current === null ? (
        <p className="sc-form-info">{t('ui.settings.empty')}</p>
      ) : (
        <ColumnForm
          key={current.id}
          store={store}
          draft={current.draft}
          errors={errors.get(current.id) ?? {}}
          showError={(k: DraftKey) => showErrors || current.draft[k] !== current.initial[k]}
          onChange={(patch) => onChange(replaceItem(items, current.id, { draft: { ...current.draft, ...patch } }))}
          columns={columns}
          mode="base"
          typeLocked={current.original !== null}
          idPrefix="base"
        />
      )}
    </div>
  );
}

function ColorsTab({ items, errors, showErrors, onChange }: TabProps<ColorDraft, Partial<Record<'key' | 'color', FieldError>>>) {
  const t = useT();
  const locale = useLocale();
  const add = () => {
    onChange([...items, { id: draftId(), original: null, key: freshName('color', items.map((x) => x.key)), color: '#e8eaed', label: '' }]);
  };
  return (
    <div data-testid="settings-colors">
      <table className="sc-color-table">
        <thead>
          <tr>
            <th>{t('ui.settings.color.key')}</th>
            <th>{t('ui.settings.color.color')}</th>
            <th>{t('ui.settings.color.label')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((x, i) => {
            const e = errors.get(x.id);
            const keyError = showErrors || x.key !== x.original ? errorText(e?.key, locale) : undefined;
            const colorError = errorText(e?.color, locale);
            const valid = /^#[0-9a-fA-F]{6}$/.test(x.color.trim());
            return (
              <tr key={x.id} data-testid={`color-row-${i}`}>
                <td>
                  <input className={`sc-text mono${keyError !== undefined ? ' invalid' : ''}`} value={x.key} aria-label={t('ui.settings.color.key')} spellCheck={false} onChange={(ev) => onChange(replaceItem(items, x.id, { key: ev.target.value }))} data-testid="color-key" />
                  {keyError !== undefined && <div className="sc-field-error">{keyError}</div>}
                </td>
                <td>
                  <div className="sc-inline">
                    <input
                      type="color"
                      className="sc-color-swatch"
                      value={valid ? x.color.trim() : '#ffffff'}
                      aria-label={t('ui.settings.color.pick')}
                      onChange={(ev) => onChange(replaceItem(items, x.id, { color: ev.target.value }))}
                    />
                    <input className={`sc-text mono${colorError !== undefined ? ' invalid' : ''}`} value={x.color} aria-label={t('ui.settings.color.color')} spellCheck={false} onChange={(ev) => onChange(replaceItem(items, x.id, { color: ev.target.value }))} data-testid="color-code" />
                  </div>
                  {colorError !== undefined && <div className="sc-field-error">{colorError}</div>}
                </td>
                <td>
                  <input className="sc-text" value={x.label} aria-label={t('ui.settings.color.label')} onChange={(ev) => onChange(replaceItem(items, x.id, { label: ev.target.value }))} data-testid="color-label" />
                </td>
                <td>
                  <button type="button" className="sc-button small" onClick={() => onChange(items.filter((y) => y.id !== x.id))} data-testid="color-remove">
                    {t('ui.settings.remove')}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="sc-master-actions" style={{ marginTop: 8 }}>
        <button type="button" className="sc-button small" onClick={add} data-testid="color-add">
          {t('ui.settings.add')}
        </button>
      </div>
      <p className="sc-form-info">{t('ui.settings.colorsNote')}</p>
    </div>
  );
}

export const commonSettingsDialog = defineDialog<CommonSettingsArgs | undefined>('settings.common', CommonSettingsDialog);
