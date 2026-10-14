import { describe, expect, it } from 'vitest';
import type { Diagnostic, Project } from '@sheetcraft/core';
import { Calculator, enterInput, insertRows, serializeTable, snapshotProject } from '@sheetcraft/core';
import { ValidationEngine } from '../worker/engine';
import type { FromWorker, ToWorker } from '../worker/protocol';
import { generateLargeProjectFiles } from '../fs/largeSample';
import type { AppStore } from './AppStore';
import { openTestStore } from './testProject';
import { ValidationFailure, mainThreadValidator, runValidation } from './validation';
import type { WorkerLike } from './workerValidator';
import { WorkerValidator, backgroundJobs } from './workerValidator';

type Mode = 'normal' | 'hang' | 'crash';

/** Worker の偽物: メッセージを構造化複製して、次のタスクで ValidationEngine に渡す（本物と同じく順番どおり・非同期） */
class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: FromWorker }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  readonly received: ToWorker[] = [];
  readonly engine = new ValidationEngine((message) => {
    if (this.mode === 'hang' && message.type !== 'started') return;
    const copy = structuredClone(message);
    setTimeout(() => {
      if (!this.terminated) this.onmessage?.({ data: copy });
    }, 0);
  });

  constructor(public mode: Mode = 'normal') {}

  postMessage(message: ToWorker): void {
    if (this.terminated) return;
    const copy = structuredClone(message);
    this.received.push(copy);
    setTimeout(() => {
      if (this.terminated) return;
      if (this.mode === 'crash') {
        this.onerror?.(new Error('cannot load'));
        return;
      }
      this.engine.handle(copy);
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function workers(...modes: Mode[]) {
  const made: FakeWorker[] = [];
  return {
    made,
    create: () => {
      const w = new FakeWorker(modes[made.length] ?? 'normal');
      made.push(w);
      return w;
    },
  };
}

function diagnosticsOf(store: AppStore): Record<string, readonly Diagnostic[]> {
  const out: Record<string, readonly Diagnostic[]> = {};
  for (const [name, issues] of store.getState().validation.tables) out[name] = issues.diagnostics;
  return out;
}

/** 両方の store に同じ編集をする */
function edit(store: AppStore): void {
  const project = store.project as Project;
  const character = project.tables.find((t) => t.name === 'character');
  const skill = project.tables.find((t) => t.name === 'skill');
  if (character === undefined || skill === undefined) throw new Error('no table');
  expect(store.apply(enterInput(project, { table: character.uid, cells: [{ record: character.records[0].uid, column: 'hp' }], text: '0' })).ok).toBe(true);
  expect(store.apply(insertRows(project, { table: character.uid, anchor: character.records[0].uid, position: 'below', count: 2 })).ok).toBe(true);
  expect(store.apply(enterInput(project, { table: skill.uid, cells: [{ record: skill.records[0].uid, column: 'cost' }], text: '-5' })).ok).toBe(true);
  store.undo();
  store.redo();
}

function serializeAll(project: Project): string[] {
  return project.tables.map((t) => `${t.uid}:${t.records.map((r) => r.uid).join(',')}\n${serializeTable(t, project.common.base_fields.items, 'yaml')}`);
}

describe('検査の Web Worker 化（FR-VAL-09〜11）', () => {
  it('Worker の複製はパッチで同期され、検査の結果はメインスレッドの検査と一致する', async () => {
    const w = workers();
    const viaWorker = await openTestStore({ validator: (p, c) => new WorkerValidator(p, c, { createWorker: w.create }) });
    const onMain = await openTestStore({ validator: mainThreadValidator });
    expect(w.made).toHaveLength(1);
    expect(diagnosticsOf(viaWorker.store)).toEqual(diagnosticsOf(onMain.store));
    edit(viaWorker.store);
    edit(onMain.store);
    await viaWorker.store.flushValidation();
    await onMain.store.flushValidation();
    const results = diagnosticsOf(viaWorker.store);
    expect(results).toEqual(diagnosticsOf(onMain.store));
    expect(results.character.some((d) => d.field === 'hp')).toBe(true);
    // Worker の中のモデルも、内部番号まで同じ
    const replica = w.made[0].engine.replica as Project;
    expect(serializeAll(replica)).toEqual(serializeAll(viaWorker.store.project as Project));
    expect(replica.uids.peek()).toBe(viaWorker.store.project?.uids.peek());
    // 最初の複製の受け渡しの後は、パッチだけを送っている
    expect(w.made[0].received.filter((m) => m.type === 'init')).toHaveLength(1);
    expect(w.made[0].received.some((m) => m.type === 'patches')).toBe(true);
  });

  it('1 万行 × 50 列でも、複製とパッチで同期した結果はメインスレッドと一致する', async () => {
    const { store } = await openTestStore({ validator: mainThreadValidator }, generateLargeProjectFiles({ format: 'json' }));
    const project = store.project as Project;
    const calc = store.calc as Calculator;
    const engine = new ValidationEngine(() => undefined);
    engine.handle(structuredClone({ type: 'init', snapshot: snapshotProject(project) }) as ToWorker);
    const unsubscribe = store.session?.subscribe((event) => {
      if (event.kind !== 'saved') engine.handle(structuredClone({ type: 'patches', patches: [...event.patches] }) as ToWorker);
    });
    const big = project.tables.find((t) => t.name === 'big');
    if (big === undefined) throw new Error('no table');
    expect(store.apply(enterInput(project, { table: big.uid, cells: [{ record: big.records[10].uid, column: 'hp' }], text: '0' })).ok).toBe(true);
    unsubscribe?.();
    const replica = engine.replica as Project;
    const request = { tables: ['big'], common: false };
    expect(runValidation(replica, new Calculator(replica), request)).toEqual(runValidation(project, calc, request));
  });

  it('時間制限を過ぎたら Worker を止めて作り直し、時間切れとして知らせる（FR-VAL-10）', async () => {
    const w = workers('normal', 'hang', 'normal');
    let validator: WorkerValidator | null = null;
    const { store } = await openTestStore({
      validator: (p, c) => (validator = new WorkerValidator(p, c, { createWorker: w.create, timeLimit: 100, startLimit: 1000 })),
    });
    const v = validator as unknown as WorkerValidator;
    // 1 台目を止まったものとみなさせるため、2 台目（止まる Worker）に切り替える
    (v as unknown as { restart(): void }).restart();
    const started = Date.now();
    await expect(v.run({ tables: ['character'], common: false })).rejects.toBeInstanceOf(ValidationFailure);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(w.made[1].terminated).toBe(true);
    expect(v.stats.timeouts).toBe(1);
    // 作り直した Worker で、次の検査はできる
    const output = await v.run({ tables: ['character'], common: false });
    expect(output.tables.get('character')).toBeDefined();
    expect(w.made).toHaveLength(3);
    // store を通すと、時間切れを状態の知らせに出す
    w.made[2].mode = 'hang';
    store.scheduleValidation(['character'], 0);
    await store.flushValidation();
    expect(store.getState().status?.text).toBe('検査が 0.1 秒以内に終わらなかったため中断しました（時間切れ）。表示している検査の結果は古いことがあります');
    expect(store.getState().validation.running).toBe(false);
  });

  it('Worker が作れない・読み込めない環境では、メインスレッドで検査する', async () => {
    const throwing = await openTestStore({
      validator: (p, c) =>
        new WorkerValidator(p, c, {
          createWorker: () => {
            throw new ReferenceError('Worker is not defined');
          },
        }),
    });
    expect(throwing.store.getState().validation.tables.has('character')).toBe(true);

    const w = workers('crash');
    let validator: WorkerValidator | null = null;
    const crashing = await openTestStore({ validator: (p, c) => (validator = new WorkerValidator(p, c, { createWorker: w.create })) });
    expect((validator as unknown as WorkerValidator).stats.mode).toBe('main');
    expect(diagnosticsOf(crashing.store)).toEqual(diagnosticsOf(throwing.store));
  });

  it('複製がずれたら送り直してやり直す', async () => {
    const w = workers();
    let validator: WorkerValidator | null = null;
    const { store } = await openTestStore({ validator: (p, c) => (validator = new WorkerValidator(p, c, { createWorker: w.create })) });
    const v = validator as unknown as WorkerValidator;
    // 存在しないレコードを指すパッチを Worker にだけ送る
    v.notifyPatches([{ op: 'setCells', table: 999999, cells: [] }]);
    const output = await v.run({ tables: ['character'], common: true });
    expect(output.tables.get('character')).toEqual(store.getState().validation.tables.get('character')?.diagnostics);
    expect(w.made).toHaveLength(2);
    expect(v.stats.restarts).toBe(1);
  });

  it('出力と正規形のテキストの作成も Worker に頼める', async () => {
    const w = workers();
    const { store } = await openTestStore({ validator: (p, c) => new WorkerValidator(p, c, { createWorker: w.create }) });
    const project = store.project as Project;
    const jobs = backgroundJobs(project, store.calc as Calculator);
    const plan = await jobs.exportPlan({ tables: ['skill'] });
    expect(plan.ok).toBe(true);
    expect(plan.files.map((f) => f.path)).toEqual(['build/skill.json']);
    const skill = project.tables.find((t) => t.name === 'skill');
    const texts = await jobs.serializeTables([{ uid: skill?.uid ?? -1, format: 'yaml' }]);
    expect(texts[0].text).toBe(skill?.source?.text);
    // 開いた直後の検査と、出力・正規形のテキストの 3 つ
    expect(w.made[0].received.filter((m) => m.type === 'job')).toHaveLength(3);
  });
});
