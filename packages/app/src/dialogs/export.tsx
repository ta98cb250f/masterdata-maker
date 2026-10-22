// 出力のダイアログ（FR-OUT-06、FR-OUT-05、FR-OUT-07）: 出力するテーブルと形式（と版）を選び、出力する。検査エラーがあればエラーを示して出力しない
import type { OutputFormat } from '@masterdata-maker/core';
import { DEFAULT_OUTPUT_FORMAT, isOutputFormat, OUTPUT_FORMATS, parseSemver, resolveProjectPaths } from '@masterdata-maker/core';
import { useState } from 'react';
import { DialogFrame } from '../components/Dialog';
import type { ExportOutcome } from '../store/exportOutput';
import { formatExportError, runExport } from '../store/exportOutput';
import { errorMessage } from '../fs/text';
import { useT } from '../store/hooks';
import { ValidationFailure } from '../store/validation';
import { Field } from './formParts';
import type { DialogProps } from './registry';
import { defineDialog } from './registry';
import './fileDialogs.css';

/** エラーの一覧に出す件数の上限（多すぎると描くのに時間がかかる） */
const MAX_LISTED_ERRORS = 200;

type Phase = { kind: 'select' } | { kind: 'running' } | { kind: 'errors'; lines: string[]; total: number; forceable: boolean } | { kind: 'failed'; message: string };

function ExportDialog({ store, close }: DialogProps<undefined>) {
  const t = useT();
  const tabs = store.tabs();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(tabs.map((tab) => tab.name)));
  const [phase, setPhase] = useState<Phase>({ kind: 'select' });
  // 既定はプロジェクト設定の output.format。選んだ形式はこの出力だけに使う（設定は変えない）
  const [format, setFormat] = useState<OutputFormat>(() =>
    store.project === null ? DEFAULT_OUTPUT_FORMAT : resolveProjectPaths(store.project.config).outputFormat,
  );
  // 出力する版。空欄ならすべてのレコード
  const [version, setVersion] = useState('');
  const project = store.project;
  const source = store.getState().source;
  if (project === null || source === null) return null;
  const paths = resolveProjectPaths(project.config);
  const direct = source.capabilities.directSave;
  const allSelected = selected.size === tabs.length;
  const versionText = version.trim();
  const versionInvalid = versionText !== '' && parseSemver(versionText) === null;

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  };

  const finish = (outcome: ExportOutcome) => {
    switch (outcome.status) {
      case 'errors': {
        const lines = outcome.errors.slice(0, MAX_LISTED_ERRORS).map((d) => formatExportError(store, d));
        setPhase({ kind: 'errors', lines, total: outcome.errors.length, forceable: outcome.forceable });
        return;
      }
      case 'empty':
        setPhase({ kind: 'failed', message: t('ui.export.empty') });
        return;
      case 'written':
        close();
        if (outcome.failed.length > 0) {
          store.openDialog('message', {
            titleKey: 'ui.export.writeFailedTitle',
            items: outcome.failed.map((f) => `${f.path}: ${f.message}`),
            tone: 'error',
          });
        } else {
          store.showStatus(t('ui.export.written', { count: outcome.files.length, dir: outcome.outDir === '' ? '.' : `${outcome.outDir}/` }));
        }
        return;
      case 'downloaded':
        close();
        store.showStatus(t('ui.export.downloaded', { name: outcome.name, count: outcome.files.length }));
        return;
    }
  };

  const run = async (force: boolean) => {
    setPhase({ kind: 'running' });
    try {
      finish(
        await runExport(store, {
          tables: tabs.filter((tab) => selected.has(tab.name)).map((tab) => tab.name),
          force,
          format,
          version: versionText === '' ? undefined : versionText,
        }),
      );
    } catch (e) {
      setPhase({ kind: 'failed', message: e instanceof ValidationFailure ? t(e.code, e.params) : t('ui.export.failed', { message: errorMessage(e) }) });
    }
  };

  const running = phase.kind === 'running';
  const footer =
    phase.kind === 'errors' ? (
      <>
        <button type="button" className="sc-button" onClick={() => setPhase({ kind: 'select' })} data-testid="export-back">
          {t('ui.export.back')}
        </button>
        {/* 強制しても出力できないエラー（protobuf の名前。P-63）だけなら、押しても同じエラーになるので出さない */}
        {phase.forceable && (
          <button type="button" className="sc-button primary danger" onClick={() => void run(true)} data-testid="export-force">
            {t('ui.export.force')}
          </button>
        )}
      </>
    ) : (
      <>
        <button type="button" className="sc-button" onClick={close}>
          {t('ui.dialog.cancel')}
        </button>
        <button type="button" className="sc-button primary" disabled={running || selected.size === 0 || versionInvalid} onClick={() => void run(false)} data-testid="export-run">
          {t(running ? 'ui.export.running' : 'ui.export.run')}
        </button>
      </>
    );

  return (
    <DialogFrame title={t('ui.export.title')} onClose={close} width={560} testId="export-dialog" footer={footer}>
      {phase.kind === 'errors' ? (
        <div data-testid="export-errors">
          <p className="sc-dialog-message">{t('ui.export.hasErrors', { count: phase.total })}</p>
          <ul className="sc-dialog-list error sc-fd-scroll">
            {phase.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          {phase.total > phase.lines.length && <p className="sc-fd-note">{t('ui.export.moreErrors', { count: phase.total - phase.lines.length })}</p>}
          {!phase.forceable && (
            <p className="sc-fd-note" data-testid="export-cannot-force">
              {t('ui.export.cannotForce')}
            </p>
          )}
        </div>
      ) : (
        <>
          <p className="sc-dialog-message">
            {direct
              ? t('ui.export.toFolder', { dir: paths.outDir === '' ? '.' : `${paths.outDir}/` })
              : t('ui.export.toDownload')}
          </p>
          <Field label={t('ui.export.format')} htmlFor="export-format" hint={format === 'protobuf' ? t('ui.export.protobufHint') : undefined}>
            <select
              id="export-format"
              className="sc-select"
              value={format}
              disabled={running}
              onChange={(e) => {
                if (isOutputFormat(e.target.value)) setFormat(e.target.value);
              }}
              data-testid="export-format"
            >
              {OUTPUT_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {t(`ui.export.formatName.${f}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t('ui.export.version')}
            htmlFor="export-version"
            hint={versionInvalid ? undefined : t('ui.export.versionHint')}
            error={versionInvalid ? t('ui.export.versionInvalid') : undefined}
            testId="export-version-field"
          >
            <input
              id="export-version"
              className="sc-text mono"
              value={version}
              placeholder={t('ui.export.versionPlaceholder')}
              spellCheck={false}
              disabled={running}
              aria-invalid={versionInvalid}
              onChange={(e) => setVersion(e.target.value)}
              data-testid="export-version"
            />
          </Field>
          {store.isProjectModified() && <p className="sc-fd-note">{t('ui.export.includesUnsaved')}</p>}
          <label className="sc-fd-check sc-fd-all">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(tabs.map((tab) => tab.name)))}
              data-testid="export-all"
            />
            {t('ui.export.allTables')}
          </label>
          <div className="sc-fd-scroll sc-fd-tables">
            {tabs.map((tab) => (
              <label key={tab.uid} className="sc-fd-check">
                <input type="checkbox" checked={selected.has(tab.name)} onChange={() => toggle(tab.name)} data-testid={`export-table-${tab.name}`} />
                <span>{tab.label === tab.name ? tab.name : `${tab.label} (${tab.name})`}</span>
                {tab.broken && <span className="sc-fd-badge">{t('ui.sheets.broken')}</span>}
              </label>
            ))}
          </div>
          {phase.kind === 'failed' && (
            <p className="sc-fd-error" role="alert" data-testid="export-failed">
              {phase.message}
            </p>
          )}
        </>
      )}
    </DialogFrame>
  );
}

export const exportDialog = defineDialog<undefined>('export', ExportDialog);
