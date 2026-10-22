// セル情報パネル（FR-UI-07。右側）: 選択中のセルの位置・列・値の出どころ（値／セル単位式／列レベル式／既定値／未入力）と式・
// 実効値・セル色・メモ・検査のメッセージ
import type { CellSource } from '@masterdata-maker/core';
import { RichCell, cellValue, formatDiagnostic, formatMessage, formatValueText, isEmptyValue } from '@masterdata-maker/core';
import type { ReactNode } from 'react';
import { cellDisplay } from '../sheet/display';
import { useAppState, useT } from '../store/hooks';
import '../styles/cellInfoPanel.css';
import type { PanelDef, PanelProps } from './registry';

const SOURCE_KEYS: Readonly<Record<CellSource, string>> = {
  value: 'ui.cellInfo.source.value',
  override: 'ui.cellInfo.source.override',
  formula: 'ui.cellInfo.source.formula',
  default: 'ui.cellInfo.source.default',
  empty: 'ui.cellInfo.source.empty',
};

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="sc-cellinfo-row" data-testid={testId}>
      <div className="sc-cellinfo-label">{label}</div>
      <div className="sc-cellinfo-value">{children}</div>
    </div>
  );
}

function CellInfoPanel({ store }: PanelProps) {
  const t = useT();
  useAppState((s) => s.revision);
  useAppState((s) => s.validation.version);
  const locale = useAppState((s) => s.locale);
  const active = useAppState((s) => s.activeTable);
  const anchor = useAppState((s) => (s.activeTable === null ? null : (s.views.get(s.activeTable)?.selection.anchor ?? null)));
  const sheet = store.sheet(active);
  const calc = store.calc;
  const project = store.project;
  if (sheet === null || calc === null || project === null || sheet.size.rows === 0 || sheet.size.cols === 0) {
    return <div className="sc-cellinfo-empty">{t('ui.cellInfo.noCell')}</div>;
  }
  const pos = anchor ?? { row: 0, col: 0 };
  const record = sheet.recordAt(Math.min(pos.row, sheet.size.rows - 1));
  const column = sheet.columns[Math.min(pos.col, sheet.size.cols - 1)];
  if (record === undefined || column === undefined) return <div className="sc-cellinfo-empty">{t('ui.cellInfo.noCell')}</div>;
  const field = column.field;
  const cell = record.cells.get(column.name);
  const rich = cell instanceof RichCell ? cell : undefined;
  const result = calc.getCell(sheet.table, record.uid, column.name);
  const display = cellDisplay(result, field, calc.timeZone);
  const key = calc.recordKey(sheet.table, record);
  const value = cellValue(cell);
  // 値が優先されて使われていないセル単位式
  const hiddenOverride = rich?.override !== undefined && rich.override !== '' && !isEmptyValue(value) ? rich.override : undefined;
  let formula: string | undefined;
  if (result.source === 'override') formula = rich?.override;
  else if (result.source === 'formula') formula = field.formula;
  const color = rich?.color === undefined ? undefined : project.common.colors.items.find((c) => c.key === rich.color);
  const diagnostics = (store.issues(sheet.table.name)?.diagnostics ?? []).filter((d) => d.recordUid === record.uid && d.field === column.name);
  const effective =
    result.error !== undefined
      ? `${result.error.code} — ${formatMessage(result.error.messageCode, result.error.messageArgs, locale)}`
      : field.type === 'bool' && typeof result.raw === 'boolean'
        ? formatValueText(result.raw, 'bool', calc.timeZone)
        : display.text;

  return (
    <div className="sc-cellinfo" data-testid="cell-info-panel">
      <Row label={t('ui.cellInfo.location')} testId="cell-info-location">
        {`${sheet.table.name} / ${column.name} / ${key ?? t('ui.formulaBar.noKey')}`}
      </Row>
      <Row label={t('ui.cellInfo.column')}>
        {field.display_name === undefined ? field.name : `${field.display_name} (${field.name})`} <span className="sc-cellinfo-type">{field.type}</span>
      </Row>
      <Row label={t('ui.cellInfo.source')} testId="cell-info-source">
        <span className={`sc-cellinfo-source ${result.source}`}>{t(SOURCE_KEYS[result.source])}</span>
        {formula !== undefined && <code className="sc-cellinfo-formula" data-testid="cell-info-formula">{`=${formula}`}</code>}
        {hiddenOverride !== undefined && (
          <div className="sc-cellinfo-note">
            {t('ui.cellInfo.hiddenOverride')} <code className="sc-cellinfo-formula">{`=${hiddenOverride}`}</code>
          </div>
        )}
      </Row>
      <Row label={t('ui.cellInfo.value')} testId="cell-info-value">
        <span className={result.error !== undefined ? 'sc-cellinfo-error' : undefined}>{effective === '' ? t('ui.cellInfo.none') : effective}</span>
      </Row>
      <Row label={t('ui.cellInfo.color')} testId="cell-info-color">
        {rich?.color === undefined ? (
          t('ui.cellInfo.none')
        ) : (
          <span className="sc-inline">
            <span className="sc-cellinfo-swatch" style={{ background: color?.color ?? 'transparent' }} />
            {color === undefined ? t('ui.cellInfo.unknownColor', { key: rich.color }) : `${color.label ?? color.key} (${color.key})`}
          </span>
        )}
      </Row>
      <Row label={t('ui.cellInfo.note')} testId="cell-info-note">
        {rich?.comment === undefined || rich.comment === '' ? t('ui.cellInfo.none') : <div className="sc-cellinfo-comment">{rich.comment}</div>}
      </Row>
      <Row label={t('ui.cellInfo.issues')} testId="cell-info-issues">
        {diagnostics.length === 0 ? (
          t('ui.cellInfo.noIssues')
        ) : (
          <ul className="sc-cellinfo-issues">
            {diagnostics.map((d, i) => (
              <li key={i} className={d.severity}>
                {formatDiagnostic(d, locale)}
              </li>
            ))}
          </ul>
        )}
      </Row>
    </div>
  );
}

export const cellInfoPanel: PanelDef = {
  id: 'cellInfo',
  titleKey: 'ui.cellInfo.title',
  position: 'right',
  component: CellInfoPanel,
  size: 300,
  menu: { group: 50, order: 1 },
};
