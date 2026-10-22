// キーボードだけでの操作（NFR-40）の画面テスト。
// 1 つ目のテストはマウスを使わずに、サンプルを開く → テーブルを切り替える → セルを選んで入力 → 範囲をコピーして貼り付け →
// 列の設定を開いて変える → 列幅を変える → 問題パネルを開いて問題の箇所へ移る → 保存、をひととおりこなす（page.mouse・click を使わない）。
// ほかのテストは、領域の間のフォーカスの移動（F6 / Shift+F6、Ctrl+Alt+.）と、領域の中のキー操作（矢印・Enter・Esc・Shift+F10）を確かめる
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { cellText, colIndex, nameBox } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

interface Focused {
  testId: string | null;
  region: string | null;
}

/** フォーカスのある要素の data-testid と、その要素がいる領域（data-region） */
function focused(page: Page): Promise<Focused> {
  return page.evaluate(() => {
    const el = document.activeElement;
    return { testId: el?.getAttribute('data-testid') ?? null, region: el?.closest('[data-region]')?.getAttribute('data-region') ?? null };
  });
}

/** 開いているメニューの、選んでいる項目の data-testid */
function activeMenuItem(page: Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector('.sc-menu .sc-menu-item.active')?.getAttribute('data-testid') ?? null);
}

/** 開いているメニューで ↓ を押して項目まで動き、Enter で選ぶ */
async function chooseMenuItem(page: Page, testId: string): Promise<void> {
  await expect(page.locator('.sc-menu').first()).toBeVisible();
  for (let i = 0; i < 40; i++) {
    if ((await activeMenuItem(page)) === testId) {
      await page.keyboard.press('Enter');
      return;
    }
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`menu item ${testId} not found`);
}

/** Tab で、その要素にフォーカスが来るまで進む */
async function tabTo(page: Page, testId: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    if ((await focused(page)).testId === testId) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`${testId} is not reachable with Tab`);
}

/** 表示中のテーブルの列幅（ピクセル） */
function columnWidth(page: Page, column: string): Promise<number | undefined> {
  return page.evaluate((name) => {
    type Store = { sheet(): { columns: { name: string; width: number }[] } | null };
    return (globalThis as unknown as { masterdataMaker: Store }).masterdataMaker.sheet()?.columns.find((c) => c.name === name)?.width;
  }, column);
}

/** セル位置の表示に位置を入れて移る（Shift+F6 で数式バーの領域へ入り、Enter で入力欄にする） */
async function goTo(page: Page, location: string): Promise<void> {
  await page.keyboard.press('Shift+F6');
  await expect.poll(() => focused(page)).toEqual({ testId: 'name-box', region: 'formulaBar' });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('name-box-input')).toBeFocused();
  await page.keyboard.type(location);
  await page.keyboard.press('Enter');
  await expect(nameBox(page)).toHaveText(location);
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'cell-input', region: 'main' });
}

test('マウスを使わずに、サンプルを開く → テーブルを切り替える → 入力 → コピーと貼り付け → 列の設定 → 列幅 → 問題の箇所へ移る → 保存', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await expect(page.getByTestId('start-screen')).toBeVisible();

  // 1. サンプルを開く: Alt+Shift+F でファイルのメニューを開き、↓ と Enter で選ぶ
  await page.keyboard.press('Alt+Shift+F');
  await expect(page.getByTestId('menu-file')).toBeVisible();
  await chooseMenuItem(page, 'menu-file.openSample');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'character');
  await expect.poll(() => focused(page)).toEqual({ testId: 'cell-input', region: 'main' });
  await expect(nameBox(page)).toHaveText('character / id / 1');

  // 2. テーブルを切り替える: F6 でシートタブへ移り（表示中のタブにフォーカスが入る）、→ で隣のタブ、Enter で開く
  await page.keyboard.press('F6');
  await expect.poll(() => focused(page)).toEqual({ testId: 'sheet-tab-character', region: 'sheetTabs' });
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => focused(page)).toEqual({ testId: 'sheet-tab-skill', region: 'sheetTabs' });
  // タブにフォーカスがある間の矢印キーは、グリッドの選択を動かさない
  await expect(nameBox(page)).toHaveText('character / id / 1');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'skill');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'cell-input' });
  // 全シートの一覧（Alt+Shift+K）から character に戻る
  await page.keyboard.press('Alt+Shift+K');
  await expect(page.getByTestId('sheet-list-menu')).toBeVisible();
  await chooseMenuItem(page, 'sheet-list-character');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'character');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'cell-input' });

  // 3. セルを選んで入力: セル位置の表示に「character / hp / 3」を入れて移り、1500 と打って Enter
  await goTo(page, 'character / hp / 3');
  await page.keyboard.type('1500');
  await page.keyboard.press('Enter');
  await expect.poll(() => cellText(page, 2, 'hp')).toBe('1500');

  // 4. 範囲をコピーして貼り付け: hp の 1〜2 行目を Shift+↓ で選んで Ctrl+C、右の defense の 1 行目で Ctrl+V
  const hp = await colIndex(page, 'hp');
  const defense = await colIndex(page, 'defense');
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < hp; i++) await page.keyboard.press('ArrowRight');
  await expect(nameBox(page)).toHaveText('character / hp / 1');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('1200\n800');
  for (let i = hp; i < defense; i++) await page.keyboard.press('ArrowRight');
  await expect(nameBox(page)).toHaveText('character / defense / 1');
  await page.keyboard.press('Control+v');
  await expect.poll(() => cellText(page, 0, 'defense')).toBe('1200');
  expect(await cellText(page, 1, 'defense')).toBe('800');

  // 5. 列の設定を開いて変える: Ctrl+Space で列を選び、Shift+F10 で列ヘッダーのメニュー →「列の設定」。Tab で表示名へ進んで書き換え、Enter
  await page.keyboard.press('Control+Space');
  await page.keyboard.press('Shift+F10');
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await expect(page.getByTestId('context-menu').getByTestId('menu-column.resize')).toBeVisible();
  await chooseMenuItem(page, 'menu-column.settings');
  await expect(page.getByTestId('column-settings-dialog')).toBeVisible();
  await tabTo(page, 'col-display_name');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('防御');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('column-settings-dialog')).toHaveCount(0);
  await expect(page.locator(`.sc-colhead[data-col="${defense}"] .sc-colhead-title`)).toHaveText('防御');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'cell-input' });

  // 6. 列幅を変える: Shift+→ で effective_hp まで列の選択を広げ、Shift+F10 →「列のサイズを変更」で 150 ピクセルに。Ctrl+Z の 1 回で両方戻る
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+F10');
  await chooseMenuItem(page, 'menu-column.resize');
  const resize = page.getByTestId('column-resize-dialog');
  await expect(resize).toContainText('2 列のサイズを変更');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'column-resize-width' });
  // 範囲の外の値は受け付けない
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('column-resize-error')).toContainText('24〜2000 の整数を入力してください');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('150');
  await page.keyboard.press('Enter');
  await expect(resize).toHaveCount(0);
  await expect.poll(() => columnWidth(page, 'defense')).toBe(150);
  expect(await columnWidth(page, 'effective_hp')).toBe(150);
  await page.keyboard.press('Control+z');
  await expect.poll(() => columnWidth(page, 'defense')).toBe(100);
  expect(await columnWidth(page, 'effective_hp')).toBe(100);
  await page.keyboard.press('Control+y');
  await expect.poll(() => columnWidth(page, 'defense')).toBe(150);
  // 既定の幅に戻す: ダイアログの ↓（ラジオボタン）で選ぶ
  await page.keyboard.press('Shift+F10');
  await chooseMenuItem(page, 'menu-column.resize');
  await expect(resize).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'column-resize-pixels' });
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('column-resize-default')).toBeChecked();
  await page.keyboard.press('Enter');
  await expect(resize).toHaveCount(0);
  await expect.poll(() => columnWidth(page, 'defense')).toBe(100);
  expect(await columnWidth(page, 'effective_hp')).toBe(100);
  // 150 に戻しておく（保存したファイルで確かめる）
  await page.keyboard.press('Control+z');
  await expect.poll(() => columnWidth(page, 'effective_hp')).toBe(150);

  // 7. 問題パネルを開いて問題の箇所へ移る: hp の 1 行目と 3 行目に検査ルール（min: 1）に違反する 0 を入れ、別のテーブルへ移ってから、
  //    表示メニュー（Alt+Shift+V）→「問題」。開くとフォーカスがパネルの一覧に入るので、↓ で 3 件目を選んで Enter
  //    （4 で貼った defense の 1200 も検査ルール（max: 999）の違反になり、問題は 3 件）
  await goTo(page, 'character / hp / 1');
  await page.keyboard.type('0');
  await page.keyboard.press('Enter');
  await goTo(page, 'character / hp / 3');
  await page.keyboard.type('0');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+Shift+PageDown');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'skill');
  await page.keyboard.press('Alt+Shift+V');
  await chooseMenuItem(page, 'menu-panel.problems');
  const panel = page.getByTestId('problems-panel');
  await expect(panel).toBeVisible();
  await expect.poll(() => focused(page)).toEqual({ testId: 'problems-list', region: 'panelBottom' });
  await expect(panel.getByTestId('problem-row')).toHaveCount(3);
  const activeRow = panel.locator('.sc-problems-row.active');
  await expect(activeRow.locator('.key')).toHaveText('1');
  await page.keyboard.press('ArrowDown');
  await expect(activeRow.locator('.column')).toHaveText('defense');
  await page.keyboard.press('ArrowDown');
  await expect(activeRow.locator('.key')).toHaveText('3');
  await expect(activeRow.locator('.column')).toHaveText('hp');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'character');
  await expect(nameBox(page)).toHaveText('character / hp / 3');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'cell-input', region: 'main' });
  // Ctrl+Alt+. でパネルへ戻り、Home で先頭の問題へ。Esc でグリッドへ
  await page.keyboard.press('Control+Alt+.');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'problems-list' });
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(nameBox(page)).toHaveText('character / hp / 1');
  await page.keyboard.press('Control+Alt+.');
  await page.keyboard.press('Escape');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'cell-input' });

  // 8. 保存（Ctrl+S）。サンプルはダウンロード保存方式なので、変えたテーブルのファイルがダウンロードされる
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const file = await download;
  expect(file.suggestedFilename()).toBe('character.yaml');
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(await file.path(), 'utf8');
  expect(text).toContain('display_name: 防御');
  expect(text).toMatch(/column_widths: \{[^}]*defense: 150[^}]*effective_hp: 150[^}]*\}/);
  expect(text).toContain('  - id: 1\n    name: 勇者アルス\n    rarity: SSR\n    hp: 0\n    defense: 1200\n');
  expect(text).toContain('defense: { value: 800, color: red, comment: 次回調整予定 }');
  await expect(page.getByTestId('sheet-tab-character').getByTestId('tab-modified')).toHaveCount(0);
});

/** キーで開いたパネルを含めて、サンプルを開いた状態にする（右に セル情報、下に 問題） */
async function openWithPanels(page: Page): Promise<void> {
  await page.goto('/?sample=basic');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'character');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'cell-input' });
  for (const id of ['menu-panel.problems', 'menu-panel.cellInfo']) {
    await page.keyboard.press('Alt+Shift+V');
    await chooseMenuItem(page, id);
  }
  await expect(page.getByTestId('problems-panel')).toBeVisible();
  await expect(page.getByTestId('cell-info-panel')).toBeVisible();
  // パネルを開くと、そのパネルにフォーカスが入る（セル情報パネルは本体）
  await expect.poll(() => focused(page)).toEqual({ testId: null, region: 'panelRight' });
  await page.keyboard.press('Escape');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'cell-input', region: 'main' });
}

test('F6 / Shift+F6 で、パネル・シートタブ・タイトル・メニューバー・ツールバー・数式バー・グリッドの順に巡回する', async ({ page }) => {
  await openWithPanels(page);
  const forward = ['panelBottom', 'panelRight', 'sheetTabs', 'title', 'menubar', 'toolbar', 'formulaBar', 'main'];
  const seen: (string | null)[] = [];
  for (let i = 0; i < forward.length; i++) {
    await page.keyboard.press('F6');
    seen.push((await focused(page)).region);
  }
  expect(seen).toEqual(forward);
  const back: (string | null)[] = [];
  for (let i = 0; i < forward.length; i++) {
    await page.keyboard.press('Shift+F6');
    back.push((await focused(page)).region);
  }
  expect(back).toEqual(['formulaBar', 'toolbar', 'menubar', 'title', 'sheetTabs', 'panelRight', 'panelBottom', 'main']);

  // 各領域で最初にフォーカスが入る要素
  const firstOf = async (region: string) => {
    for (let i = 0; i < forward.length && (await focused(page)).region !== region; i++) await page.keyboard.press('F6');
    return focused(page);
  };
  expect(await firstOf('title')).toEqual({ testId: 'mode-badge', region: 'title' });
  expect(await firstOf('menubar')).toEqual({ testId: 'menubar-file', region: 'menubar' });
  expect(await firstOf('toolbar')).toMatchObject({ region: 'toolbar' });
  expect(await firstOf('formulaBar')).toEqual({ testId: 'name-box', region: 'formulaBar' });
  expect(await firstOf('panelBottom')).toEqual({ testId: 'problems-list', region: 'panelBottom' });
  expect(await firstOf('sheetTabs')).toEqual({ testId: 'sheet-tab-character', region: 'sheetTabs' });

  // Ctrl+Alt+. はパネルの間を行き来する
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Alt+.');
  const first = (await focused(page)).region;
  await page.keyboard.press('Control+Alt+,');
  const second = (await focused(page)).region;
  expect([first, second].sort()).toEqual(['panelBottom', 'panelRight']);
});

test('領域の中のキー操作: メニューバー・ツールバー・シートタブは ← → で動き、Esc でグリッドへ戻る。キーはグリッドへ漏れない', async ({ page }) => {
  await page.goto('/?sample=basic');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-table', 'character');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'cell-input' });

  // メニューバー: → で隣のメニューへ、Enter で開き、Esc でグリッドへ
  for (let i = 0; i < 8 && (await focused(page)).region !== 'menubar'; i++) await page.keyboard.press('F6');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'menubar-file' });
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'menubar-edit' });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('menu-edit')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu-edit')).toHaveCount(0);
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'cell-input' });
  await expect(nameBox(page)).toHaveText('character / id / 1');

  // ツールバー: ← → で動き、Enter で押す（元に戻すが使えるように 1 つ編集しておく）
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('テスト');
  await page.keyboard.press('Enter');
  await expect.poll(() => cellText(page, 0, 'name')).toBe('テスト');
  for (let i = 0; i < 8 && (await focused(page)).region !== 'toolbar'; i++) await page.keyboard.press('F6');
  const firstTool = (await focused(page)).testId;
  await page.keyboard.press('ArrowRight');
  expect((await focused(page)).testId).not.toBe(firstTool);
  await page.keyboard.press('ArrowLeft');
  expect((await focused(page)).testId).toBe(firstTool);
  for (let i = 0; i < 10 && (await focused(page)).testId !== 'toolbar-edit.undo'; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'toolbar-edit.undo' });
  // フォーカスがツールバーにある間の ↓ は、グリッドの選択を動かさない
  const before = await nameBox(page).textContent();
  await page.keyboard.press('ArrowDown');
  await expect(nameBox(page)).toHaveText(before ?? '');
  await page.keyboard.press('Enter');
  await expect.poll(() => cellText(page, 0, 'name')).toBe('勇者アルス');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'cell-input' });

  // シートタブ: Shift+F10 でタブの右クリックメニュー、Esc で閉じてグリッドへ。≡（全シートの一覧）は Esc で閉じると ≡ に戻る
  for (let i = 0; i < 8 && (await focused(page)).region !== 'sheetTabs'; i++) await page.keyboard.press('F6');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'sheet-tab-character' });
  await page.keyboard.press('Shift+F10');
  await expect(page.getByTestId('context-menu').getByTestId('menu-table.rename')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('context-menu')).toHaveCount(0);
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'cell-input' });
  await page.keyboard.press('F6');
  await page.keyboard.press('Home');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'sheet-add' });
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'sheet-list' });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sheet-list-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sheet-list-menu')).toHaveCount(0);
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'sheet-list' });
  // F2 でタブの名前の変更
  await page.keyboard.press('End');
  await expect.poll(() => focused(page)).toMatchObject({ region: 'sheetTabs' });
  await page.keyboard.press('F2');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 編集中に F6 を押すと、確定してから移る
  await page.keyboard.press('Control+Home');
  await expect.poll(() => focused(page)).toMatchObject({ testId: 'cell-input' });
  await goTo(page, 'character / hp / 1');
  await page.keyboard.type('1300');
  await page.keyboard.press('F6');
  await expect.poll(() => focused(page)).toMatchObject({ region: 'sheetTabs' });
  await expect.poll(() => cellText(page, 0, 'hp')).toBe('1300');
});
