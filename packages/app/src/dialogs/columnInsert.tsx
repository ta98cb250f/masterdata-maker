// 列の挿入のダイアログ（FR-COL-01）。左・右に、列名・型・表示名（列挙型なら列挙型も）を入れて挿入する。
// 挿入した列を選ぶ。列の細かい設定は、挿入した後に列の設定で行う
import type { FieldDef, FieldType, Project, Table } from '@sheetcraft/core';
import { EditCode, FIELD_TYPES, formatInputError, insertColumn, isValidIdentifier, selectColRange, validateColumnName } from '@sheetcraft/core';
import { useMemo, useState } from 'react';
import { DialogFrame } from '../components/Dialog';
import type { AppStore } from '../store/AppStore';
import { useT } from '../store/hooks';
import { isEnumType } from './columnDraft';
import { Failures, Field, submitOnEnter, useLocale } from './formParts';
import type { DialogProps } from './registry';
import { defineDialog } from './registry';

export interface ColumnInsertArgs {
  table: number;
  /** 基準の列（この列の左・右に入れる） */
  column: string;
  side: 'left' | 'right';
}

/** 使われていない列名の候補（column_1、column_2、…） */
export function suggestColumnName(project: Project, table: Table): string {
  const used = new Set([...project.common.base_fields.items.map((f) => f.name), ...table.fields.map((f) => f.name)]);
  for (const r of table.records) for (const k of r.cells.keys()) used.add(k);
  let i = 1;
  while (used.has(`column_${i}`)) i++;
  return `column_${i}`;
}

/** 列を挿入して、その列を選ぶ。失敗なら失敗の文言を返す */
export function insertColumnAndSelect(store: AppStore, args: ColumnInsertArgs, field: FieldDef): string[] | null {
  const project = store.project;
  if (project === null) return [];
  const r = store.apply(insertColumn(project, { table: args.table, position: { anchor: args.column, side: args.side }, field }));
  if (!r.ok) return r.failures.map((f) => formatInputError(f, store.getState().locale));
  const sheet = store.sheet(args.table);
  const col = sheet?.colOf(field.name) ?? -1;
  if (sheet !== null && col >= 0) store.setSelection(selectColRange(col, col, sheet.size), { reveal: true, table: args.table });
  return null;
}

function ColumnInsertDialog({ store, args, close }: DialogProps<ColumnInsertArgs>) {
  const t = useT();
  const locale = useLocale();
  const project = store.project;
  const table = store.table(args.table);
  const [name, setName] = useState(() => (project === null || table === undefined ? '' : suggestColumnName(project, table)));
  const [type, setType] = useState<FieldType>('string');
  const [displayName, setDisplayName] = useState('');
  const [enumRef, setEnumRef] = useState(() => project?.common.enums.items[0]?.name ?? '');
  const [failures, setFailures] = useState<string[]>([]);

  const nameError = useMemo(() => {
    if (project === null || table === undefined) return undefined;
    const f = validateColumnName(project, table, name)[0];
    return f === undefined ? undefined : formatInputError(f, locale);
  }, [project, table, name, locale]);
  const enumError =
    isEnumType(type) && enumRef === '' ? formatInputError({ code: EditCode.enumRefRequired, params: { column: name, type } }, locale) : undefined;

  const submit = () => {
    if (nameError !== undefined || enumError !== undefined || !isValidIdentifier(name)) return;
    const field: FieldDef = { name, type };
    if (displayName.trim() !== '') field.display_name = displayName;
    if (isEnumType(type)) field.enum_ref = enumRef;
    const failed = insertColumnAndSelect(store, args, field);
    if (failed !== null) {
      setFailures(failed);
      return;
    }
    close();
  };

  return (
    <DialogFrame
      title={t(args.side === 'left' ? 'ui.column.insertLeftTitle' : 'ui.column.insertRightTitle', { column: args.column })}
      onClose={close}
      width={480}
      testId="column-insert-dialog"
      footer={
        <>
          <button type="button" className="sc-button" onClick={close}>
            {t('ui.dialog.cancel')}
          </button>
          <button type="button" className="sc-button primary" disabled={nameError !== undefined || enumError !== undefined} onClick={submit} data-testid="column-insert-ok">
            {t('ui.column.insert')}
          </button>
        </>
      }
    >
      <div className="sc-form" onKeyDown={submitOnEnter(submit)}>
        <Failures items={failures} />
        <Field label={t('ui.column.field.name')} htmlFor="col-insert-name" error={nameError} hint={t('ui.column.hint.name')}>
          <input id="col-insert-name" className={`sc-text mono${nameError !== undefined ? ' invalid' : ''}`} value={name} spellCheck={false} onChange={(e) => setName(e.target.value)} data-testid="col-insert-name" />
        </Field>
        <Field label={t('ui.column.field.type')} htmlFor="col-insert-type">
          <select id="col-insert-type" className="sc-select" value={type} onChange={(e) => setType(e.target.value as FieldType)} data-testid="col-insert-type">
            {FIELD_TYPES.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </Field>
        {isEnumType(type) && (
          <Field label={t('ui.column.field.enumRef')} htmlFor="col-insert-enum" error={enumError}>
            <select id="col-insert-enum" className="sc-select" value={enumRef} onChange={(e) => setEnumRef(e.target.value)} data-testid="col-insert-enum">
              <option value="">{t('ui.column.none')}</option>
              {(project?.common.enums.items ?? []).map((e) => (
                <option key={e.name} value={e.name}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('ui.column.field.displayName')} htmlFor="col-insert-display">
          <input id="col-insert-display" className="sc-text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} data-testid="col-insert-display" />
        </Field>
      </div>
    </DialogFrame>
  );
}

export const columnInsertDialog = defineDialog<ColumnInsertArgs>('column.insert', ColumnInsertDialog);
