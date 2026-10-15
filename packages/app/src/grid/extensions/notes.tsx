// メモ（FR-ANN-02）: メモのあるセルにマウスを重ねると、セルの右に中身を出す（Googleスプレッドシートと同じ）。
// 印（右上の三角）はセルの描画が出す。編集は Shift+F2 か右クリックの「メモ」（dialogs/note.tsx）
import { RichCell } from '@sheetcraft/core';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppState } from '../../store/hooks';
import '../../styles/notes.css';
import type { GridExtension, GridOverlayProps } from '../extensions';

/** 吹き出しの幅の上限（styles/notes.css の max-width と同じ） */
const POPUP_WIDTH = 280;

interface Hover {
  key: string;
  text: string;
  left: number;
  top: number;
}

function NoteHover({ sheet, geometry, pane }: GridOverlayProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const dialogOpen = useAppState((s) => s.dialogs.length > 0 || s.editing !== null);

  useEffect(() => {
    if (pane !== 'body') return;
    const scroller = ref.current?.closest<HTMLElement>('.sc-grid-scroller');
    if (scroller === null || scroller === undefined) return;
    let current: string | null = null;
    const hide = () => {
      if (current === null) return;
      current = null;
      setHover(null);
    };
    const onMove = (e: PointerEvent) => {
      // ドラッグ中は出さない
      if (e.buttons !== 0) {
        hide();
        return;
      }
      const r = scroller.getBoundingClientRect();
      const scroll = { left: scroller.scrollLeft, top: scroller.scrollTop };
      const hit = geometry.hitTest(e.clientX - r.left, e.clientY - r.top, scroll);
      if (hit.area === 'cell') {
        const record = sheet.recordAt(hit.row);
        const column = sheet.columns[hit.col];
        const cell = column === undefined ? undefined : record?.cells.get(column.name);
        if (record !== undefined && column !== undefined && cell instanceof RichCell && cell.comment !== undefined && cell.comment !== '') {
          const key = `${record.uid}\u0000${column.name}`;
          if (key === current) return;
          current = key;
          const cellLeft = r.left + geometry.colViewportX(hit.col, scroll.left);
          // 右に収まらなければ、セルの左に出す
          let left = cellLeft + geometry.cols.size(hit.col) + 4;
          if (left + POPUP_WIDTH > window.innerWidth) left = Math.max(4, cellLeft - POPUP_WIDTH - 4);
          const top = r.top + geometry.rowViewportY(hit.row, scroll.top);
          setHover({ key, text: cell.comment, left, top });
          return;
        }
      }
      hide();
    };
    scroller.addEventListener('pointermove', onMove);
    scroller.addEventListener('pointerleave', hide);
    scroller.addEventListener('scroll', hide);
    return () => {
      // 表の中身が変わったら、古い中身を出したままにしない
      setHover(null);
      scroller.removeEventListener('pointermove', onMove);
      scroller.removeEventListener('pointerleave', hide);
      scroller.removeEventListener('scroll', hide);
    };
  }, [pane, sheet, geometry]);

  return (
    <>
      {pane === 'body' && <span ref={ref} hidden />}
      {hover !== null &&
        !dialogOpen &&
        createPortal(
          <div className="sc-note-popup" style={{ left: hover.left, top: hover.top }} role="tooltip" data-testid="note-popup">
            {hover.text}
          </div>,
          document.body,
        )}
    </>
  );
}

export const notesExtension: GridExtension = {
  id: 'notes',
  overlay: NoteHover,
};
