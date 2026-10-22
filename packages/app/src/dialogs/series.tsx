// 連番入力（FR-FIL-05）: 開始値と増分を入れて選択範囲を埋める（core の fillSeriesCells）。
// 複数の行を選んでいれば列ごとに上から下へ、1 行だけなら左から右へ埋める。datetime の列では増分は日数（P-15）
import type { CellTarget } from '@masterdata-maker/core';
import { EditCode, fillSeriesCells, formatValueText } from '@masterdata-maker/core';
import { useState } from 'react';
import { selectionTarget } from '../commands/helpers';
import { DialogFrame } from '../components/Dialog';
import type { AppStore } from '../store/AppStore';
import { useT } from '../store/hooks';
import { Failures, Field, submitOnEnter } from './formParts';
import type { DialogProps } from './registry';
import { defineDialog } from './registry';

export interface SeriesTarget {
  table: number;
  /** 1 つの連番で埋めるセルの並び（列ごと、または 1 行の左から右） */
  groups: CellTarget[][];
  /** 先頭のセルの値（開始値の初期値） */
  start: string;
  datetime: boolean;
}

export function seriesTarget(store: AppStore): SeriesTarget | null {
  const t = selectionTarget(store);
  if (t === null || t.records.length === 0 || t.columns.length === 0) return null;
  const groups =
    t.records.length > 1
      ? t.columns.map((column) => t.records.map((record) => ({ record, column })))
      : [t.columns.map((column) => ({ record: t.records[0], column }))];
  const first = groups[0][0];
  const field = t.sheet.columns[t.sheet.colOf(first.column)]?.field;
  const raw = t.calc.getCell(t.table, first.record, first.column).raw;
  let start = '1';
  if (field !== undefined && (typeof raw === 'number' || typeof raw === 'bigint' || (typeof raw === 'string' && field.type === 'datetime'))) {
    start = formatValueText(raw, field.type, t.calc.timeZone);
  }
  return { table: t.table.uid, groups, start, datetime: field?.type === 'datetime' };
}

function SeriesDialog({ store, close }: DialogProps<void>) {
  const t = useT();
  const [target] = useState(() => seriesTarget(store));
  const [start, setStart] = useState(target?.start ?? '1');
  const [step, setStep] = useState('1');
  const [failures, setFailures] = useState<string[]>([]);

  const submit = () => {
    const session = store.session;
    if (target === null || session === null) return;
    const r = session.applyGroup(
      EditCode.opSeries,
      target.groups.map((cells) => (p) => fillSeriesCells(p, { table: target.table, cells, start, step })),
    );
    if (!r.ok) {
      store.calc?.invalidateAll();
      setFailures(store.formatFailures(r.failures));
      return;
    }
    close();
  };

  return (
    <DialogFrame
      title={t('ui.series.title')}
      onClose={close}
      width={440}
      testId="series-dialog"
      footer={
        <>
          <button type="button" className="sc-button" onClick={close}>
            {t('ui.dialog.cancel')}
          </button>
          <button type="button" className="sc-button primary" onClick={submit} disabled={target === null} data-testid="series-ok">
            {t('ui.dialog.ok')}
          </button>
        </>
      }
    >
      <div className="sc-form" onKeyDown={submitOnEnter(submit)}>
        <Failures items={failures} testId="series-failures" />
        {target === null && <p className="sc-form-info">{t('ui.series.noSelection')}</p>}
        <p className="sc-form-info">
          {target !== null && t('ui.series.cells', { count: target.groups.reduce((n, g) => n + g.length, 0), groups: target.groups.length })}
        </p>
        <Field label={t('ui.series.start')} htmlFor="series-start">
          <input id="series-start" className="sc-text" value={start} onChange={(e) => setStart(e.target.value)} data-testid="series-start" />
        </Field>
        <Field label={t('ui.series.step')} htmlFor="series-step" hint={target?.datetime === true ? t('ui.series.stepDays') : undefined}>
          <input id="series-step" className="sc-text" value={step} onChange={(e) => setStep(e.target.value)} data-testid="series-step" />
        </Field>
      </div>
    </DialogFrame>
  );
}

export const seriesDialog = defineDialog<void>('fill.series', SeriesDialog);
