// 未保存の変更の復元の提案（FR-FIO-06）: 前回保存しないまま終わった変更が残っていれば、復元するかを選ぶ
import { useRef } from 'react';
import { DialogFrame } from '../components/Dialog';
import type { RestoreDialogArgs, RestoreItem } from '../store/backup';
import { BACKUP_DIALOG } from '../store/backup';
import { useAppState, useT } from '../store/hooks';
import type { DialogProps } from './registry';
import { defineDialog } from './registry';
import './fileDialogs.css';

const ITEM_KEYS: Record<RestoreItem['kind'], string> = {
  table: 'ui.backup.itemTable',
  newTable: 'ui.backup.itemNewTable',
  removed: 'ui.backup.itemRemoved',
  common: 'ui.backup.itemCommon',
};

function BackupRestoreDialog({ args, close }: DialogProps<RestoreDialogArgs>) {
  const t = useT();
  const locale = useAppState((s) => s.locale);
  const decided = useRef(false);
  const decide = (choice: 'restore' | 'discard' | 'later') => {
    if (decided.current) return;
    decided.current = true;
    args.onDecide(choice);
    close();
  };
  const time = new Date(args.record.savedAt).toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US');
  return (
    <DialogFrame
      title={t('ui.backup.title')}
      onClose={() => decide('later')}
      width={560}
      testId="backup-dialog"
      footer={
        <>
          <button type="button" className="sc-button" onClick={() => decide('discard')} data-testid="backup-discard">
            {t('ui.backup.discard')}
          </button>
          <button type="button" className="sc-button primary" onClick={() => decide('restore')} data-testid="backup-restore">
            {t('ui.backup.restore')}
          </button>
        </>
      }
    >
      <p className="sc-dialog-message">{t('ui.backup.message', { time })}</p>
      <ul className="sc-dialog-list sc-fd-scroll" data-testid="backup-items">
        {args.items.map((item, i) => (
          <li key={i}>
            {t(ITEM_KEYS[item.kind], { name: item.label, path: item.path ?? '' })}
            {item.changedSince && <span className="sc-fd-state unsaved"> {t('ui.backup.changedSince')}</span>}
          </li>
        ))}
      </ul>
      {args.skipped.length > 0 && <p className="sc-fd-error">{t('ui.backup.willSkip', { files: args.skipped.join(', ') })}</p>}
      <p className="sc-fd-note">{t('ui.backup.note')}</p>
    </DialogFrame>
  );
}

export const backupRestoreDialog = defineDialog<RestoreDialogArgs>(BACKUP_DIALOG, BackupRestoreDialog);
