// メモの編集欄（FR-ANN-02）。セルの右に出す。外側を押す・Esc・Ctrl+Enter で書いた内容を残して閉じる
// （Googleスプレッドシートのメモと同じく、閉じると保存される）。空にして閉じるか「削除」でメモを消す
import type { KeyboardEvent } from 'react';
import { useEffect, useRef } from 'react';
import { RichCell, setCellComment } from '@masterdata-maker/core';
import { Popover } from '../components/Popover';
import type { AnchorRect } from '../grid/domAnchors';
import { useT } from '../store/hooks';
import '../styles/notes.css';
import type { DialogProps } from './registry';
import { defineDialog } from './registry';

export interface NoteDialogArgs {
  table: number;
  record: number;
  column: string;
  anchor: AnchorRect;
}

function NoteEditor({ store, args, close }: DialogProps<NoteDialogArgs>) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const record = store.table(args.table)?.records.find((r) => r.uid === args.record);
  const cell = record?.cells.get(args.column);
  const initial = cell instanceof RichCell ? (cell.comment ?? '') : '';

  const save = (text: string) => {
    close();
    const project = store.project;
    if (project === null || text === initial) return;
    store.applyOrReport(setCellComment(project, { table: args.table, cells: [{ record: args.record, column: args.column }], comment: text === '' ? null : text }));
  };
  const finish = () => save(ref.current?.value ?? initial);

  // 文字の入力を末尾から続けられるようにする
  useEffect(() => {
    const el = ref.current;
    if (el !== null) el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      finish();
    }
  };

  return (
    <Popover anchor={args.anchor} placement="right" onDismiss={finish} testId="note-editor" label={t('ui.note.title')} width={240} initialFocus="textarea">
      <textarea
        ref={ref}
        className="sc-note-input"
        defaultValue={initial}
        rows={5}
        aria-label={t('ui.note.title')}
        placeholder={t('ui.note.placeholder')}
        onKeyDown={onKeyDown}
        data-testid="note-input"
      />
      <div className="sc-note-actions">
        {initial !== '' && (
          <button type="button" className="sc-button" onClick={() => save('')} data-testid="note-delete">
            {t('ui.note.delete')}
          </button>
        )}
        <button type="button" className="sc-button primary" onClick={finish} data-testid="note-save">
          {t('ui.note.done')}
        </button>
      </div>
    </Popover>
  );
}

export const noteDialog = defineDialog<NoteDialogArgs>('cellNote', NoteEditor);
