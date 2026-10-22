// グリッドの入力欄。グリッドがフォーカスを持っている間は、この見えない textarea に常にフォーカスを置く。
// 文字を打つ・IME の変換を始めると、同じ textarea をそのままセルの上の入力欄にする（IME が途切れない。FR-EDT-01）。
// コピー・切り取り・貼り付けは、この textarea の copy / cut / paste のイベントで行う（FR-CLP-01〜02）
import type { AdvanceKey, Direction } from '@masterdata-maker/core';
import { resolveShortcut } from '@masterdata-maker/core';
import type { ClipboardEvent, KeyboardEvent, RefObject } from 'react';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { toggleCheckboxes } from '../commands/edit';
import type { FormulaAssistHandle } from '../components/FormulaAssist';
import { FormulaAssist } from '../components/FormulaAssist';
import { completionColumnsOf } from '../sheet/complete';
import type { SheetModel } from '../sheet/model';
import type { AppStore } from '../store/AppStore';
import { useAppState, useT } from '../store/hooks';
import { copySelection, pasteText } from './clipboard';
import type { AssistHandle } from './EditorAssist';
import { EditorAssist, assistKindOf } from './EditorAssist';
import type { GridGeometry, ScrollPos, ViewportSize } from './layout';

const ARROWS: Readonly<Record<string, Direction>> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const ADVANCE: Readonly<Record<string, AdvanceKey>> = { enter: 'enter', shiftEnter: 'shiftEnter', tab: 'tab', shiftTab: 'shiftTab' };
const FONT = '13px Arial, Helvetica, sans-serif';
const PADDING = 8;

let measureContext: CanvasRenderingContext2D | null | undefined;

/** テキストの行のうち一番長い行の幅 */
function textWidth(text: string): number {
  if (measureContext === undefined) {
    measureContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    if (measureContext !== null) measureContext.font = FONT;
  }
  if (measureContext === null) return text.length * 7;
  let max = 0;
  for (const line of text.split('\n')) max = Math.max(max, measureContext.measureText(line).width);
  return max;
}

function isPrintableKey(e: KeyboardEvent): boolean {
  return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
}

export interface CellInputProps {
  store: AppStore;
  sheet: SheetModel;
  geometry: GridGeometry;
  scroll: ScrollPos;
  viewport: ViewportSize;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

export function CellInput({ store, sheet, geometry, scroll, viewport, inputRef }: CellInputProps) {
  const t = useT();
  const uid = sheet.table.uid;
  const editing = useAppState((s) => (s.editing !== null && s.editing.table === uid ? s.editing : null));
  const anchor = useAppState((s) => s.views.get(uid)?.selection.anchor ?? { row: 0, col: 0 });
  /** textarea の中身として最後に知っているテキスト（store との同期に使う） */
  const localText = useRef('');
  const composing = useRef(false);
  const assistRef = useRef<AssistHandle>(null);
  const formulaAssistRef = useRef<FormulaAssistHandle>(null);
  const cellEditing = editing !== null && editing.origin === 'cell';
  const pos = cellEditing ? editing.pos : anchor;
  const col = Math.min(pos.col, Math.max(0, sheet.columns.length - 1));
  const column = sheet.columns[col];
  const x = geometry.colCanvasX(col, scroll.left);
  const y = geometry.rowY(pos.row);
  const cellWidth = geometry.cols.size(col);
  const editingText = cellEditing ? editing.text : '';

  // store のテキストと textarea の中身を合わせる（入力部品で選んだときなど）。打った文字は input のイベントで store に入れる
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el === null || composing.current) return;
    if (!cellEditing) {
      if (el.value !== '') el.value = '';
      localText.current = '';
      return;
    }
    if (editingText !== localText.current) {
      el.value = editingText;
      localText.current = editingText;
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [cellEditing, editingText, inputRef]);

  // 入力欄の大きさを中身に合わせる（右へ広げ、表示領域の右端で折り返す）
  const maxWidth = Math.max(cellWidth, viewport.width - geometry.colViewportX(col, scroll.left) - 4);
  const width = cellEditing ? Math.min(maxWidth, Math.max(cellWidth, Math.ceil(textWidth(editingText)) + PADDING * 2)) : cellWidth;
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el === null) return;
    if (!cellEditing) {
      el.style.height = `${geometry.rowHeight}px`;
      return;
    }
    el.style.height = '0px';
    el.style.height = `${Math.max(geometry.rowHeight, el.scrollHeight)}px`;
  }, [cellEditing, editingText, width, geometry.rowHeight, inputRef]);

  // 式（= で始まる）の入力中は部品を出さない
  const isFormula = editingText.startsWith('=');
  // 式の入力補完の候補（FR-EDT-07）
  const formulaColumns = useMemo(() => completionColumnsOf(sheet.allColumns), [sheet]);
  const field = column?.field;
  const assist = useMemo(() => {
    const calc = store.calc;
    if (!cellEditing || calc === null || field === undefined || isFormula) return null;
    return assistKindOf(calc, field);
  }, [cellEditing, field, isFormula, store]);

  const commit = (advance: AdvanceKey | Direction | null) => {
    store.commitEdit(advance);
  };

  const onGridKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const id = resolveShortcut(e.nativeEvent, store.platform, 'grid');
    const def = id === null ? undefined : store.commands.byShortcut(id);
    if (def !== undefined) {
      if (def.native !== undefined) {
        // コピー・切り取り・貼り付けはブラウザの既定の動作に任せる（copy / cut / paste のイベントが来る）
        def.native.before?.(store);
        return;
      }
      e.preventDefault();
      void store.run(def.id);
      return;
    }
    // bool の列では Space でチェックボックスを切り替える
    if (e.key === ' ' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && toggleCheckboxes(store)) {
      e.preventDefault();
      return;
    }
    // 文字のキー: 上書きの編集を始める。文字は textarea にそのまま入る（input のイベントで store に入れる）
    if (isPrintableKey(e) && !store.beginEdit({ mode: 'overwrite', text: '' })) e.preventDefault();
  };

  const onEditKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (assistRef.current?.handleKey(e) === true || formulaAssistRef.current?.handleKey(e) === true) {
      e.preventDefault();
      return;
    }
    const id = resolveShortcut(e.nativeEvent, store.platform, 'edit');
    if (id !== null && ADVANCE[id] !== undefined) {
      e.preventDefault();
      commit(ADVANCE[id]);
      return;
    }
    if (id === 'cancel') {
      e.preventDefault();
      store.cancelEdit();
      return;
    }
    if (id === 'newlineInCell') {
      e.preventDefault();
      const el = e.currentTarget;
      el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end');
      localText.current = el.value;
      store.setEditText(el.value);
      return;
    }
    if (id === 'save') {
      e.preventDefault();
      void store.save();
      return;
    }
    // 文字を打って始めた編集では、矢印キーで確定して移動する（Googleスプレッドシートと同じ）
    const dir = ARROWS[e.key];
    if (dir !== undefined && editing?.mode === 'overwrite' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      commit(dir);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME の変換中のキーは IME に任せる
    if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229) return;
    const current = store.getState().editing;
    if (current !== null && current.origin === 'cell') onEditKey(e);
    else if (current === null) onGridKey(e);
  };

  const onInput = () => {
    const el = inputRef.current;
    if (el === null) return;
    localText.current = el.value;
    const current = store.getState().editing;
    if (current === null) {
      // 打った文字（キー操作を経ない入力も含む）で上書きの編集を始める
      if (el.value === '' || composing.current) return;
      if (!store.beginEdit({ mode: 'overwrite', text: el.value })) {
        el.value = '';
        localText.current = '';
      }
      return;
    }
    if (current.origin === 'cell') store.setEditText(el.value);
  };

  const onCompositionStart = () => {
    composing.current = true;
    // IME の変換を始めたら、上書きの編集を始める（入力欄を見せる）
    if (store.getState().editing === null && !store.beginEdit({ mode: 'overwrite', text: '' })) return;
  };

  const onCompositionEnd = () => {
    composing.current = false;
    const el = inputRef.current;
    if (el === null) return;
    const current = store.getState().editing;
    if (current === null) {
      // 編集できない列で変換した文字は捨てる
      el.value = '';
      localText.current = '';
      return;
    }
    localText.current = el.value;
    store.setEditText(el.value);
  };

  const onCopy = (e: ClipboardEvent<HTMLTextAreaElement>, cut: boolean) => {
    if (store.getState().editing !== null) return;
    const copied = copySelection(store, cut);
    if (copied === null) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', copied.tsv);
    e.clipboardData.setData('text/html', copied.html);
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (store.getState().editing !== null) return;
    e.preventDefault();
    const valuesOnly = store.pasteValuesPending;
    store.pasteValuesPending = false;
    pasteText(store, e.clipboardData.getData('text/plain'), valuesOnly);
  };

  return (
    <div className={`sc-input-wrap${cellEditing ? ' editing' : ''}`} style={{ left: x, top: y }}>
      <textarea
        ref={inputRef}
        className={`sc-input ${cellEditing ? 'editing' : 'idle'}${editing?.error ? ' invalid' : ''}`}
        style={{ width, minHeight: geometry.rowHeight }}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        wrap="soft"
        aria-label={t('ui.grid.input')}
        data-region-focus=""
        data-testid="cell-input"
        onKeyDown={onKeyDown}
        onInput={onInput}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onCopy={(e) => onCopy(e, false)}
        onCut={(e) => onCopy(e, true)}
        onPaste={onPaste}
        onPointerDown={() => cellEditing && store.setEditMode('edit')}
      />
      {cellEditing && editing.error !== null && (
        <div className="sc-edit-error" role="alert" data-testid="edit-error">
          <div className="sc-edit-error-message">{editing.error.message}</div>
          {editing.error.hint !== '' && <div className="sc-edit-error-hint">{editing.error.hint}</div>}
        </div>
      )}
      {cellEditing && isFormula && (
        <FormulaAssist ref={formulaAssistRef} inputRef={inputRef} text={editing.text} columns={formulaColumns} requireEquals />
      )}
      {cellEditing && editing.error === null && assist !== null && (
        <EditorAssist
          ref={assistRef}
          kind={assist}
          text={editing.text}
          timeZone={store.calc?.timeZone ?? 'UTC'}
          t={t}
          style={{ minWidth: Math.max(160, width) }}
          setText={(text) => store.setEditText(text)}
          commit={(text) => {
            store.setEditText(text);
            store.commitEdit('enter');
          }}
        />
      )}
    </div>
  );
}
