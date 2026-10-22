// 数式バー（FR-UI-02）とセル位置の表示（FR-UI-03。入力による移動は NameBox）。式の入力補完（FR-EDT-07）は FormulaAssist。
// 値のセルは編集用のテキスト、セル単位式のセルは `=hp*2` のような式、列レベル式に従うセルは列の式を「列の式」と区別して出す
import type { KeyboardEvent } from 'react';
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { AdvanceKey } from '@masterdata-maker/core';
import { cellEditText, cellValue, formatValueText, isEmptyValue, resolveShortcut } from '@masterdata-maker/core';
import { completionColumnsOf } from '../sheet/complete';
import { useAppState, useStore, useT } from '../store/hooks';
import type { FormulaAssistHandle } from './FormulaAssist';
import { FormulaAssist } from './FormulaAssist';
import { NameBox } from './NameBox';

const ADVANCE: Readonly<Record<string, AdvanceKey>> = { enter: 'enter', shiftEnter: 'shiftEnter', tab: 'tab', shiftTab: 'shiftTab' };

interface CellInfo {
  location: string;
  /** 編集用のテキスト */
  text: string;
  /** 中身が無いときに薄く出すもの（列の式・既定値） */
  placeholder: string;
  badge: 'columnFormula' | 'default' | null;
  readonly: boolean;
}

export function FormulaBar() {
  const store = useStore();
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const assistRef = useRef<FormulaAssistHandle>(null);
  const composing = useRef(false);
  useAppState((s) => s.revision);
  const active = useAppState((s) => s.activeTable);
  const anchor = useAppState((s) => (s.activeTable === null ? null : (s.views.get(s.activeTable)?.selection.anchor ?? null)));
  const editing = useAppState((s) => s.editing);
  const sheet = store.sheet(active);
  const calc = store.calc;

  let info: CellInfo | null = null;
  if (sheet !== null && calc !== null && sheet.size.rows > 0 && sheet.size.cols > 0) {
    const pos = anchor ?? { row: 0, col: 0 };
    const record = sheet.recordAt(Math.min(pos.row, sheet.size.rows - 1));
    const column = sheet.columns[Math.min(pos.col, sheet.size.cols - 1)];
    if (record !== undefined && column !== undefined) {
      const cell = record.cells.get(column.name);
      const key = sheet.primary === undefined ? undefined : calc.getCell(sheet.table, record.uid, sheet.primary.name).raw;
      const keyText = key === undefined ? t('ui.formulaBar.noKey') : formatValueText(key, sheet.primary?.type ?? 'string', calc.timeZone);
      const text = cellEditText(cell, column.field, calc.timeZone);
      let placeholder = '';
      let badge: CellInfo['badge'] = null;
      if (text === '' && isEmptyValue(cellValue(cell))) {
        if (column.formula) {
          placeholder = `=${column.field.formula}`;
          badge = 'columnFormula';
        } else if (column.field.default !== undefined) {
          placeholder = formatValueText(column.field.default, column.field.type, calc.timeZone);
          badge = 'default';
        }
      }
      info = { location: `${sheet.table.name} / ${column.name} / ${keyText}`, text, placeholder, badge, readonly: !column.editable };
    }
  }

  const barEditing = editing !== null && editing.origin === 'formulaBar';
  const completionColumns = useMemo(() => completionColumnsOf(sheet?.allColumns ?? []), [sheet]);
  const value = editing !== null ? editing.text : (info?.text ?? '');

  // 複数行の中身に合わせて高さを変える（最大 6 行）
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(6 * 20, Math.max(20, el.scrollHeight))}px`;
  }, [value, barEditing]);

  const onFocus = () => {
    const current = store.getState().editing;
    if (current !== null) {
      // セルで編集中なら、数式バーで続ける
      if (current.origin === 'cell') store.setState({ editing: { ...current, origin: 'formulaBar', mode: 'edit' } });
      return;
    }
    if (info === null || info.readonly) return;
    store.beginEdit({ origin: 'formulaBar', mode: 'edit' });
  };

  const finish = () => {
    store.focusGrid();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229) return;
    // 式の入力補完が出ていれば、↑↓・Tab・Enter はそちらで使う（FR-EDT-07）
    if (assistRef.current?.handleKey(e) === true) {
      e.preventDefault();
      return;
    }
    const id = resolveShortcut(e.nativeEvent, store.platform, 'edit');
    if (id !== null && ADVANCE[id] !== undefined) {
      e.preventDefault();
      if (store.getState().editing === null || store.commitEdit(ADVANCE[id])) finish();
      return;
    }
    if (id === 'cancel') {
      e.preventDefault();
      store.cancelEdit();
      finish();
      return;
    }
    if (id === 'newlineInCell') {
      e.preventDefault();
      const el = e.currentTarget;
      el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end');
      store.setEditText(el.value);
      return;
    }
    if (id === 'save') {
      e.preventDefault();
      void store.save();
    }
  };

  return (
    <div className="sc-formulabar" data-region="formulaBar">
      <NameBox location={info?.location ?? ''} />
      <div className="sc-fx-label">fx</div>
      {info?.badge !== null && info?.badge !== undefined && editing === null && (
        <span className={`sc-badge ${info.badge}`} data-testid="formula-badge">
          {t(info.badge === 'columnFormula' ? 'ui.formulaBar.columnFormula' : 'ui.formulaBar.default')}
        </span>
      )}
      <textarea
        ref={ref}
        className={`sc-formula-input${info?.badge === 'columnFormula' ? ' column-formula' : ''}`}
        rows={1}
        spellCheck={false}
        value={value}
        placeholder={editing === null ? info?.placeholder : ''}
        readOnly={info === null || (info.readonly && editing === null)}
        aria-label={t('ui.formulaBar.label')}
        data-testid="formula-input"
        onFocus={onFocus}
        onChange={(e) => store.setEditText(e.target.value)}
        onKeyDown={onKeyDown}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
      />
      {barEditing && editing.text.startsWith('=') && (
        <FormulaAssist ref={assistRef} inputRef={ref} text={editing.text} columns={completionColumns} requireEquals />
      )}
      {barEditing && editing.error !== null && (
        <div className="sc-edit-error formula" role="alert" data-testid="formula-error">
          <div className="sc-edit-error-message">{editing.error.message}</div>
          {editing.error.hint !== '' && <div className="sc-edit-error-hint">{editing.error.hint}</div>}
        </div>
      )}
    </div>
  );
}
