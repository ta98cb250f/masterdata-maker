// 外部での変更のダイアログ（FR-FIO-07）: ほかのエディタや Git で書き換えられたファイルごとに、読み込み直すか上書きするかを選ぶ。
// 保存していない変更のあるテーブルを読み込み直すときは、その変更が消えることを示して確かめる（NFR-17）
import { useRef, useState } from 'react';
import { DialogFrame } from '../components/Dialog';
import type { ChangeChoice, ExternalChange, ExternalChangesDialogArgs } from '../store/externalChanges';
import { EXTERNAL_CHANGES_DIALOG, defaultChoice } from '../store/externalChanges';
import { useT } from '../store/hooks';
import type { DialogProps } from './registry';
import { defineDialog } from './registry';
import './fileDialogs.css';

function choiceLabels(change: ExternalChange): Record<ChangeChoice, string> {
  switch (change.kind) {
    case 'config':
      return { reload: 'ui.external.reopenProject', keep: 'ui.external.leave' };
    case 'broken':
      return { reload: 'ui.external.reload', keep: 'ui.external.leave' };
    default:
      return { reload: 'ui.external.reload', keep: 'ui.external.keep' };
  }
}

function ExternalChangesDialog({ args, close }: DialogProps<ExternalChangesDialogArgs>) {
  const t = useT();
  const [choices, setChoices] = useState<ReadonlyMap<string, ChangeChoice>>(() => new Map(args.changes.map((c) => [c.path, defaultChoice(c)])));
  const [confirming, setConfirming] = useState(false);
  const decided = useRef(false);

  const decide = (result: ReadonlyMap<string, ChangeChoice> | null) => {
    if (decided.current) return;
    decided.current = true;
    args.onDecide(result);
    close();
  };

  const choose = (path: string, choice: ChangeChoice) => {
    const next = new Map(choices);
    next.set(path, choice);
    setChoices(next);
  };

  // 読み込み直すと消える、保存していない変更
  const losing = args.changes.filter((c) => c.unsaved && choices.get(c.path) === 'reload');
  const reopening = args.changes.some((c) => c.kind === 'config' && choices.get(c.path) === 'reload');
  const submit = () => {
    if (!confirming && losing.length > 0) setConfirming(true);
    else decide(choices);
  };

  const save = args.mode === 'save';
  const footer = (
    <>
      <button type="button" className="sc-button" onClick={() => (confirming ? setConfirming(false) : decide(null))} data-testid="external-cancel">
        {t(confirming ? 'ui.external.back' : save ? 'ui.external.cancelSave' : 'ui.external.later')}
      </button>
      <button type="button" className={`sc-button primary${confirming ? ' danger' : ''}`} onClick={submit} data-testid="external-apply">
        {t(confirming ? 'ui.external.confirmReload' : save && !reopening ? 'ui.external.applyAndSave' : 'ui.external.apply')}
      </button>
    </>
  );

  return (
    <DialogFrame title={t('ui.external.title')} onClose={() => decide(null)} width={600} testId="external-dialog" footer={footer}>
      {confirming ? (
        <div data-testid="external-confirm">
          <p className="sc-dialog-message">{t(reopening ? 'ui.external.confirmReopenMessage' : 'ui.external.confirmMessage')}</p>
          <ul className="sc-dialog-list error">
            {losing.map((c) => (
              <li key={c.path}>{c.kind === 'config' ? t('ui.external.allUnsaved') : `${c.label} (${c.path})`}</li>
            ))}
          </ul>
          <p className="sc-fd-note">{t('ui.external.historyNote')}</p>
        </div>
      ) : (
        <>
          <p className="sc-dialog-message">{t(save ? 'ui.external.messageSave' : 'ui.external.message')}</p>
          <ul className="sc-fd-files sc-fd-scroll">
            {args.changes.map((c) => {
              const labels = choiceLabels(c);
              const name = `external-${c.path}`;
              return (
                <li key={c.path} className="sc-fd-file" data-testid={`external-file-${c.path}`}>
                  <div className="sc-fd-file-head">
                    <span className="sc-fd-path">{c.path}</span>
                    {c.label !== c.path && <span>{c.label}</span>}
                    <span className="sc-fd-state">{t(c.text === null ? 'ui.external.deleted' : 'ui.external.modified')}</span>
                    {c.unsaved && <span className="sc-fd-state unsaved">{t(c.kind === 'config' ? 'ui.external.projectUnsaved' : 'ui.external.unsaved')}</span>}
                  </div>
                  <div className="sc-fd-choices">
                    {(['reload', 'keep'] as const).map((choice) => (
                      <label key={choice} className="sc-fd-check">
                        <input
                          type="radio"
                          name={name}
                          checked={choices.get(c.path) === choice}
                          onChange={() => choose(c.path, choice)}
                          data-testid={`external-${choice}-${c.path}`}
                        />
                        {t(labels[choice])}
                      </label>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </DialogFrame>
  );
}

export const externalChangesDialog = defineDialog<ExternalChangesDialogArgs>(EXTERNAL_CHANGES_DIALOG, ExternalChangesDialog);
