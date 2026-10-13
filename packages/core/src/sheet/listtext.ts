// リストの値と 1 つのセルのテキストの変換（P-16）。例: `1, 3, 7`、`"a, b", c`

/** 空白かどうか（`String.prototype.trim` が取り除く文字と同じ） */
function isSpace(ch: string): boolean {
  return ch.trim() === '';
}

function needsQuote(item: string): boolean {
  return item === '' || item.includes(',') || item.includes('"') || item.trim() !== item;
}

/**
 * リストの要素を `, ` でつないだテキストにする。
 * 要素が空文字のとき、`,` や `"` を含むとき、前後に空白があるときは `"` で囲み、`"` は `""` と書く。空のリストは空のテキスト
 */
export function formatListText(items: readonly string[]): string {
  return items.map((item) => (needsQuote(item) ? `"${item.replaceAll('"', '""')}"` : item)).join(', ');
}

/** `"` で囲まれた要素を読む。囲みの後に空白と `,` 以外が続くなど、正しくなければ null */
function readQuoted(text: string, start: number): { value: string; next: number } | null {
  let j = start + 1;
  let out = '';
  for (;;) {
    const q = text.indexOf('"', j);
    if (q < 0) return null;
    out += text.slice(j, q);
    if (text[q + 1] === '"') {
      out += '"';
      j = q + 2;
      continue;
    }
    let k = q + 1;
    while (k < text.length && isSpace(text[k])) k++;
    if (k < text.length && text[k] !== ',') return null;
    return { value: out, next: k };
  }
}

/**
 * セルのテキストをリストの要素にする（formatListText の逆）。
 * カンマの前後の空白は無視する。`"` の囲みが正しくない要素は、次の `,` までをそのまま（前後の空白を除いて）要素にする。
 * 空のテキスト（空白だけを含む）は空のリスト
 */
export function parseListText(text: string): string[] {
  if (text.trim() === '') return [];
  const items: string[] = [];
  let i = 0;
  for (;;) {
    while (i < text.length && isSpace(text[i])) i++;
    let value: string;
    const quoted = text[i] === '"' ? readQuoted(text, i) : null;
    if (quoted) {
      value = quoted.value;
      i = quoted.next;
    } else {
      const comma = text.indexOf(',', i);
      const end = comma < 0 ? text.length : comma;
      value = text.slice(i, end).trim();
      i = end;
    }
    items.push(value);
    if (i >= text.length) break;
    i++; // `,` を読み飛ばす
  }
  return items;
}
