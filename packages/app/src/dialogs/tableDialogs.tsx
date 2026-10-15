// テーブル（シート）の新規作成・名前の変更（FR-TBL-01〜02）と、削除の確認（参照されていれば警告する）
import type { TableReference } from '@sheetcraft/core';
import {
  EditCode,
  createTable,
  deleteTable,
  findTableReferences,
  formatInputError,
  renameTable,
  setTableDisplayName,
  validateTableName,
} from '@sheetcraft/core';
import { useMemo, useState } from 'react';
import { DialogFrame } from '../components/Dialog';
import { useT } from '../store/hooks';
import { Failures, Field, submitOnEnter, useLocale } from './formParts';
import type { DialogProps } from './registry';
import { defineDialog } from './registry';

export type TableFormArgs = { mode: 'create' } | { mode: 'rename'; table: number };

function TableFormDialog({ store, args, close }: DialogProps<TableFormArgs>) {
  const t = useT();
  const locale = useLocale();
  const project = store.project;
  const existing = args.mode === 'rename' ? store.table(args.table) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [displayName, setDisplayName] = useState(existing?.display_name ?? '');
  const [touched, setTouched] = useState(args.mode === 'rename');
  const [failures, setFailures] = useState<string[]>([]);
  const nameError = useMemo(() => {
    if (project === null) return undefined;
    const f = validateTableName(project, name, existing?.uid)[0];
    return f === undefined ? undefined : formatInputError(f, locale);
  }, [project, name, existing, locale]);

  const submit = () => {
    setTouched(true);
    const session = store.session;
    if (project === null || session === null || nameError !== undefined) return;
    if (args.mode === 'create') {
      const r = store.apply(createTable(project, { name, display_name: displayName.trim() === '' ? undefined : displayName }));
      if (!r.ok) {
        setFailures(r.failures.map((f) => formatInputError(f, locale)));
        return;
      }
      close();
      store.setActiveTable(r.tx.tables[0]);
      return;
    }
    if (existing === undefined) return;
    const uid = existing.uid;
    const label = name !== existing.name ? EditCode.opRenameTable : EditCode.opSetTableDisplayName;
    const r = session.applyGroup(label, [
      (p) => renameTable(p, { table: uid, name }),
      (p) => setTableDisplayName(p, { table: uid, displayName: displayName.trim() === '' ? null : displayName }),
    ]);
    if (!r.ok) {
      store.calc?.invalidateAll();
      setFailures(r.failures.map((f) => formatInputError(f, locale)));
      return;
    }
    close();
  };

  const showNameError = touched || name !== '';
  return (
    <DialogFrame
      title={args.mode === 'create' ? t('ui.table.createTitle') : t('ui.table.renameTitle', { name: existing?.name ?? '' })}
      onClose={close}
      width={480}
      testId="table-form-dialog"
      footer={
        <>
          <button type="button" className="sc-button" onClick={close}>
            {t('ui.dialog.cancel')}
          </button>
          <button type="button" className="sc-button primary" onClick={submit} disabled={showNameError && nameError !== undefined} data-testid="table-form-ok">
            {args.mode === 'create' ? t('ui.table.create') : t('ui.dialog.ok')}
          </button>
        </>
      }
    >
      <div className="sc-form" onKeyDown={submitOnEnter(submit)}>
        <Failures items={failures} />
        <Field label={t('ui.table.field.name')} htmlFor="table-name" error={showNameError ? nameError : undefined} hint={t('ui.table.hint.name')}>
          <input
            id="table-name"
            className={`sc-text mono${showNameError && nameError !== undefined ? ' invalid' : ''}`}
            value={name}
            spellCheck={false}
            onChange={(e) => {
              setName(e.target.value);
              setFailures([]);
            }}
            data-testid="table-name"
          />
        </Field>
        <Field label={t('ui.table.field.displayName')} htmlFor="table-display-name">
          <input id="table-display-name" className="sc-text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} data-testid="table-display-name" />
        </Field>
        {args.mode === 'rename' && <p className="sc-form-info">{t('ui.table.renameNote')}</p>}
      </div>
    </DialogFrame>
  );
}

export interface TableDeleteArgs {
  table: number;
}

function referenceText(t: (key: string, params?: Record<string, string | number>) => string, ref: TableReference): string {
  const where = ref.tableName === null ? t('ui.table.ref.base', { column: ref.column }) : `${ref.tableName}.${ref.column}`;
  if (ref.kind === 'ref') return t('ui.table.ref.ref', { where });
  if (ref.kind === 'formula') return t('ui.table.ref.formula', { where });
  return t('ui.table.ref.cellFormula', { where, count: ref.count });
}

function TableDeleteDialog({ store, args, close }: DialogProps<TableDeleteArgs>) {
  const t = useT();
  const locale = useLocale();
  const table = store.table(args.table);
  const project = store.project;
  const [references] = useState(() => (project === null ? [] : findTableReferences(project, args.table)));
  const [failures, setFailures] = useState<string[]>([]);
  const name = table?.display_name === undefined ? (table?.name ?? '') : `${table.display_name} (${table.name})`;

  const submit = () => {
    if (project === null) return;
    const r = store.apply(deleteTable(project, { table: args.table }));
    if (!r.ok) {
      setFailures(r.failures.map((f) => formatInputError(f, locale)));
      return;
    }
    close();
  };

  return (
    <DialogFrame
      title={t('ui.table.deleteTitle')}
      onClose={close}
      width={520}
      testId="table-delete-dialog"
      footer={
        <>
          <button type="button" className="sc-button" onClick={close}>
            {t('ui.dialog.cancel')}
          </button>
          <button type="button" className="sc-button primary danger" onClick={submit} data-testid="table-delete-ok">
            {t('ui.table.delete')}
          </button>
        </>
      }
    >
      <Failures items={failures} />
      <p className="sc-dialog-message">{t('ui.table.deleteMessage', { name })}</p>
      {references.length > 0 && (
        <div className="sc-form-note" data-testid="table-references">
          <div>{t('ui.table.referencedWarning', { count: references.length })}</div>
          <ul className="sc-form-list">
            {references.map((ref, i) => (
              <li key={i}>{referenceText(t, ref)}</li>
            ))}
          </ul>
        </div>
      )}
    </DialogFrame>
  );
}

export const tableFormDialog = defineDialog<TableFormArgs>('table.form', TableFormDialog);
export const tableDeleteDialog = defineDialog<TableDeleteArgs>('table.delete', TableDeleteDialog);
