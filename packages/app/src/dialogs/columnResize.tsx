// 列のサイズを変更（FR-COL-06 をキーボードだけでも行う。NFR-40）。Googleスプレッドシートの列ヘッダーの右クリックの「列のサイズを変更」と
// 同じく、ピクセル数を入れるか、既定の幅に戻すかを選ぶ。選んだ列すべてに同じ幅を当て、1 回の操作で元に戻せる（core の setColumnWidth）
import { DEFAULT_COLUMN_WIDTH, setColumnWidth } from '@sheetcraft/core';
import { useState } from 'react';
import { DialogFrame } from '../components/Dialog';
import { MIN_COLUMN_WIDTH } from '../grid/layout';
import { useT } from '../store/hooks';
import { Failures, submitOnEnter } from './formParts';
import type { DialogProps } from './registry';
import { defineDialog } from './registry';

export interface ColumnResizeArgs {
  uid: number;
  /** 幅を変える列の列名（表示中の列） */
  columns: string[];
}

/** 入れられる幅の上限（打ち間違いで極端に広い列にならないように。ドラッグには上限は無い） */
export const MAX_COLUMN_WIDTH = 2000;

/** 一覧に名前を出す列の数 */
const LISTED = 5;

/** 入力した幅を整数にする（全角の数字も受け付ける）。範囲の外・整数でなければ null */
export function parseColumnWidth(text: string): number | null {
  const s = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= MIN_COLUMN_WIDTH && n <= MAX_COLUMN_WIDTH ? n : null;
}

function ColumnResizeDialog({ store, args, close }: DialogProps<ColumnResizeArgs>) {
  const t = useT();
  const sheet = store.sheet(args.uid);
  const columns = (sheet?.columns ?? []).filter((c) => args.columns.includes(c.name));
  const widths = [...new Set(columns.map((c) => c.width))];
  const [mode, setMode] = useState<'pixels' | 'default'>('pixels');
  const [text, setText] = useState(String(widths[0] ?? DEFAULT_COLUMN_WIDTH));
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<string[]>([]);

  const label = (c: (typeof columns)[number]) => (c.field.display_name === undefined ? c.name : `${c.field.display_name} (${c.name})`);
  const title =
    columns.length === 1 ? t('ui.colResize.titleOne', { column: label(columns[0]) }) : t('ui.colResize.titleMany', { count: columns.length });
  const names = columns.slice(0, LISTED).map((c) => c.name).join(', ');
  const more = columns.length - LISTED;

  const submit = () => {
    const project = store.project;
    if (project === null || columns.length === 0) return;
    let width = DEFAULT_COLUMN_WIDTH;
    if (mode === 'pixels') {
      const parsed = parseColumnWidth(text);
      if (parsed === null) {
        setError(t('ui.colResize.invalid', { min: MIN_COLUMN_WIDTH, max: MAX_COLUMN_WIDTH }));
        return;
      }
      width = parsed;
    }
    const r = setColumnWidth(project, { table: args.uid, columns: columns.map((c) => c.name), width });
    if (!r.ok) {
      setFailures(store.formatFailures(r.failures));
      return;
    }
    close();
    store.applyOrReport(r);
  };

  return (
    <DialogFrame
      title={title}
      onClose={close}
      width={420}
      testId="column-resize-dialog"
      footer={
        <>
          <button type="button" className="sc-button" onClick={close}>
            {t('ui.dialog.cancel')}
          </button>
          <button type="button" className="sc-button primary" onClick={submit} disabled={columns.length === 0} data-testid="column-resize-ok">
            {t('ui.dialog.ok')}
          </button>
        </>
      }
    >
      <div className="sc-form" onKeyDown={submitOnEnter(submit)}>
        <Failures items={failures} testId="column-resize-failures" />
        {columns.length > 1 && (
          <p className="sc-form-info" data-testid="column-resize-columns">
            {more > 0 ? t('ui.colResize.columnsMore', { names, count: more }) : t('ui.colResize.columns', { names })}
          </p>
        )}
        <label className="sc-check">
          <input type="radio" name="column-resize-mode" checked={mode === 'pixels'} onChange={() => setMode('pixels')} data-testid="column-resize-pixels" />
          <span>{t('ui.colResize.pixels')}</span>
        </label>
        <div className="sc-inline" style={{ marginLeft: 24, maxWidth: 200 }}>
          <input
            className={`sc-text${error !== null ? ' invalid' : ''}`}
            inputMode="numeric"
            value={text}
            aria-label={t('ui.colResize.pixels')}
            aria-invalid={error !== null}
            data-autofocus=""
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setText(e.target.value);
              setMode('pixels');
              setError(null);
            }}
            data-testid="column-resize-width"
          />
          <span>{t('ui.colResize.unit')}</span>
        </div>
        {error !== null && (
          <div className="sc-field-error" role="alert" style={{ marginLeft: 24 }} data-testid="column-resize-error">
            {error}
          </div>
        )}
        <label className="sc-check">
          <input type="radio" name="column-resize-mode" checked={mode === 'default'} onChange={() => setMode('default')} data-testid="column-resize-default" />
          <span>{t('ui.colResize.default', { width: DEFAULT_COLUMN_WIDTH })}</span>
        </label>
      </div>
    </DialogFrame>
  );
}

export const columnResizeDialog = defineDialog<ColumnResizeArgs>('column.resize', ColumnResizeDialog);
