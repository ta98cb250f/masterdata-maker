// 読み込みエラーのテーブル（P-40）: エラーの内容だけを表示する（編集も保存もしない）
import type { BrokenTable } from '@sheetcraft/core';
import { resolveShortcut } from '@sheetcraft/core';
import { useEffect, useRef } from 'react';
import { useStore, useT } from '../store/hooks';

export function BrokenTableView({ table }: { table: BrokenTable }) {
  const store = useStore();
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // キー操作（シートの切り替え・保存など）を受け付けるため、フォーカスを置く
    const focus = () => ref.current?.focus({ preventScroll: true });
    store.registerFocusHandler(focus);
    focus();
    return () => store.registerFocusHandler(null);
  }, [store]);
  const errors = table.diagnostics.filter((d) => d.severity === 'error');
  const warnings = table.diagnostics.filter((d) => d.severity === 'warning');
  return (
    <div
      className="sc-broken"
      ref={ref}
      tabIndex={-1}
      data-region-focus=""
      data-testid="broken-table"
      onKeyDown={(e) => {
        const id = resolveShortcut(e.nativeEvent, store.platform, 'grid');
        const def = id === null ? undefined : store.commands.byShortcut(id);
        if (def === undefined || def.native !== undefined || !store.isEnabled(def.id)) return;
        e.preventDefault();
        void store.run(def.id);
      }}
    >
      <h2>{t('ui.broken.title', { name: table.name })}</h2>
      <p>{t('ui.broken.message', { path: table.source.path })}</p>
      {errors.length > 0 && (
        <ul className="sc-broken-list error">
          {errors.map((d, i) => (
            <li key={i}>{store.formatDiagnosticLine(d)}</li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <>
          <h3>{t('ui.broken.warnings')}</h3>
          <ul className="sc-broken-list warning">
            {warnings.map((d, i) => (
              <li key={i}>{store.formatDiagnosticLine(d)}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
