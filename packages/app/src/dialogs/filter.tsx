// 列のフィルタの小さな画面（FR-SRT-01、03）。Googleスプレッドシートのフィルタのメニューと同じく、列ヘッダーの下に出す:
// 昇順・降順の並べ替え、値で絞り込み（値の一覧から選ぶ）、条件で絞り込み（等しい・含む・範囲・空欄・空欄以外）
import type { FilterCondition } from '@sheetcraft/core';
import type { KeyboardEvent } from 'react';
import { useMemo, useState } from 'react';
import { setColumnFilter, setSort } from '../commands/sortFilter';
import { Popover } from '../components/Popover';
import type { AnchorRect } from '../grid/domAnchors';
import { filterValueList, formatFilterBound, parseFilterBound, supportsRange } from '../sheet/filterValues';
import { useT } from '../store/hooks';
import type { DialogProps } from './registry';
import { defineDialog } from './registry';

export interface FilterDialogArgs {
  table: number;
  column: string;
  anchor: AnchorRect;
}

type ConditionType = 'none' | 'empty' | 'notEmpty' | 'equals' | 'contains' | 'range';

/** 一覧に一度に出す値の数（多いときは検索で絞り込む） */
const MAX_LISTED = 300;

function FilterPopup({ store, args, close }: DialogProps<FilterDialogArgs>) {
  const t = useT();
  const table = store.table(args.table);
  const calc = store.calc;
  const field = calc === null || table === undefined ? undefined : calc.columns(table).find((c) => c.name === args.column);
  const tz = calc?.timeZone ?? 'UTC';
  const existing = store.view(args.table).filters.find((f) => f.column === args.column)?.condition;
  const list = useMemo(
    () => (calc === null || table === undefined || field === undefined ? { values: [], hasEmpty: false } : filterValueList(calc, table, field)),
    [calc, table, field],
  );
  const [tab, setTab] = useState<'values' | 'condition'>(existing !== undefined && existing.type !== 'values' ? 'condition' : 'values');
  const [checked, setChecked] = useState<ReadonlySet<string>>(() =>
    existing?.type === 'values' ? new Set(existing.values) : new Set(list.values),
  );
  const [includeEmpty, setIncludeEmpty] = useState(existing?.type === 'values' ? existing.includeEmpty : true);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<ConditionType>(existing !== undefined && existing.type !== 'values' ? existing.type : 'none');
  const [text, setText] = useState(existing?.type === 'equals' || existing?.type === 'contains' ? existing.value : '');
  const [min, setMin] = useState(existing?.type === 'range' && field !== undefined ? formatFilterBound(existing.min, field, tz) : '');
  const [max, setMax] = useState(existing?.type === 'range' && field !== undefined ? formatFilterBound(existing.max, field, tz) : '');
  const [error, setError] = useState<string | null>(null);

  if (table === undefined || field === undefined) return null;
  const title = field.display_name ?? field.name;
  const query = search.trim().toLowerCase();
  const shown = query === '' ? list.values : list.values.filter((v) => v.toLowerCase().includes(query));
  const emptyShown = list.hasEmpty && (query === '' || t('ui.filter.blank').toLowerCase().includes(query));

  const sort = (direction: 'asc' | 'desc') => {
    close();
    setSort(store, args.table, args.column, direction);
  };

  const setAllShown = (on: boolean) => {
    const next = new Set(checked);
    for (const v of shown) {
      if (on) next.add(v);
      else next.delete(v);
    }
    setChecked(next);
    if (emptyShown) setIncludeEmpty(on);
  };

  const toggle = (v: string) => {
    const next = new Set(checked);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setChecked(next);
  };

  /** 画面の内容から条件を作る。外すなら null、入力が正しくなければ undefined */
  const build = (): FilterCondition | null | undefined => {
    if (tab === 'values') {
      const all = list.values.every((v) => checked.has(v)) && (includeEmpty || !list.hasEmpty);
      return all ? null : { type: 'values', values: new Set(checked), includeEmpty };
    }
    switch (type) {
      case 'none':
        return null;
      case 'empty':
      case 'notEmpty':
        return { type };
      case 'equals':
      case 'contains':
        return { type, value: text };
      case 'range': {
        const lo = parseFilterBound(min, field, tz);
        const hi = parseFilterBound(max, field, tz);
        if (!lo.ok || !hi.ok) {
          setError(t(field.type === 'datetime' ? 'ui.filter.invalidDateTime' : 'ui.filter.invalidNumber'));
          return undefined;
        }
        if (lo.value === undefined && hi.value === undefined) return null;
        const c: FilterCondition = { type: 'range' };
        if (lo.value !== undefined) c.min = lo.value;
        if (hi.value !== undefined) c.max = hi.value;
        return c;
      }
    }
  };

  const apply = () => {
    const condition = build();
    if (condition === undefined) return;
    close();
    setColumnFilter(store, args.table, args.column, condition);
  };

  const onEnter = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      apply();
    }
  };

  return (
    <Popover anchor={args.anchor} onDismiss={close} testId="filter-popup" label={t('ui.filter.title', { column: title })} width={300}>
      <div className="sc-filter-title">{t('ui.filter.title', { column: title })}</div>
      <div className="sc-filter-sort">
        <button type="button" className="sc-filter-link" onClick={() => sort('asc')} data-testid="filter-sort-asc">
          {t('ui.sort.asc')}
        </button>
        <button type="button" className="sc-filter-link" onClick={() => sort('desc')} data-testid="filter-sort-desc">
          {t('ui.sort.desc')}
        </button>
      </div>
      <div className="sc-filter-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'values'}
          className={`sc-filter-tab${tab === 'values' ? ' active' : ''}`}
          onClick={() => setTab('values')}
          data-testid="filter-tab-values"
        >
          {t('ui.filter.byValues')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'condition'}
          className={`sc-filter-tab${tab === 'condition' ? ' active' : ''}`}
          onClick={() => setTab('condition')}
          data-testid="filter-tab-condition"
        >
          {t('ui.filter.byCondition')}
        </button>
      </div>
      {tab === 'values' ? (
        <div className="sc-filter-values">
          <div className="sc-filter-values-actions">
            <button type="button" className="sc-filter-link" onClick={() => setAllShown(true)} data-testid="filter-select-all">
              {t('ui.filter.selectAll')}
            </button>
            <button type="button" className="sc-filter-link" onClick={() => setAllShown(false)} data-testid="filter-clear-all">
              {t('ui.filter.clearAll')}
            </button>
          </div>
          <input
            type="search"
            className="sc-filter-input"
            value={search}
            placeholder={t('ui.filter.search')}
            aria-label={t('ui.filter.search')}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onEnter}
            data-testid="filter-search"
          />
          <div className="sc-filter-list" data-testid="filter-values">
            {shown.slice(0, MAX_LISTED).map((v) => (
              <label key={v} className="sc-filter-option">
                <input type="checkbox" checked={checked.has(v)} onChange={() => toggle(v)} />
                <span>{v}</span>
              </label>
            ))}
            {emptyShown && (
              <label className="sc-filter-option">
                <input type="checkbox" checked={includeEmpty} onChange={() => setIncludeEmpty(!includeEmpty)} />
                <span className="sc-filter-blank">{t('ui.filter.blank')}</span>
              </label>
            )}
            {shown.length > MAX_LISTED && <div className="sc-filter-more">{t('ui.filter.more', { count: shown.length - MAX_LISTED })}</div>}
            {shown.length === 0 && !emptyShown && <div className="sc-filter-more">{t('ui.filter.noValues')}</div>}
          </div>
        </div>
      ) : (
        <div className="sc-filter-condition">
          <select
            className="sc-filter-input"
            value={type}
            aria-label={t('ui.filter.byCondition')}
            onChange={(e) => {
              setType(e.target.value as ConditionType);
              setError(null);
            }}
            data-testid="filter-condition-type"
          >
            <option value="none">{t('ui.filter.cond.none')}</option>
            <option value="empty">{t('ui.filter.cond.empty')}</option>
            <option value="notEmpty">{t('ui.filter.cond.notEmpty')}</option>
            <option value="equals">{t('ui.filter.cond.equals')}</option>
            <option value="contains">{t('ui.filter.cond.contains')}</option>
            {supportsRange(field) && <option value="range">{t('ui.filter.cond.range')}</option>}
          </select>
          {(type === 'equals' || type === 'contains') && (
            <input
              className="sc-filter-input"
              value={text}
              aria-label={t('ui.filter.value')}
              placeholder={t('ui.filter.value')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onEnter}
              data-testid="filter-condition-value"
            />
          )}
          {type === 'range' && (
            <div className="sc-filter-range">
              <input
                className="sc-filter-input"
                value={min}
                aria-label={t('ui.filter.min')}
                placeholder={t('ui.filter.min')}
                onChange={(e) => {
                  setMin(e.target.value);
                  setError(null);
                }}
                onKeyDown={onEnter}
                data-testid="filter-condition-min"
              />
              <span>〜</span>
              <input
                className="sc-filter-input"
                value={max}
                aria-label={t('ui.filter.max')}
                placeholder={t('ui.filter.max')}
                onChange={(e) => {
                  setMax(e.target.value);
                  setError(null);
                }}
                onKeyDown={onEnter}
                data-testid="filter-condition-max"
              />
            </div>
          )}
          {error !== null && (
            <div className="sc-filter-error" role="alert">
              {error}
            </div>
          )}
        </div>
      )}
      <div className="sc-filter-footer">
        {existing !== undefined && (
          <button
            type="button"
            className="sc-button"
            onClick={() => {
              close();
              setColumnFilter(store, args.table, args.column, null);
            }}
            data-testid="filter-remove"
          >
            {t('ui.filter.remove')}
          </button>
        )}
        <span className="sc-filter-spacer" />
        <button type="button" className="sc-button" onClick={close}>
          {t('ui.dialog.cancel')}
        </button>
        <button type="button" className="sc-button primary" onClick={apply} data-testid="filter-ok">
          {t('ui.dialog.ok')}
        </button>
      </div>
    </Popover>
  );
}

export const filterDialog = defineDialog<FilterDialogArgs>('filter', FilterPopup);
