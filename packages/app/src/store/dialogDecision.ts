// 答えを待つダイアログ（外部での変更の選択、未保存の変更の復元の提案）。
// 答えずにダイアログが消えた（閉じた・プロジェクトを開き直した）ときは dismissed を答えとする
import type { AppStore } from './AppStore';

/**
 * ダイアログを開き、答えを返す。makeArgs に渡す onDecide を、ダイアログを閉じる前に呼ぶこと。
 * onPending には、答えを待たずに dismissed で終わらせる関数を渡す
 */
export function openDecisionDialog<T>(
  store: AppStore,
  id: string,
  makeArgs: (onDecide: (answer: T) => void) => object,
  dismissed: T,
  onPending?: (cancel: () => void) => void,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    let unsubscribe: () => void = () => undefined;
    const decide = (answer: T) => {
      if (done) return;
      done = true;
      unsubscribe();
      resolve(answer);
    };
    const key = store.openDialog(id, makeArgs(decide));
    unsubscribe = store.subscribe(() => {
      if (!store.getState().dialogs.some((d) => d.key === key)) decide(dismissed);
    });
    onPending?.(() => decide(dismissed));
  });
}
