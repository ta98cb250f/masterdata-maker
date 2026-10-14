// 列の設定の入力欄（FR-COL-02）。列の設定のダイアログと、共通設定の共通列のタブで使う。
// 型で使えない検査ルール・警告条件は出さない（値が入っていれば、使えない旨を添えて出す）
import type { FieldType } from '@sheetcraft/core';
import { FIELD_TYPES } from '@sheetcraft/core';
import { useMemo, useRef } from 'react';
import type { FormulaAssistHandle } from '../components/FormulaAssist';
import { FormulaAssist } from '../components/FormulaAssist';
import type { CompletionColumn } from '../sheet/complete';
import type { AppStore } from '../store/AppStore';
import { useT } from '../store/hooks';
import type { ColumnDraft, DraftErrors, DraftKey } from './columnDraft';
import { applicableRules, formulaSyntaxError, isEnumType, normalizeFormula } from './columnDraft';
import { Check, Field, Section, errorText, useLocale } from './formParts';

/** 文字の欄 */
type TextKey = { [K in DraftKey]: ColumnDraft[K] extends string ? K : never }[DraftKey];

export interface ColumnFormProps {
  store: AppStore;
  draft: ColumnDraft;
  errors: DraftErrors;
  /** 誤りを出す欄（開いた直後は出さない） */
  showError(key: DraftKey): boolean;
  onChange(patch: Partial<ColumnDraft>): void;
  /** 式の補完に使う列 */
  columns: readonly CompletionColumn[];
  /** base: 共通列の設定（主キー・自動採番の欄を出す） */
  mode: 'table' | 'base';
  /** 型を変えられない（共通列の既存の列。共通列の型の変換は無いため） */
  typeLocked?: boolean;
  /** 欄の id の接頭辞（同じ画面に 2 つ出すとき用） */
  idPrefix?: string;
}

export function ColumnForm({ store, draft, errors, showError, onChange, columns, mode, typeLocked = false, idPrefix = 'col' }: ColumnFormProps) {
  const t = useT();
  const locale = useLocale();
  const formulaRef = useRef<HTMLInputElement>(null);
  const assistRef = useRef<FormulaAssistHandle>(null);
  const project = store.project;
  const calc = store.calc;
  const app = applicableRules(draft.type);
  const id = (k: string) => `${idPrefix}-${k}`;
  const err = (k: DraftKey) => (showError(k) ? errorText(errors[k], locale) : undefined);
  const notApplicable = t('ui.column.notApplicable', { type: draft.type });

  const text = (k: TextKey, options: { mono?: boolean; placeholder?: string } = {}) => (
    <input
      id={id(k)}
      className={`sc-text${options.mono === true ? ' mono' : ''}${err(k) !== undefined ? ' invalid' : ''}`}
      value={draft[k]}
      placeholder={options.placeholder}
      spellCheck={false}
      onChange={(e) => onChange({ [k]: e.target.value } as Partial<ColumnDraft>)}
      data-testid={id(k)}
    />
  );

  const enumNames = project?.common.enums.items.map((e) => e.name) ?? [];
  const enumOptions = draft.enum_ref !== '' && !enumNames.includes(draft.enum_ref) ? [...enumNames, draft.enum_ref] : enumNames;
  const tableNames = project?.tables.map((x) => x.name) ?? [];
  const refTables = draft.ref_table !== '' && !tableNames.includes(draft.ref_table) ? [...tableNames, draft.ref_table] : tableNames;
  const refColumns = useMemo(() => {
    const target = draft.ref_table === '' || calc === null ? undefined : calc.findTable(draft.ref_table);
    const names = target === undefined || calc === null ? [] : calc.columns(target).map((c) => c.name);
    return draft.ref_column !== '' && !names.includes(draft.ref_column) ? [...names, draft.ref_column] : names;
  }, [calc, draft.ref_table, draft.ref_column]);
  const syntax = formulaSyntaxError(draft.formula);
  const show = (applicable: boolean, ...keys: DraftKey[]) => applicable || keys.some((k) => draft[k] !== '' && draft[k] !== false);

  return (
    <div className="sc-form">
      <Section title={t('ui.column.section.basic')}>
        <Field label={t('ui.column.field.name')} htmlFor={id('name')} error={err('name')} hint={t('ui.column.hint.name')} testId={`${id('name')}-field`}>
          {text('name', { mono: true })}
        </Field>
        <Field label={t('ui.column.field.type')} htmlFor={id('type')} hint={typeLocked ? t('ui.column.hint.typeLocked') : undefined}>
          <select
            id={id('type')}
            className="sc-select"
            value={draft.type}
            disabled={typeLocked}
            onChange={(e) => onChange({ type: e.target.value as FieldType })}
            data-testid={id('type')}
          >
            {FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('ui.column.field.displayName')} htmlFor={id('display_name')} error={err('display_name')}>
          {text('display_name')}
        </Field>
        <Field label={t('ui.column.field.description')} htmlFor={id('description')}>
          {text('description')}
        </Field>
        <div className="sc-field">
          <span className="sc-field-label">{t('ui.column.field.options')}</span>
          <div className="sc-checks">
            <Check label={t('ui.column.field.export')} checked={draft.export} onChange={(v) => onChange({ export: v })} testId={id('export')} />
            <Check label={t('ui.column.field.editable')} checked={draft.editable} onChange={(v) => onChange({ editable: v })} testId={id('editable')} />
            {mode === 'base' && <Check label={t('ui.column.field.primary')} checked={draft.primary} onChange={(v) => onChange({ primary: v })} testId={id('primary')} />}
            {mode === 'base' && <Check label={t('ui.column.field.auto')} checked={draft.auto} onChange={(v) => onChange({ auto: v })} testId={id('auto')} />}
          </div>
        </div>
      </Section>

      <Section title={t('ui.column.section.value')}>
        {show(isEnumType(draft.type), 'enum_ref') && (
          <Field
            label={t('ui.column.field.enumRef')}
            htmlFor={id('enum_ref')}
            error={err('enum_ref')}
            warning={isEnumType(draft.type) ? undefined : notApplicable}
          >
            <select id={id('enum_ref')} className="sc-select" value={draft.enum_ref} onChange={(e) => onChange({ enum_ref: e.target.value })} data-testid={id('enum_ref')}>
              <option value="">{t('ui.column.none')}</option>
              {enumOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('ui.column.field.ref')} htmlFor={id('ref_table')} error={err('ref_column')} hint={t('ui.column.hint.ref')}>
          <div className="sc-inline">
            <select
              id={id('ref_table')}
              className="sc-select"
              value={draft.ref_table}
              aria-label={t('ui.column.field.refTable')}
              onChange={(e) => onChange({ ref_table: e.target.value, ref_column: e.target.value === '' ? '' : 'id' })}
              data-testid={id('ref_table')}
            >
              <option value="">{t('ui.column.none')}</option>
              {refTables.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select
              className="sc-select"
              value={draft.ref_column}
              aria-label={t('ui.column.field.refColumn')}
              disabled={draft.ref_table === ''}
              onChange={(e) => onChange({ ref_column: e.target.value })}
              data-testid={id('ref_column')}
            >
              <option value="">{t('ui.column.none')}</option>
              {refColumns.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </Field>
        <Field label={t('ui.column.field.formula')} htmlFor={id('formula')} error={showError('formula') && syntax !== null ? errorText(syntax, locale) : err('formula')}>
          <div className="sc-formula-field">
            <span className="sc-fx-prefix">=</span>
            <input
              ref={formulaRef}
              id={id('formula')}
              className={`sc-text mono${syntax !== null ? ' invalid' : ''}`}
              value={draft.formula}
              placeholder={t('ui.column.placeholder.formula')}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => onChange({ formula: e.target.value })}
              onKeyDown={(e) => {
                if (assistRef.current?.handleKey(e) === true) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              data-testid={id('formula')}
            />
          </div>
          <FormulaAssist ref={assistRef} inputRef={formulaRef} text={draft.formula} columns={columns} requireEquals={false} />
          {normalizeFormula(draft.formula) !== '' && syntax === null && <div className="sc-formula-ok">{t('ui.column.formulaOk')}</div>}
        </Field>
        <Field label={t('ui.column.field.default')} htmlFor={id('default')} error={err('default')} hint={t('ui.column.hint.default')}>
          {text('default')}
        </Field>
      </Section>

      <Section title={t('ui.column.section.rules')}>
        <div className="sc-field">
          <span className="sc-field-label">{t('ui.column.field.checks')}</span>
          <div className="sc-checks">
            <Check label={t('ui.column.field.required')} checked={draft.required} onChange={(v) => onChange({ required: v })} testId={id('required')} />
            <Check label={t('ui.column.field.unique')} checked={draft.unique} onChange={(v) => onChange({ unique: v })} testId={id('unique')} />
          </div>
        </div>
        {show(app.minMax, 'min', 'max') && (
          <>
            <Field label={t('ui.column.field.min')} htmlFor={id('min')} error={err('min')} warning={app.minMax ? undefined : notApplicable}>
              {text('min', { placeholder: draft.type === 'datetime' ? t('ui.column.placeholder.datetime') : undefined })}
            </Field>
            <Field label={t('ui.column.field.max')} htmlFor={id('max')} error={err('max')} warning={app.minMax ? undefined : notApplicable}>
              {text('max', { placeholder: draft.type === 'datetime' ? t('ui.column.placeholder.datetime') : undefined })}
            </Field>
          </>
        )}
        {show(app.maxLength, 'max_length') && (
          <Field label={t('ui.column.field.maxLength')} htmlFor={id('max_length')} error={err('max_length')} warning={app.maxLength ? undefined : notApplicable}>
            {text('max_length')}
          </Field>
        )}
        {show(app.maxItems, 'max_items') && (
          <Field label={t('ui.column.field.maxItems')} htmlFor={id('max_items')} error={err('max_items')} warning={app.maxItems ? undefined : notApplicable}>
            {text('max_items')}
          </Field>
        )}
        {show(app.regex, 'regex') && (
          <Field label={t('ui.column.field.regex')} htmlFor={id('regex')} error={err('regex')} hint={t('ui.column.hint.regex')} warning={app.regex ? undefined : notApplicable}>
            {text('regex', { mono: true })}
          </Field>
        )}
      </Section>

      {show(app.warnLimits || app.warnDeviation, 'warn_above', 'warn_below', 'warn_deviation') && (
        <Section title={t('ui.column.section.warnings')}>
          {show(app.warnLimits, 'warn_above', 'warn_below') && (
            <>
              <Field label={t('ui.column.field.warnAbove')} htmlFor={id('warn_above')} error={err('warn_above')} warning={app.warnLimits ? undefined : notApplicable}>
                {text('warn_above')}
              </Field>
              <Field label={t('ui.column.field.warnBelow')} htmlFor={id('warn_below')} error={err('warn_below')} warning={app.warnLimits ? undefined : notApplicable}>
                {text('warn_below')}
              </Field>
            </>
          )}
          {show(app.warnDeviation, 'warn_deviation') && (
            <Field
              label={t('ui.column.field.warnDeviation')}
              htmlFor={id('warn_deviation')}
              error={err('warn_deviation')}
              hint={t('ui.column.hint.warnDeviation')}
              warning={app.warnDeviation ? undefined : notApplicable}
            >
              {text('warn_deviation')}
            </Field>
          )}
        </Section>
      )}
    </div>
  );
}
