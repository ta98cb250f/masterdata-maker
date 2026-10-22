// 受け入れ基準（要件定義書 §5.17 の 1〜9 番。NFR-31）。番号と表の文言どおりに 1 件ずつ並べる。
// ほかの spec と重なる確認もあるが、このファイルだけを読めば受け入れ基準が通ることが分かるようにしている。
// 手で確かめる必要があるもの（Googleスプレッドシート本体・Firefox・Safari）は、各テストの注記に書いた（計画書 §7.3）
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { cellPoint, cellText, clickCell, colIndex, openBasicSample } from './helpers';
import { mockDirectoryPicker, openOpfsProject, putGeneratedProject, putProject, sampleFiles, snapshotOpfs } from './opfs';

const SAMPLES = join(import.meta.dirname, '../../../samples');

interface SelectionInfo {
  kind: string;
  range: { top: number; left: number; bottom: number; right: number };
}

/** 表示中のテーブルの選択（store から読む） */
function selection(page: Page): Promise<SelectionInfo> {
  return page.evaluate(() => {
    type Sel = { kind: string; ranges: SelectionInfo['range'][] };
    type Store = { sheet(): { table: { uid: number } }; view(uid: number): { selection: Sel } };
    const store = (globalThis as unknown as { masterdataMaker: Store }).masterdataMaker;
    const sel = store.view(store.sheet().table.uid).selection;
    return { kind: sel.kind, range: sel.ranges[0] };
  });
}

/** 表示中のテーブルの、表示上の行 rows の列 columns の値（式を計算した後の値。未入力は null） */
function values(page: Page, rows: number[], columns: string[]): Promise<unknown[][]> {
  return page.evaluate(
    ({ rows, columns }) => {
      type Sheet = { table: unknown; recordAt(row: number): { uid: number } | undefined };
      type Store = { sheet(): Sheet; calc: { getCell(table: unknown, record: number, column: string): { raw: unknown } } };
      const store = (globalThis as unknown as { masterdataMaker: Store }).masterdataMaker;
      const sheet = store.sheet();
      return rows.map((row) =>
        columns.map((column) => {
          const record = sheet.recordAt(row);
          const raw = record === undefined ? undefined : store.calc.getCell(sheet.table, record.uid, column).raw;
          return raw === undefined ? null : typeof raw === 'bigint' ? raw.toString() : raw;
        }),
      );
    },
    { rows, columns },
  );
}

/** 表示中のテーブル */
function activeTable(page: Page): Promise<string | null> {
  return page.getByTestId('grid').getAttribute('data-table');
}

/**
 * Googleスプレッドシートがクリップボードの text/plain を読むときと同じ規則で、TSV を表にする
 * （セルの区切りはタブ、行の区切りは改行。`"` で始まるセルは `"` で囲まれた値で、`""` は `"`。計画書 §8 の U-2）
 */
function readTsvLikeSheets(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  for (;;) {
    let value = '';
    if (text[i] === '"') {
      i++;
      for (;;) {
        const q = text.indexOf('"', i);
        if (q < 0) throw new Error('unterminated quote');
        value += text.slice(i, q);
        if (text[q + 1] === '"') {
          value += '"';
          i = q + 2;
        } else {
          i = q + 1;
          break;
        }
      }
    } else {
      while (i < text.length && text[i] !== '\t' && text[i] !== '\n' && text[i] !== '\r') value += text[i++];
    }
    row.push(value);
    if (i >= text.length) {
      rows.push(row);
      return rows;
    }
    if (text[i] === '\t') {
      i++;
      continue;
    }
    i += text[i] === '\r' && text[i + 1] === '\n' ? 2 : 1;
    rows.push(row);
    row = [];
    if (i >= text.length) return rows;
  }
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

test('1. 1,000 行 × 20 列のテーブルで、1 行目から下へドラッグしてグリッドの下端を越え、500 行目で離す → スクロールしながら範囲が伸び、1〜500 行目が選択される', async ({ page }) => {
  test.setTimeout(120_000);
  // 性能の確認用のプロジェクト（src/fs/largeSample.ts）を 1,000 行 × 20 列（共通列の id・version を含む）で生成し、直接保存方式で開く。
  // ?sample=large（1 万行 × 50 列）は使わない
  await mockDirectoryPicker(page);
  await page.goto('/');
  await putGeneratedProject(page, { rows: 1000, columns: 20, format: 'yaml' });
  await page.getByTestId('open-folder').click();
  await expect(page.locator('[data-testid=grid][data-table=big]')).toBeVisible({ timeout: 30_000 });
  const size = await page.evaluate(() => {
    type Sheet = { size: { rows: number; cols: number }; allColumns: unknown[] };
    const sheet = (globalThis as unknown as { masterdataMaker: { sheet(): Sheet } }).masterdataMaker.sheet();
    return { rows: sheet.size.rows, cols: sheet.size.cols, all: sheet.allColumns.length };
  });
  expect(size).toEqual({ rows: 1000, cols: 20, all: 20 });

  // 行の高さと、列ヘッダーの下端（グリッドの上端からの距離）を画面から求める
  const scroller = page.locator('.sc-grid-scroller');
  const box = await scroller.boundingBox();
  const firstRow = await page.locator('.sc-pane-frozen .sc-rowhead').first().boundingBox();
  if (box === null || firstRow === null) throw new Error('no grid');
  const rowHeight = firstRow.height;
  const headerHeight = firstRow.y - box.y;
  const rowCenterY = async (row: number) => box.y + headerHeight + row * rowHeight - (await scroller.evaluate((el) => el.scrollTop)) + rowHeight / 2;

  const start = await cellPoint(page, 0, 2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, box.y + box.height - 30, { steps: 4 });
  // グリッドの下端を越える（自動でスクロールする。FR-SEL-04）
  const viewportHeight = page.viewportSize()?.height ?? 900;
  await page.mouse.move(start.x, Math.min(box.y + box.height + 40, viewportHeight - 2), { steps: 4 });
  // スクロールしながら範囲が伸びる
  await expect.poll(async () => (await selection(page)).range.bottom, { timeout: 60_000 }).toBeGreaterThan(100);
  const midway = { bottom: (await selection(page)).range.bottom, scrollTop: await scroller.evaluate((el) => el.scrollTop) };
  expect(midway.scrollTop).toBeGreaterThan(0);
  // 500 行目がグリッドの下半分に来るまで待つ
  await page.waitForFunction(
    ({ headerHeight, rowHeight }) => {
      const el = document.querySelector<HTMLElement>('.sc-grid-scroller');
      return el !== null && headerHeight + 499 * rowHeight - el.scrollTop <= el.clientHeight * 0.6;
    },
    { headerHeight, rowHeight },
    { polling: 'raf', timeout: 90_000 },
  );
  const later = { bottom: (await selection(page)).range.bottom, scrollTop: await scroller.evaluate((el) => el.scrollTop) };
  expect(later.bottom).toBeGreaterThan(midway.bottom);
  expect(later.scrollTop).toBeGreaterThan(midway.scrollTop);
  // グリッドの中に戻すと自動スクロールが止まる。その位置で 500 行目を指して離す
  await page.mouse.move(start.x, box.y + box.height / 2, { steps: 2 });
  const y = await rowCenterY(499);
  expect(y).toBeGreaterThan(box.y + headerHeight);
  expect(y).toBeLessThan(box.y + box.height - 10);
  await page.mouse.move(start.x, y, { steps: 2 });
  await page.mouse.up();
  const sel = await selection(page);
  expect(sel.kind).toBe('cells');
  expect(sel.range).toEqual({ top: 0, bottom: 499, left: 2, right: 2 });
  // 行番号の強調も 500 行目まで
  await expect(page.locator('.sc-pane-frozen .sc-rowhead', { hasText: /^500$/ })).toHaveClass(/\bhl\b/);
  await expect(page.locator('.sc-pane-frozen .sc-rowhead', { hasText: /^501$/ })).not.toHaveClass(/\bhl\b/);
});

test('2. Googleスプレッドシートで 3 行 × 3 列（1 セルはセル内改行を含む）をコピーし、string 列 3 列に貼る。その後、逆方向にもコピーする → 両方向とも 9 個の値が一致する', async ({ page, context }) => {
  // Googleスプレッドシートが書き出すのと同じ形式のクリップボードの内容（text/plain の TSV と text/html）で試す。
  // Googleスプレッドシート本体との往復（本体からのコピーと本体への貼り付け）は手で確かめる（計画書 §7.3、§8 の U-2）
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const table = [
    'table: texts',
    'display_name: テキスト',
    'fields:',
    '  - name: a',
    '    type: string',
    '  - name: b',
    '    type: string',
    '  - name: c',
    '    type: string',
    'records:',
    '  - id: 1',
    '  - id: 2',
    '  - id: 3',
    '',
  ].join('\n');
  await openOpfsProject(page, { ...(await sampleFiles()), 'tables/texts.yaml': table });
  await page.getByTestId('sheet-tab-texts').click();
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'texts');

  const cells = [
    ['勇者アルス', '一行目\n二行目', 'SSR'],
    ['魔法使いリナ', 'say "hi"', '1,200'],
    ['盗賊カイ', 'stage_01', '50%'],
  ];
  // Googleスプレッドシートの text/plain: セル内改行を含むセルは " で囲み、" は "" にする。行の区切りは改行
  const plain = cells.map((row) => row.map((v) => (v.includes('\n') ? `"${v.replaceAll('"', '""')}"` : v)).join('\t')).join('\n');
  expect(plain).toBe('勇者アルス\t"一行目\n二行目"\tSSR\n魔法使いリナ\tsay "hi"\t1,200\n盗賊カイ\tstage_01\t50%');
  // Googleスプレッドシートの text/html: google-sheets-html-origin の印と表。セル内改行は <br>
  const td = (v: string) =>
    `<td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;${v.replaceAll('"', '\\&quot;').replaceAll('\n', '\\n')}&quot;}">${v.replaceAll('"', '&quot;').replaceAll('\n', '<br>')}</td>`;
  const html =
    '<meta charset="utf-8"><google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style>' +
    '<table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none" data-sheets-root="1">' +
    '<colgroup><col width="100"/><col width="100"/><col width="100"/></colgroup><tbody>' +
    cells.map((row) => `<tr style="height:21px;">${row.map(td).join('')}</tr>`).join('') +
    '</tbody></table>';
  await page.evaluate(
    ({ plain, html }) =>
      navigator.clipboard.write([
        new ClipboardItem({ 'text/plain': new Blob([plain], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) }),
      ]),
    { plain, html },
  );

  // Googleスプレッドシート → 本ツール
  await clickCell(page, 0, await colIndex(page, 'a'));
  await page.keyboard.press('Control+v');
  await expect.poll(() => values(page, [0, 1, 2], ['a', 'b', 'c'])).toEqual(cells);
  expect(await selection(page)).toMatchObject({ range: { top: 0, bottom: 2 } });

  // 本ツール → Googleスプレッドシート: 貼った 3 行 × 3 列を選んだままコピーし、クリップボードの text/plain を TSV として読む
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe('');
  const copied = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items[0];
    const plain = await (await item.getType('text/plain')).text();
    const html = item.types.includes('text/html') ? await (await item.getType('text/html')).text() : '';
    // text/html の表のセル（<br> は改行）
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = [...doc.querySelectorAll('tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((cell) => {
        for (const br of cell.querySelectorAll('br')) br.replaceWith('\n');
        return cell.textContent ?? '';
      }),
    );
    return { plain, rows };
  });
  expect(readTsvLikeSheets(copied.plain)).toEqual(cells);
  expect(copied.rows).toEqual(cells);
});

test('3. int 列の 3 セルに 10、abc、30 を貼る → どのセルも変わらず、「2 行目: abc は整数ではありません」と表示される', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openBasicSample(page);
  const before = await values(page, [0, 1, 2], ['hp']);
  expect(before).toEqual([[1200], [800], [650]]);
  await clickCell(page, 0, await colIndex(page, 'hp'));
  await page.evaluate(() => navigator.clipboard.writeText('10\nabc\n30'));
  await page.keyboard.press('Control+v');
  await expect(page.getByTestId('message-items')).toContainText('2 行目: abc は整数ではありません');
  await page.getByTestId('message-dialog').getByRole('button').click();
  expect(await values(page, [0, 1, 2], ['hp'])).toEqual(before);
  expect(await cellText(page, 0, 'hp')).toBe('1200');
  expect(await cellText(page, 1, 'hp')).toBe('800');
  expect(await cellText(page, 2, 'hp')).toBe('650');
  await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toHaveCount(0);
});

test('4. 1、2 の 2 セルを選び、フィルハンドルで下へ 3 セル分ドラッグする → 3、4、5 が入る', async ({ page }) => {
  await openBasicSample(page);
  // サンプルの character は 3 行なので、行番号の右クリックメニューで下に 2 行足して 5 行にする
  for (const row of [2, 3]) {
    await page.locator('.sc-rowhead').nth(row).click({ button: 'right' });
    await page.getByTestId('menu-row.insertBelow').click();
  }
  await expect(page.locator('.sc-pane-frozen .sc-rowhead')).toHaveCount(5);
  const hp = await colIndex(page, 'hp');
  await clickCell(page, 0, hp);
  await page.keyboard.type('1');
  await page.keyboard.press('Enter');
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  await clickCell(page, 0, hp);
  await page.keyboard.down('Shift');
  await clickCell(page, 1, hp);
  await page.keyboard.up('Shift');
  const handle = await page.getByTestId('fill-handle').boundingBox();
  if (handle === null) throw new Error('no fill handle');
  const target = await cellPoint(page, 4, hp);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, target.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => values(page, [0, 1, 2, 3, 4], ['hp'])).toEqual([[1], [2], [3], [4], [5]]);
  expect(await cellText(page, 2, 'hp')).toBe('3');
  expect(await cellText(page, 3, 'hp')).toBe('4');
  expect(await cellText(page, 4, 'hp')).toBe('5');
});

test('5. テーブル A の hp を 800 → 1000 に変え、保存せずにテーブル B を開いてから A に戻る → 1000 のまま。A のタブに未保存の印がある', async ({ page }) => {
  // A は character、B は skill
  await openBasicSample(page);
  const hp = await colIndex(page, 'hp');
  expect(await cellText(page, 1, 'hp')).toBe('800');
  await clickCell(page, 1, hp);
  await page.keyboard.type('1000');
  await page.keyboard.press('Enter');
  await page.getByTestId('sheet-tab-skill').click();
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'skill');
  await page.getByTestId('sheet-tab-character').click();
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'character');
  expect(await cellText(page, 1, 'hp')).toBe('1000');
  await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toBeVisible();
  await expect(page.getByTestId('sheet-tab-skill').getByTestId('tab-modified')).toHaveCount(0);
});

test('6. テーブル A を編集し、次に B を編集してから Ctrl+Z を 2 回押す → B の変更、A の変更の順に戻り、それぞれ該当テーブルが表示される', async ({ page }) => {
  // A は character の hp（1200 → 1300）、B は skill の cost（10 → 99）
  await openBasicSample(page);
  await clickCell(page, 0, await colIndex(page, 'hp'));
  await page.keyboard.type('1300');
  await page.keyboard.press('Enter');
  await page.getByTestId('sheet-tab-skill').click();
  await clickCell(page, 0, await colIndex(page, 'cost'));
  await page.keyboard.type('99');
  await page.keyboard.press('Enter');
  expect(await cellText(page, 0, 'cost')).toBe('99');

  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'skill');
  await expect.poll(() => cellText(page, 0, 'cost')).toBe('10');
  // A の変更はまだ残っている
  await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'character');
  await expect.poll(() => cellText(page, 0, 'hp')).toBe('1200');
  expect(await activeTable(page)).toBe('character');
  await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toHaveCount(0);
  await expect(page.getByTestId('sheet-tab-skill').getByTestId('tab-modified')).toHaveCount(0);
});

test('7. サンプルのプロジェクトを開き、何も変えずに保存する → どのファイルも 1 バイトも変わらない', async ({ page }) => {
  // 直接保存方式で試す: OPFS にサンプル（samples/basic-yaml と samples/basic-json）の全ファイルを置き、開いて Ctrl+S を押し、
  // 保存の前後で全ファイルのバイト列と更新日時を比べる。ファイルへの書き込み・作成・削除が 1 回も起きないことも確かめる
  await page.addInitScript(() => {
    const w = window as unknown as { __fsLog: string[]; __fsLogOn: boolean };
    w.__fsLog = [];
    w.__fsLogOn = false;
    const log = (entry: string) => {
      if (w.__fsLogOn) w.__fsLog.push(entry);
    };
    const file = FileSystemFileHandle.prototype as unknown as { createWritable(...args: unknown[]): Promise<unknown> };
    const createWritable = file.createWritable;
    file.createWritable = function (this: FileSystemFileHandle, ...args: unknown[]) {
      log(`write ${this.name}`);
      return createWritable.apply(this, args);
    };
    type DirProto = {
      removeEntry(...args: unknown[]): Promise<void>;
      getFileHandle(name: string, options?: { create?: boolean }): Promise<unknown>;
      getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<unknown>;
    };
    const dir = FileSystemDirectoryHandle.prototype as unknown as DirProto;
    const { removeEntry, getFileHandle, getDirectoryHandle } = dir;
    dir.removeEntry = function (this: FileSystemDirectoryHandle, ...args: unknown[]) {
      log(`remove ${String(args[0])}`);
      return removeEntry.apply(this, args);
    };
    dir.getFileHandle = function (this: FileSystemDirectoryHandle, name: string, options?: { create?: boolean }) {
      if (options?.create === true) log(`create ${name}`);
      return getFileHandle.call(this, name, options);
    };
    dir.getDirectoryHandle = function (this: FileSystemDirectoryHandle, name: string, options?: { create?: boolean }) {
      if (options?.create === true && name !== 'proj') log(`mkdir ${name}`);
      return getDirectoryHandle.call(this, name, options);
    };
  });
  await mockDirectoryPicker(page);
  const fsLog = () => page.evaluate(() => (window as unknown as { __fsLog: string[] }).__fsLog);

  for (const [sample, ext] of [
    ['basic-yaml', 'yaml'],
    ['basic-json', 'json'],
  ] as const) {
    const dir = join(SAMPLES, sample);
    const files = await sampleFiles(dir);
    // ディスク上のサンプルのバイト列（比べる基準）
    const original: Record<string, string> = {};
    for (const path of Object.keys(files)) original[path] = (await readFile(join(dir, path))).toString('hex');
    expect(Object.keys(original).length, sample).toBe(7);

    await page.goto('/');
    await putProject(page, files);
    const before = await snapshotOpfs(page);
    expect(Object.fromEntries(Object.entries(before).map(([p, f]) => [p, f.hex])), sample).toEqual(original);
    await page.evaluate(() => {
      (window as unknown as { __fsLogOn: boolean }).__fsLogOn = true;
    });
    await page.getByTestId('open-folder').click();
    await expect(page.getByTestId('grid')).toBeVisible();
    await expect(page.getByTestId('project-name')).toHaveText('proj');
    await expect(page.getByTestId('project-modified')).toHaveCount(0);

    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('status')).toHaveText('保存する変更はありません');
    const after = await snapshotOpfs(page);
    expect(after, sample).toEqual(before);
    expect(await fsLog(), sample).toEqual([]);

    // 補足（DR-30）: 1 セルを変えて保存し、元の値に戻してもう一度保存すると、書き直したファイルも元と 1 バイトも変わらない
    const defense = await colIndex(page, 'defense');
    const enterDefense = async (text: string) => {
      await clickCell(page, 0, defense);
      await page.keyboard.type(text);
      await page.keyboard.press('Enter');
    };
    // 書き込みと削除（フォルダやファイルのハンドルを作る呼び出しは除く）
    const writes = async () => (await fsLog()).filter((e) => e.startsWith('write ') || e.startsWith('remove '));
    const modified = page.getByTestId('sheet-tab-character').getByTestId('tab-modified');
    await enterDefense('31');
    await expect(modified).toBeVisible();
    await page.keyboard.press('Control+s');
    // 未保存の印は、書き込み（close() の完了）を待ってから消える
    await expect(modified).toHaveCount(0);
    expect(await writes(), sample).toEqual([`write character.${ext}`]);
    const changed = await snapshotOpfs(page);
    expect(Object.keys(changed).filter((p) => changed[p].hex !== original[p]), sample).toEqual([`tables/character.${ext}`]);
    await enterDefense('30');
    await expect(modified).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect(modified).toHaveCount(0);
    expect(await writes(), sample).toEqual([`write character.${ext}`, `write character.${ext}`]);
    const rewritten = await snapshotOpfs(page);
    expect(Object.fromEntries(Object.entries(rewritten).map(([p, f]) => [p, f.hex])), sample).toEqual(original);
    await page.evaluate(() => {
      const w = window as unknown as { __fsLog: string[]; __fsLogOn: boolean };
      w.__fsLog = [];
      w.__fsLogOn = false;
    });
  }
});

test('8. rarity が SSR、hp が 1200 のレコードに =IF(rarity = "SSR", hp * 2, hp) を入れる → 2400', async ({ page }) => {
  // Googleスプレッドシートで C2 に SSR、D2 に 1200 を入れて =IF(C2="SSR", D2*2, D2) が 2400 になることは、手で確かめる
  // （同じ式の計算は core の単体テストでも確かめている）
  await openBasicSample(page);
  expect(await values(page, [0], ['rarity', 'hp'])).toEqual([['SSR', 1200]]);
  // 実効HP（列レベル式 hp * (1 + defense / 100) の列）のセルに、セル単位式として入れる
  await clickCell(page, 0, await colIndex(page, 'effective_hp'));
  await page.keyboard.type('=IF(rarity = "SSR", hp * 2, hp)');
  await page.keyboard.press('Enter');
  await expect.poll(() => cellText(page, 0, 'effective_hp')).toBe('2400');
  expect(await values(page, [0], ['effective_hp'])).toEqual([[2400]]);
  await clickCell(page, 0, await colIndex(page, 'effective_hp'));
  await expect(page.getByTestId('formula-input')).toHaveValue('=IF(rarity = "SSR", hp * 2, hp)');
});

test('9. Firefox でプロジェクトのフォルダを読み込み、1 セル変えて保存する → 変更したテーブルのファイルがダウンロードされる。それを元のフォルダに置いて開き直すと、変更が反映されている', async ({ page }) => {
  // この開発環境には Firefox が無いので、Chromium で showDirectoryPicker を消してダウンロード保存方式にして試す（NFR-04 により、
  // 方式は API の有無で決まる）。フォルダは <input type="file" webkitdirectory> で読み込む。Firefox・Safari 本体での確認は手で行う
  await page.addInitScript(() => {
    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });
  // サンプルを一時フォルダに複製したものを、プロジェクトのフォルダとして使う（Playwright のフォルダの選択は、パスに ASCII 以外の文字が
  // あると動かないので、テストの名前が入る出力先ではなく OS の一時フォルダに置く）
  const temp = await mkdtemp(join(tmpdir(), 'masterdata-maker-e2e-'));
  try {
    const folder = join(temp, 'basic-yaml');
    await cp(join(SAMPLES, 'basic-yaml'), folder, { recursive: true });
    const tablePath = join(folder, 'tables', 'character.yaml');
    const original = await readFile(tablePath, 'utf8');

    const openFolder = async () => {
      const chooser = page.waitForEvent('filechooser');
      await page.getByTestId('open-folder').click();
      await (await chooser).setFiles(folder);
      await expect(page.getByTestId('grid')).toBeVisible();
      await expect(page.getByTestId('project-name')).toHaveText('basic-yaml');
    };
    await page.goto('/');
    await openFolder();
    // ダウンロード保存方式で開いている
    await expect(page.getByTestId('mode-badge')).toBeVisible();

    await clickCell(page, 1, await colIndex(page, 'hp'));
    await page.keyboard.type('1000');
    await page.keyboard.press('Enter');
    const download = page.waitForEvent('download');
    await page.keyboard.press('Control+s');
    const file = await download;
    // 変更したテーブルのファイルだけ（ZIP ではない）
    expect(file.suggestedFilename()).toBe('character.yaml');
    await expect(page.getByTestId('status')).toHaveText('character.yaml をダウンロードしました（1 ファイル）');
    await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toHaveCount(0);

    // 元のフォルダに置く。差分は変えたセルの 1 行だけ（R-2）
    await file.saveAs(tablePath);
    const saved = await readFile(tablePath, 'utf8');
    const changed = saved.split('\n').flatMap((line, i) => (line === original.split('\n')[i] ? [] : [[original.split('\n')[i], line]]));
    expect(changed).toEqual([['    hp: { value: 800, color: red, comment: 次回調整予定 }', '    hp: { value: 1000, color: red, comment: 次回調整予定 }']]);

    // 開き直すと、変更が反映されている
    await page.reload();
    await openFolder();
    expect(await cellText(page, 1, 'hp')).toBe('1000');
    expect(await values(page, [1], ['hp'])).toEqual([[1000]]);
    await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toHaveCount(0);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
