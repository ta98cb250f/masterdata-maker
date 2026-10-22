// 型ごとの入力部品（FR-EDT-03）。セルの入力欄の下に出す。入力欄のテキストが常に正で、部品はテキストを書き換える
// - enum: 絞り込み付きのプルダウン / list<enum>: 候補からの複数選択
// - 参照列（ref）: 参照先の候補（主キーと名前を並べる）。リスト型なら複数選択
// - datetime: 日付と時刻の選択部品 / その他のリスト型: 要素ごとの部品（タグ）
import type { Calculator, FieldDef } from '@masterdata-maker/core';
import { formatDisplay, formatListText, isListType, parseListText, parseRef, parseUserDateTime } from '@masterdata-maker/core';
import type { CSSProperties, KeyboardEvent } from 'react';
import { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import type { Translate } from '../i18n';

export interface AssistOption {
  value: string;
  /** 値の横に添える説明（参照先の名前など） */
  detail?: string;
}

export type AssistKind =
  | { kind: 'choice'; multi: boolean; options: AssistOption[] }
  | { kind: 'datetime' }
  | { kind: 'tags' };

const MAX_OPTIONS = 200;

/** 参照先の候補（主キーと名前）。名前は参照先の name 列、無ければ最初の文字列の列 */
export function refOptions(calc: Calculator, ref: string): AssistOption[] | null {
  const target = parseRef(ref);
  if (target === null) return null;
  const table = calc.findTable(target.table);
  if (table === undefined) return null;
  const columns = calc.columns(table);
  const nameColumn = columns.find((c) => c.name === 'name') ?? columns.find((c) => c.type === 'string' && c.name !== target.column && c.name !== 'version');
  const options: AssistOption[] = [];
  for (const record of table.records) {
    const key = calc.getCell(table, record.uid, target.column).raw;
    if (key === undefined || Array.isArray(key)) continue;
    const name = nameColumn === undefined ? undefined : calc.getCell(table, record.uid, nameColumn.name).raw;
    options.push({ value: String(key), detail: name === undefined ? undefined : String(name) });
  }
  return options;
}

/** 列の型に合わせた入力部品の種類。部品が無ければ null */
export function assistKindOf(calc: Calculator, field: FieldDef): AssistKind | null {
  const multi = isListType(field.type);
  if (field.ref !== undefined) {
    const options = refOptions(calc, field.ref);
    if (options !== null) return { kind: 'choice', multi, options };
  }
  if (field.type === 'enum' || field.type === 'list<enum>') {
    const values = calc.enumValues(field);
    if (values !== undefined) return { kind: 'choice', multi, options: values.map((value) => ({ value })) };
  }
  if (field.type === 'datetime') return { kind: 'datetime' };
  if (multi) return { kind: 'tags' };
  return null;
}

export interface AssistHandle {
  /** 入力欄のキー操作を先に受け取る。処理したら true */
  handleKey(e: KeyboardEvent<HTMLTextAreaElement>): boolean;
}

export interface EditorAssistProps {
  kind: AssistKind;
  text: string;
  timeZone: string;
  style: CSSProperties;
  t: Translate;
  setText(text: string): void;
  /** 選んで確定する（単一の選択） */
  commit(text: string): void;
}

function matches(option: AssistOption, query: string): boolean {
  if (query === '') return true;
  const q = query.toLowerCase();
  return option.value.toLowerCase().includes(q) || (option.detail?.toLowerCase().includes(q) ?? false);
}

/** datetime-local の値（YYYY-MM-DDTHH:mm:ss）。テキストが日時として読めなければ空 */
function toLocalInput(text: string, timeZone: string): string {
  if (text.trim() === '') return '';
  const parsed = parseUserDateTime(text.trim(), timeZone);
  if (parsed === null) return '';
  return formatDisplay(parsed.epochMs, timeZone).replace(' ', 'T');
}

export const EditorAssist = forwardRef<AssistHandle, EditorAssistProps>(function EditorAssist(props, ref) {
  const { kind, text, setText, commit, style, t } = props;
  const [active, setActive] = useState(-1);

  const items = kind.kind === 'choice' && kind.multi ? parseListText(text) : [];
  const selected = new Set(items);
  // 単一の選択は入力中のテキストで絞り込む。複数の選択は、入力中の最後の要素で絞り込む
  const query = kind.kind !== 'choice' ? '' : kind.multi ? '' : text.trim();
  const options = useMemo(() => {
    if (kind.kind !== 'choice') return [];
    const exact = kind.options.some((o) => o.value === query);
    return kind.options.filter((o) => exact || matches(o, query)).slice(0, MAX_OPTIONS);
  }, [kind, query]);
  const highlighted = kind.kind === 'choice' && !kind.multi && active < 0 && query !== '' && options.length > 0 ? 0 : active;

  const toggle = (value: string) => {
    const next = selected.has(value) ? items.filter((v) => v !== value) : [...items, value];
    setText(formatListText(next));
  };

  useImperativeHandle(ref, () => ({
    handleKey(e) {
      if (kind.kind !== 'choice' || options.length === 0 || e.altKey || e.ctrlKey || e.metaKey) return false;
      if (e.key === 'ArrowDown') {
        setActive(Math.min(options.length - 1, highlighted + 1));
        return true;
      }
      if (e.key === 'ArrowUp') {
        setActive(highlighted <= 0 ? -1 : highlighted - 1);
        return true;
      }
      if (e.key === 'Enter' && !e.shiftKey && highlighted >= 0) {
        const option = options[highlighted];
        if (kind.multi) toggle(option.value);
        else commit(option.value);
        return true;
      }
      return false;
    },
  }));

  if (kind.kind === 'datetime') {
    return (
      <div className="sc-assist sc-assist-datetime" style={style} onMouseDown={(e) => e.stopPropagation()}>
        <input
          type="datetime-local"
          step={1}
          value={toLocalInput(text, props.timeZone)}
          aria-label={t('ui.assist.pickDateTime')}
          onChange={(e) => setText(e.target.value === '' ? '' : e.target.value.replace('T', ' ') + (e.target.value.length === 16 ? ':00' : ''))}
        />
      </div>
    );
  }

  if (kind.kind === 'tags') {
    return (
      <div className="sc-assist sc-assist-tags" style={style} onMouseDown={(e) => e.preventDefault()}>
        {parseListText(text).map((item, i, all) => (
          <span key={i} className="sc-tag">
            {item}
            <button
              type="button"
              className="sc-tag-remove"
              aria-label={t('ui.assist.removeItem', { item })}
              onClick={() => setText(formatListText(all.filter((_, j) => j !== i)))}
            >
              ×
            </button>
          </span>
        ))}
        <span className="sc-assist-hint">{t('ui.assist.tagsHint')}</span>
      </div>
    );
  }

  return (
    <div className="sc-assist sc-assist-choice" style={style} role="listbox" aria-multiselectable={kind.multi} onMouseDown={(e) => e.preventDefault()} data-testid="editor-assist">
      {options.length === 0 && <div className="sc-assist-empty">{t('ui.assist.noMatch')}</div>}
      {options.map((option, i) => (
        <div
          key={option.value}
          role="option"
          aria-selected={kind.multi ? selected.has(option.value) : i === highlighted}
          className={`sc-assist-option${i === highlighted ? ' active' : ''}`}
          onMouseEnter={() => setActive(i)}
          onClick={() => (kind.multi ? toggle(option.value) : commit(option.value))}
        >
          {kind.multi && <span className={`sc-checkbox small${selected.has(option.value) ? ' checked' : ''}`} />}
          <span className="sc-assist-value">{option.value}</span>
          {option.detail !== undefined && <span className="sc-assist-detail">{option.detail}</span>}
        </div>
      ))}
    </div>
  );
});
