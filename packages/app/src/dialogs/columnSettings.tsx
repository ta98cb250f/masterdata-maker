// 列の設定のダイアログ（FR-COL-02〜04）。表示名・説明・出力対象・編集可否・列レベル式・既定値・検査ルール・警告条件・
// 列挙型の参照・参照先に加えて、列名の変更（FR-COL-03）と型の変更（FR-COL-04）も行い、全体を 1 回の操作にする。
// 型を変えるときは、変換できない値を先に一覧で示し、承認されてから変換する。共通列は共通設定へ案内する
import type { FieldDef, Table, TypeChangeIssue } from '@sheetcraft/core';
import { checkColumnTypeChange, formatInputError, formatValueText, inputContext } from '@sheetcraft/core';
import { useMemo, useState } from 'react';
import { DialogFrame } from '../components/Dialog';
import { completionColumnsOf } from '../sheet/complete';
import type { AppStore } from '../store/AppStore';
import { useT } from '../store/hooks';
import type { ColumnDraft, DraftKey } from './columnDraft';
import { draftErrors, draftFromField, isEnumType, planColumnChange } from './columnDraft';
import { ColumnForm } from './ColumnForm';
import { Failures, submitOnEnter, useLocale } from './formParts';
import type { DialogProps } from './registry';
import { defineDialog } from './registry';

export interface ColumnSettingsArgs {
  table?: number;
  column?: string;
}

/** 対象の列（args が無ければ表示中のテーブルの選択中の列） */
export function columnTarget(store: AppStore, args?: { table?: number; column?: string }): { table: Table; column: string } | null {
  const uid = args?.table ?? store.getState().activeTable;
  const table = store.table(uid);
  if (table === undefined) return null;
  if (args?.column !== undefined) return { table, column: args.column };
  const sheet = store.sheet(table.uid);
  const sel = store.selection(table.uid);
  const column = sheet === null || sel === null ? undefined : sheet.columns[sel.anchor.col]?.name;
  return column === undefined ? null : { table, column };
}

function ColumnSettingsDialog({ store, args, close }: DialogProps<ColumnSettingsArgs>) {
  const t = useT();
  const [target] = useState(() => {
    const found = columnTarget(store, args);
    if (found === null) return null;
    const base = store.project?.common.base_fields.items.find((f) => f.name === found.column);
    const field = found.table.fields.find((f) => f.name === found.column);
    return { table: found.table, field: field ?? base, base: field === undefined && base !== undefined };
  });
  if (target === null || target.field === undefined) {
    return (
      <DialogFrame
        title={t('ui.column.settingsTitle', { name: args?.column ?? '' })}
        onClose={close}
        testId="column-settings-dialog"
        footer={
          <button type="button" className="sc-button primary" onClick={close}>
            {t('ui.dialog.ok')}
          </button>
        }
      >
        <p className="sc-dialog-message">{t('ui.column.notFound')}</p>
      </DialogFrame>
    );
  }
  if (target.base) return <BaseColumnNotice store={store} field={target.field} close={close} />;
  return <ColumnSettingsForm store={store} table={target.table} field={target.field} close={close} />;
}

/** 共通列は共通設定で変える（ここでは今の設定を見せるだけ） */
function BaseColumnNotice({ store, field, close }: { store: AppStore; field: FieldDef; close(): void }) {
  const t = useT();
  const tz = store.calc?.timeZone ?? 'UTC';
  const lines = [
    t('ui.column.summary.type', { type: field.type }),
    field.display_name === undefined ? null : t('ui.column.summary.displayName', { name: field.display_name }),
    field.primary === true ? t('ui.column.field.primary') : null,
    field.auto !== undefined ? t('ui.column.field.auto') : null,
    (field.editable ?? true) && field.auto === undefined ? null : t('ui.column.summary.readonly'),
    field.default === undefined ? null : t('ui.column.summary.default', { value: formatValueText(field.default, field.type, tz) }),
  ].filter((x): x is string => x !== null);
  return (
    <DialogFrame
      title={t('ui.column.settingsTitle', { name: field.name })}
      onClose={close}
      width={480}
      testId="column-settings-dialog"
      footer={
        <>
          <button type="button" className="sc-button" onClick={close}>
            {t('ui.column.close')}
          </button>
          <button
            type="button"
            className="sc-button primary"
            onClick={() => {
              close();
              void store.run('settings.common', { tab: 'base_fields', field: field.name });
            }}
            data-testid="open-common-settings"
          >
            {t('ui.column.openCommonSettings')}
          </button>
        </>
      }
    >
      <p className="sc-dialog-message" data-testid="base-column-notice">
        {t('ui.column.baseNotice', { name: field.name })}
      </p>
      <ul className="sc-dialog-list">
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </DialogFrame>
  );
}

function ColumnSettingsForm({ store, table, field, close }: { store: AppStore; table: Table; field: FieldDef; close(): void }) {
  const t = useT();
  const locale = useLocale();
  const tz = store.calc?.timeZone ?? 'UTC';
  const [initial] = useState<ColumnDraft>(() => draftFromField(field, tz));
  const [draft, setDraft] = useState<ColumnDraft>(initial);
  const [attempted, setAttempted] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  const [issues, setIssues] = useState<TypeChangeIssue[] | null>(null);
  const project = store.project;
  const errors = useMemo(() => (project === null ? {} : draftErrors(field, initial, draft, inputContext(project))), [project, field, initial, draft]);
  const columns = useMemo(() => completionColumnsOf(store.calc?.columns(table) ?? []), [store, table]);

  const onChange = (patch: Partial<ColumnDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setFailures([]);
    if (patch.type !== undefined) setIssues(null);
  };
  const showError = (k: DraftKey) => attempted || draft[k] !== initial[k];

  const issueText = (issue: TypeChangeIssue): string => {
    const message = formatInputError(issue.error, locale);
    if (issue.record === undefined) return t('ui.column.typeIssueDefault', { message });
    const sheet = store.sheet(table.uid);
    const record = table.records.find((r) => r.uid === issue.record);
    const key = record === undefined ? undefined : store.calc?.recordKey(table, record);
    const row = sheet === null ? 0 : sheet.rowOf(issue.record) + 1;
    return t('ui.column.typeIssueRow', { row: row > 0 ? row : '-', key: key ?? t('ui.formulaBar.noKey'), message });
  };

  const submit = (confirmed: boolean) => {
    setAttempted(true);
    const session = store.session;
    if (project === null || session === null || Object.keys(errors).length > 0) return;
    const current = table.fields.find((f) => f.name === field.name);
    if (current === undefined) {
      setFailures([t('ui.column.notFound')]);
      return;
    }
    if (draft.type !== current.type && !confirmed) {
      const enumRef = isEnumType(draft.type) && draft.enum_ref !== '' ? draft.enum_ref : undefined;
      const check = checkColumnTypeChange(project, { table: table.uid, column: current.name, type: draft.type, enum_ref: enumRef });
      if (!check.ok) {
        setFailures(check.failures.map((f) => formatInputError(f, locale)));
        return;
      }
      if (check.issues.length > 0) {
        setIssues(check.issues);
        return;
      }
    }
    const plan = planColumnChange(project, { table: table.uid, original: current, initial, draft, locale });
    const r = session.applyGroup(plan.label, plan.steps);
    if (!r.ok) {
      // 途中まで当てて戻したので、計算のキャッシュを捨てておく
      store.calc?.invalidateAll();
      setIssues(null);
      setFailures(r.failures.map((f) => formatInputError(f, locale)));
      return;
    }
    close();
  };

  const footer =
    issues !== null ? (
      <>
        <button type="button" className="sc-button" onClick={() => setIssues(null)} data-testid="type-change-back">
          {t('ui.column.back')}
        </button>
        <button type="button" className="sc-button primary" onClick={() => submit(true)} data-testid="type-change-confirm">
          {t('ui.column.convert')}
        </button>
      </>
    ) : (
      <>
        <button type="button" className="sc-button" onClick={close}>
          {t('ui.dialog.cancel')}
        </button>
        <button type="button" className="sc-button primary" onClick={() => submit(false)} data-testid="column-settings-ok">
          {t('ui.dialog.ok')}
        </button>
      </>
    );

  return (
    <DialogFrame title={t('ui.column.settingsTitle', { name: field.name })} onClose={close} width={680} testId="column-settings-dialog" footer={footer}>
      <div onKeyDown={submitOnEnter(() => submit(issues !== null))}>
        <Failures items={failures} testId="column-settings-failures" />
        {issues !== null && (
          <div className="sc-form-note" data-testid="type-change-issues">
            <div>{t('ui.column.typeIssuesMessage', { type: draft.type, count: issues.length })}</div>
            <ul className="sc-form-list">
              {issues.map((issue, i) => (
                <li key={i}>{issueText(issue)}</li>
              ))}
            </ul>
          </div>
        )}
        <ColumnForm store={store} draft={draft} errors={errors} showError={showError} onChange={onChange} columns={columns} mode="table" />
      </div>
    </DialogFrame>
  );
}

export const columnSettingsDialog = defineDialog<ColumnSettingsArgs>('column.settings', ColumnSettingsDialog);
