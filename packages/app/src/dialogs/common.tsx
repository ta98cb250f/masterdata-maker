// 汎用のダイアログ: お知らせ（一覧付き）と確認
import { useState } from 'react';
import { DialogFrame } from '../components/Dialog';
import { useT } from '../store/hooks';
import type { DialogProps } from './registry';
import { defineDialog } from './registry';

export interface MessageArgs {
  titleKey: string;
  /** 本文の文言キー（items の前に出す） */
  messageKey?: string;
  messageParams?: Record<string, string | number>;
  /** 本文（文言キーの代わりに、組み立て済みの文） */
  message?: string;
  /** 一覧（失敗したセル、手で消すファイルなど） */
  items?: readonly string[];
  tone?: 'info' | 'error';
}

function MessageDialog({ args, close }: DialogProps<MessageArgs>) {
  const t = useT();
  const message = args.message ?? (args.messageKey === undefined ? undefined : t(args.messageKey, args.messageParams));
  return (
    <DialogFrame
      title={t(args.titleKey)}
      onClose={close}
      width={520}
      testId="message-dialog"
      footer={
        <button type="button" className="sc-button primary" onClick={close}>
          {t('ui.dialog.ok')}
        </button>
      }
    >
      {message !== undefined && <p className="sc-dialog-message">{message}</p>}
      {args.items !== undefined && args.items.length > 0 && (
        <ul className={`sc-dialog-list${args.tone === 'error' ? ' error' : ''}`} data-testid="message-items">
          {args.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </DialogFrame>
  );
}

export interface ConfirmArgs {
  titleKey: string;
  messageKey?: string;
  messageParams?: Record<string, string | number>;
  message?: string;
  /** 確定のボタンの文言キー（既定は OK） */
  confirmKey?: string;
  /** 取り消せない操作（ボタンを赤くする） */
  danger?: boolean;
  onConfirm(): void | Promise<void>;
  onCancel?(): void;
}

function ConfirmDialog({ args, close }: DialogProps<ConfirmArgs>) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const message = args.message ?? (args.messageKey === undefined ? undefined : t(args.messageKey, args.messageParams));
  const cancel = () => {
    close();
    args.onCancel?.();
  };
  const confirm = async () => {
    setBusy(true);
    close();
    await args.onConfirm();
  };
  return (
    <DialogFrame
      title={t(args.titleKey)}
      onClose={cancel}
      testId="confirm-dialog"
      footer={
        <>
          <button type="button" className="sc-button" onClick={cancel}>
            {t('ui.dialog.cancel')}
          </button>
          <button type="button" className={`sc-button primary${args.danger ? ' danger' : ''}`} disabled={busy} onClick={() => void confirm()}>
            {t(args.confirmKey ?? 'ui.dialog.ok')}
          </button>
        </>
      }
    >
      {message !== undefined && <p className="sc-dialog-message">{message}</p>}
    </DialogFrame>
  );
}

export const messageDialog = defineDialog<MessageArgs>('message', MessageDialog);
export const confirmDialog = defineDialog<ConfirmArgs>('confirm', ConfirmDialog);
