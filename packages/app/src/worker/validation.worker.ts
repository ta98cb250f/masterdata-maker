// 検査用の Web Worker の入口（FR-VAL-10）。処理は engine.ts にある
import { indexedDbBackupStorage } from '../fs/backupStore';
import { ValidationEngine } from './engine';
import type { FromWorker, ToWorker } from './protocol';

// 型検査は DOM の型で行うので、Worker の大域オブジェクトは使う部分だけの型で扱う
const scope = self as unknown as {
  postMessage(message: FromWorker): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ToWorker>) => void): void;
};

// 未保存の変更の退避（FR-FIO-06）も、Worker から IndexedDB に書き込む（メインスレッドで大きなテキストを複製しない）
const engine = new ValidationEngine((message) => scope.postMessage(message), indexedDbBackupStorage);
scope.addEventListener('message', (event) => engine.handle(event.data));
