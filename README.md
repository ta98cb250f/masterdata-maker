# MasterData Maker

MasterData Maker は、ゲームのマスターデータを Googleスプレッドシートと同じ画面と操作で編集する、ブラウザで動く Web アプリです。キー操作・マウス操作・数式・範囲のコピーと貼り付けは Googleスプレッドシートに合わせ、迷ったときは Googleスプレッドシートの挙動を正解とします（要件定義書 R-1）。シートの中身は 1 シート＝1 ファイルの YAML または JSON（プロジェクトごとに選ぶ）として保存し、1 セル変えたらファイルの差分もおおむね 1 行になる形で書き出します（R-2）。

- 公開版（GitHub Pages）: https://ta98cb250f.github.io/masterdata-maker/
- 要件定義書: [docs/requirements.md](docs/requirements.md)
- 実装計画書（ライブラリの選定・設計の判断 P-xx・テスト計画・未検証事項）: [docs/plan.md](docs/plan.md)
- 要件の対応表（要件ごとの実装・テスト・状態と、抜けと食い違いの一覧）: [docs/traceability.md](docs/traceability.md)

## 動かし方

### 必要なもの

- Node.js 22（開発は 22.22 で確認。CLI は Node.js 20 以降向けにまとめる）
- pnpm 10（`package.json` の `packageManager` は pnpm@10.28.0。`corepack enable` で使える）

### 依存のインストール

```sh
pnpm install
```

### 開発サーバー

```sh
pnpm dev
```

Vite の開発サーバー（既定は http://localhost:5173 ）が起動します。開始画面で「フォルダを開く」「GitHub のリポジトリを開く」「サンプルを開く」を選びます。URL に `?sample=basic` を付けると組み込みのサンプル（`samples/basic-yaml`）を、`?sample=large` を付けると性能の確認用の 1 万行 × 50 列のテーブルを含むプロジェクト（メモリ上で生成）を開きます。

### ビルド（静的ホスティング用）

```sh
pnpm build                                    # 画面と CLI の両方
pnpm --filter @masterdata-maker/app build     # 画面だけ（packages/app/dist に出力）
```

`packages/app/dist` をそのまま静的ホスティングに置けば動きます（サーバー側の処理はありません。NFR-06、NFR-07）。相対パスで出力するので、サブディレクトリに置いてもかまいません。直接保存方式の `showDirectoryPicker()` は安全なコンテキストでしか使えないので、HTTPS で配ってください（`localhost` は安全なコンテキストとして扱われます）。ローカルで確かめるときは `pnpm --filter @masterdata-maker/app preview` を使います。

### GitHub Pages への公開

[.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) が画面をビルドし、`packages/app/dist` を GitHub Pages に公開します。公開先は https://ta98cb250f.github.io/masterdata-maker/ で、リポジトリ名とオーナー名を変えない限り変わりません。

- 自動: `main` に push したとき
- 手動: GitHub の Actions タブで「Deploy to GitHub Pages」を選び、「Run workflow」で実行する（`github-pages` 環境の既定の保護で、公開できるのは `main` からだけ）
- 初回だけ、リポジトリの Settings → Pages → Build and deployment → Source を「GitHub Actions」にしておく
- 公開の前に [.github/workflows/ci.yml](.github/workflows/ci.yml) の型検査・単体テスト・画面テストを動かし、どれかが通らなければ公開しない（性能の計測は待たない）

### テスト

```sh
pnpm typecheck    # 型検査（TypeScript 7.0、全パッケージ）
pnpm test         # 単体テスト（Vitest。core・cli・app）
pnpm e2e          # 画面テスト（Playwright、Chromium）
```

- 画面テストは、画面をビルドして `vite preview` で配り、Chromium で動かします。初めて動かす環境では `pnpm --filter @masterdata-maker/app exec playwright install chromium` でブラウザを入れてください（すでに入っているブラウザを使うなら、環境変数 `PLAYWRIGHT_BROWSERS_PATH` で場所を指定します）
- 複数の画面テストを同時に動かすときは、ポートとビルドの出力先を環境変数で変えます: `cd packages/app && E2E_PORT=4174 E2E_OUTDIR=dist-e2e-x pnpm exec playwright test --output test-results-x`
- 要件定義書 §5.17 の受け入れ基準 1〜9 は [packages/app/e2e/acceptance.spec.ts](packages/app/e2e/acceptance.spec.ts) に、番号順に並べてあります。手で確かめる必要があるもの（Googleスプレッドシート本体・Firefox・Safari）は、各テストの注記と下の「既知の制限と未検証の事項」に書きました
- 性能の確認（NFR-10〜12）は [packages/app/e2e/perf.spec.ts](packages/app/e2e/perf.spec.ts) と [packages/app/e2e/worker.spec.ts](packages/app/e2e/worker.spec.ts) で、測った値を `[perf]` で始まる行で標準出力に出します
- `pnpm e2e` は全件を動かします。perf.spec.ts だけを分けるときは `cd packages/app && pnpm exec playwright test --project=perf`（それ以外は `--project=chromium`）
- プルリクエストでは [.github/workflows/ci.yml](.github/workflows/ci.yml) が型検査・単体テスト・画面テスト（`chromium`）を動かします。perf.spec.ts は実行環境で揺れるので別のジョブで測るだけにし、落ちても CI を失敗にしません（必須のチェックにはしない）。プルリクエストにしていないブランチは、Actions タブで「CI」を選んで「Run workflow」で動かせます

### CLI

```sh
pnpm --filter @masterdata-maker/cli build    # packages/cli/dist/cli.mjs（Node.js 用の 1 ファイル）
node packages/cli/dist/cli.mjs <コマンド> [プロジェクトのフォルダ] [オプション]
```

プロジェクトのフォルダを省略すると、カレントディレクトリを使います。検査と出力は画面と同じ処理（`packages/core`）を使います（FR-VAL-11）。

| コマンド | 内容 |
|---|---|
| `validate` | 全テーブルを検査する。エラーがあれば終了コード 1（警告だけなら 0） |
| `export [--force] [--tables <テーブル,…>] [--out <フォルダ>] [--format json\|yaml\|csv\|protobuf] [--until <版>]` | 出力ファイル（ゲームが読むファイル）を作る。出力先の既定はプロジェクト設定の `output.out_dir`、形式の既定は `output.format`。`--until` を付けると、`version` 列がその版（semver）以下のレコードだけを出す（`version` が空のレコードは常に出す。FR-OUT-07）。検査エラーがあれば、`--force` が無い限り出力しない（終了コード 1） |
| `new <テーブル> [--display-name <表示名>]` | 共通列を含むテーブルの雛形を作る |
| `fmt [--check]` | 全ファイルを正規形で書き直す。`--check` なら書き直さずに確かめ、正規形でないファイルがあれば終了コード 1 |
| `convert --to yaml\|json` | リソースファイル（設定・共通設定・テーブル）の形式を変える |

共通のオプションは `--lang ja|en`（メッセージの言語。既定は ja）と `-h` / `--help`（使い方）です。

| 終了コード | 意味 |
|---|---|
| 0 | 成功 |
| 1 | 検査エラーがある、または `fmt --check` で正規形でないファイルがある |
| 2 | 使い方の誤り、またはプロジェクトの読み込みの失敗 |

例:

```sh
node packages/cli/dist/cli.mjs validate samples/basic-yaml
node packages/cli/dist/cli.mjs export samples/basic-yaml --out /tmp/out
node packages/cli/dist/cli.mjs export samples/basic-yaml --format protobuf --out /tmp/pb
node packages/cli/dist/cli.mjs export samples/basic-yaml --until 0.1.10 --out /tmp/until-0.1.10
node packages/cli/dist/cli.mjs new item --display-name アイテム path/to/project
node packages/cli/dist/cli.mjs fmt --check path/to/project
node packages/cli/dist/cli.mjs convert --to json path/to/project
```

## 対応ブラウザと保存の方式

対象はデスクトップ版の Chrome・Edge・Firefox・Safari の最新の安定版です（NFR-01）。ファイルの読み書きには 2 つの方式があり、どちらになるかはブラウザの名前ではなく、`showDirectoryPicker()`（File System Access API）が使えるかどうかで自動的に決まります（NFR-04）。

| 方式 | 使うとき | 開く | 保存（Ctrl+S） |
|---|---|---|---|
| 直接保存方式 | `showDirectoryPicker()` がある（2026-10 時点では Chrome・Edge） | 選んだフォルダを直接読み書きする。前回のフォルダを覚えていて、次に起動したときに開き直せる | 変更のあるファイルだけを、そのフォルダに直接書き込む（`createWritable()` の `close()` の完了を待つ。NFR-15） |
| ダウンロード保存方式 | `showDirectoryPicker()` が無い（Firefox・Safari など） | `<input type="file" webkitdirectory>` でフォルダを読み込む（読み込み専用） | 変更したファイルをダウンロードする（1 ファイルならそのファイル、複数ならフォルダ構成を保った ZIP）。元のフォルダに置き直すのは手作業 |

ダウンロード保存方式では、前回のフォルダの記憶（FR-FIO-01）、ほかのエディタや Git による変更の検知（FR-FIO-07）、フォルダへの直接の保存が使えません。開始画面とタイトルバーの印で、使えない機能を示します（NFR-05）。組み込みのサンプル（「サンプルを開く」）はメモリ上で開き、保存はダウンロード保存方式になります（P-45）。

### GitHub のリポジトリを開く（GitHub 方式）

開始画面かファイルメニューの「GitHub のリポジトリを開く」で、GitHub のリポジトリの中のプロジェクトのフォルダを開けます（FR-GH-01〜05、計画書 P-67）。ローカルのフォルダを開く方式はそのまま使えます。

1. GitHub の [Fine-grained personal access token の作成画面](https://github.com/settings/personal-access-tokens/new) でトークンを作ります。Repository access で対象のリポジトリだけを選び、Permissions の Contents と Pull requests を「Read and write」にします（Metadata の Read は自動で付きます）
2. ダイアログにトークンとリポジトリ（`owner/repo` か GitHub の URL）を入れて「接続」し、ブランチとフォルダ（`masterdata-maker.yaml` のあるフォルダ。一覧から選べます）を選んで「開く」
3. 編集して Ctrl+S を押すと、コミットのダイアログが出ます。「新しいブランチを作ってコミットする」か「今のブランチにコミットする」を選び、必要なら「プルリクエストを作る」でマージ先・タイトル・説明を入れます。変更したファイルは 1 つのコミットにまとめて送ります
4. タイトルバーの右の「ブランチ: …」を押すと、別のブランチで開き直せます

- 通信はブラウザから GitHub の REST API（api.github.com）へ直接行います。サーバーは使いません（NFR-07 の例外は GitHub 方式のときだけ）
- トークンは既定ではタブを閉じると忘れます（sessionStorage）。「この端末にトークンを記憶する」を選ぶと localStorage に残ります。共用の端末では記憶しないでください。記憶したトークンはダイアログの「覚えているトークンを消す」で消せます。トークンの有効期限は短くしておくことを勧めます
- sessionStorage・localStorage は同じ配信元のページから読めます。GitHub Pages の配信元は `<owner>.github.io` なので、同じ持ち主のほかのリポジトリの Pages からもトークンを読めてしまいます。ほかの Pages を公開しているアカウントでは、独自ドメインか、このアプリ専用のアカウント・組織の Pages で配ることを勧めます。ビルドした画面は Content-Security-Policy で通信先を自分と api.github.com に限っています
- 今のブランチが他で進んでいたら、今のブランチへのコミットは失敗し、上書きしません。新しいブランチにコミットしてください
- 画面からの出力（出力のダイアログ）は、GitHub 方式ではダウンロードになります（出力したファイルはコミットに入りません）
- ほかのエディタや Git による変更の検知（FR-FIO-07）はありません

どの方式でも保存は手動（Ctrl+S）で、自動保存はしません（D-7）。未保存の変更はブラウザの中（IndexedDB）に随時退避し、異常終了した後に開き直すと復元を提案します（FR-FIO-06）。

## キーボードだけでの操作

マウスを使わずに、すべての操作ができます（NFR-40）。キーの一覧は Ctrl+/（Mac は ⌘+/）で出ます。セルの移動・選択・編集・コピーと貼り付けなどのキーは Googleスプレッドシートと同じです（R-1）。

| したいこと | キー |
|---|---|
| メニューを開く | Alt+Shift+F（ファイル）・E（編集）・V（表示）・I（挿入）・D（データ）・H（ヘルプ）。Mac は Option+Shift+F など。開いたメニューは ↑↓ で選んで Enter、← → で隣のメニュー、→ でサブメニュー |
| 右クリックメニューを開く | Shift+F10 か ContextMenu キー。行全体を選んでいれば行番号の、列全体を選んでいれば列ヘッダーの、それ以外はセルのメニューを出す。シートタブにフォーカスがあれば、タブのメニュー |
| 領域の間を移る | F6 / Shift+F6。メニューバー → ツールバー → 数式バー → グリッド → 下のパネル → 右のパネル → シートタブ → タイトル（ダウンロード保存方式の印）の順に巡回する。グリッドの中の Tab はセルの移動なので、グリッドを出るには F6 を使う。編集中なら確定してから移る |
| 開いているパネルへ移る | Ctrl+Alt+. か Ctrl+Alt+,（Mac は ⌘+Option+. / ⌘+Option+,）。表示メニューからパネルを開いたときも、フォーカスはそのパネルへ移る |
| 領域の中で動く | メニューバー・ツールバー・シートタブは ← → と Home / End で動き、Enter・Space で押す。問題パネルの一覧は ↑↓・Home / End・PageUp / PageDown で選び、Enter で該当するセルへ移る。シートタブでは Enter でそのテーブルを開き、F2 で名前を変える。どの領域でも Esc でグリッドへ戻る |
| 全シートの一覧 | Alt+Shift+K（シートタブの ≡ と同じ一覧） |
| セルの位置を指定して移る | F6 / Shift+F6 で数式バーの領域へ入る（セル位置の表示にフォーカスが入る）→ Enter →「テーブル / 列名 / 主キー」を入れて Enter。Tab で数式の入力欄へ |
| 列幅を変える | Ctrl+Space で列を選び（Shift+→ で広げる）、Shift+F10 →「列のサイズを変更」（表示メニューにもある）。ピクセル数（24〜2000）か既定の幅（100）を選び、選んだ列すべてに当てる。Ctrl+Z の 1 回で戻る |
| ダイアログ | Tab / Shift+Tab でダイアログの中を巡回し、Enter で確定、Esc で閉じる。中身が収まらずにスクロールする部分には Tab で止まり、↑↓・PageUp / PageDown でスクロールできる |

マウスでしかできないように見える操作は、次のキー操作で代わりができます。

| マウスの操作 | 代わりのキー操作 |
|---|---|
| 列の境界のドラッグ（列幅） | 上の「列のサイズを変更」 |
| 行番号・列ヘッダーのドラッグ（並べ替え） | 編集メニューの「行を上へ移動」「行を下へ移動」「列を左へ移動」「列を右へ移動」 |
| 範囲の枠のドラッグ（移動） | Ctrl+X → Ctrl+V |
| フィルハンドルのドラッグ | Ctrl+D / Ctrl+R、編集メニューの「連番を入力」 |
| 列ヘッダーのフィルタのボタン | データメニューの「フィルタ」（列ヘッダーの右クリックメニューにもある） |
| メモにマウスを重ねる | Shift+F2（メモの編集欄）か、セル情報パネル |
| 参照列のセルの Ctrl+クリック | 右クリックメニューの「参照先へ移動」 |
| 非表示の列の印のクリック | 表示メニューの「非表示の列を表示」 |

## プロジェクトの構成

プロジェクトは、プロジェクト設定ファイル（`masterdata-maker.yaml` か `masterdata-maker.json`）を置いたフォルダです（DR-01、P-01）。

```
my-project/
  masterdata-maker.yaml  プロジェクト設定（masterdata-maker.json でもよい。両方あればエラー）
  config/                共通設定（paths.config）。拡張子は storage.format に従う（P-02）
    enums.yaml           列挙型
    base_fields.yaml     共通列（無ければ id と version）
    colors.yaml          セル色のプリセット（無ければ 8 色）
  tables/                テーブル（paths.tables）。1 テーブル＝1 ファイル（<table>.<拡張子>）
    character.yaml
    skill.yaml
  build/                 出力先（output.out_dir）。CLI の export と画面の「出力」が書き込む
```

プロジェクト設定（[samples/basic-yaml/masterdata-maker.yaml](samples/basic-yaml/masterdata-maker.yaml)）:

```yaml
format_version: 1
storage:
  format: yaml          # リソースファイルの形式: yaml | json（1 つのプロジェクトの中で混在させない）
timezone: Asia/Tokyo    # 日時の表示・入力に使うタイムゾーン
paths:
  tables: tables/
  config: config/
output:
  format: json          # 出力ファイルの形式: json | yaml | csv | protobuf（既定は json）
  out_dir: build/
```

テーブルファイルの例（[samples/basic-yaml/tables/character.yaml](samples/basic-yaml/tables/character.yaml) の一部）。共通列（`id`・`version`）は `fields` に書かず、レコードの先頭に値を書きます（P-03）。セル色・メモ・セル単位式のあるセルは `{ value, override, color, comment }` の 1 行で書きます（DR-11、DR-33）。

```yaml
table: character
display_name: キャラクター
fields:
  - name: name
    type: string
    display_name: 名前
    validation: { required: true, max_length: 20 }
  - name: rarity
    type: enum
    display_name: レアリティ
    enum_ref: rarity
  - name: hp
    type: int
    display_name: HP
    validation: { required: true, min: 1, max: 99999 }
    anomaly: { warn_above: 5000 }
  - name: defense
    type: int
    display_name: 防御力
    default: 0
  - name: effective_hp
    type: float
    display_name: 実効HP
    formula: hp * (1 + defense / 100)
  - name: skill_ids
    type: list<int>
    display_name: スキル
    ref: skill.id
records:
  - id: 1
    name: 勇者アルス
    rarity: SSR
    hp: 1200
    defense: 30
    skill_ids: [1, 3]
  - id: 2
    name: 魔法使いリナ
    rarity: SR
    hp: { value: 800, color: red, comment: 次回調整予定 }
    defense: 10
    effective_hp: { override: hp * 2 }
    skill_ids: [1, 2]
view:
  column_widths: { name: 160, hp: 80 }
  frozen_columns: 2
```

同じ内容の JSON 版は [samples/basic-json](samples/basic-json) にあります。出力ファイル（`build/character.json`）は、`export: false` の列・セル色・メモを除き、式を計算した値を書いたレコードの配列です（FR-OUT-02）。

```json
[
  {
    "id": 1,
    "version": null,
    "name": "勇者アルス",
    "rarity": "SSR",
    "hp": 1200,
    "defense": 30,
    "effective_hp": 1560,
    "skill_ids": [1, 3]
  }
]
```

## パッケージの構成

pnpm のワークスペースで、3 つのパッケージに分けています（NFR-24）。

```
app ──→ core ←── cli
 │
 └─→ worker（core を読み込む）
```

| パッケージ | 内容 |
|---|---|
| [packages/core](packages/core) | GUI と Node.js のどちらにも依存しない処理。データモデル、YAML / JSON の読み込みと正規形の書き出し、数式エンジン、検査、出力、編集操作（パッチ・履歴）、表計算の操作ロジック（選択範囲・クリップボードの変換・フィルの推定・並べ替えとフィルタ・検索と置換・ショートカットの表）、文言。ファイルの読み書きは抽象的な型 `ProjectFs` を通す |
| [packages/cli](packages/cli) | Node.js の CLI（validate / export / new / fmt / convert）。`ProjectFs` の Node.js の実装を持つ |
| [packages/app](packages/app) | ブラウザの Web アプリ（React 19）。`store/`（状態の中心）、`commands/`（操作の登録簿）、`grid/`（自前の描画のグリッド。仮想スクロールだけ `@tanstack/virtual-core`）、`dialogs/`、`panels/`、`fs/`（2 つの保存の方式）、`worker/`（検査の Web Worker）、`i18n/locales/<言語>/`（画面の文言）、`e2e/`（画面テスト） |

## 既知の制限と未検証の事項

この開発環境からは Googleスプレッドシート本体・Firefox・Safari を操作できなかったため、次の事項は手で確かめる必要があります（計画書 §8）。要件ごとの実装とテストの状態、残っている抜けと食い違いは [docs/traceability.md](docs/traceability.md)（§3「抜けと食い違いの一覧」）にまとめてあります。

- **Googleスプレッドシート本体との突き合わせ（U-1）**: 関数の細かい結果（`FLOOR` / `CEILING` の負の数、`0^0`、数値の文字列化の桁数、`IF` の偽を省略したときの値（U-1a）、未入力の列を参照したときの値（U-1b）など）とフィルの線形の延長（P-41）は、公式ヘルプと一般に知られた挙動から決めました。公式ヘルプの本文は取得できず、検索結果の要約で確かめています（U-1c）。単体テストの中の「未検証」の印が、確かめていない項目です
- **クリップボードの形式（U-2）**: 受け入れ基準 2 番は、Googleスプレッドシートが書き出すのと同じ形式の内容（`text/plain` の TSV と `text/html`）で自動テストしています。Googleスプレッドシート本体との往復は手で確かめてください。受け入れ基準 8 番の、Googleスプレッドシートで `=IF(C2="SSR", D2*2, D2)` が `2400` になることも同様です
- **Firefox・Safari の実機（U-4、NFR-03）**: 受け入れ基準 9 番は、Chromium で `showDirectoryPicker` を消してダウンロード保存方式にして試しています。Firefox・Safari 本体での読み込みと保存は手で確かめてください。Safari では `webkitdirectory` でフォルダではなくファイルが選べてしまう不具合の報告があり（WebKit Bug 284457）、要件どおり、この方式で失敗する場合は失敗してよいものとしています
- **キー操作**: Googleスプレッドシートの公式ヘルプの本文で確かめられなかったキー割り当て（値のみ貼り付け、Mac の ⌘+矢印、列の非表示など）は、`packages/core/src/sheet/shortcuts.ts` に「未検証」と書いてあります。行・列の挿入と削除（Ctrl+Alt+= / Ctrl+Alt+-）は、行を選んでいれば行、列を選んでいれば列が対象です。セル範囲を選んでいるときは、行か列かを選ぶ一覧を出します（Googleスプレッドシートは挿入・削除の種類の一覧を出すとする解説に合わせた判断。型付きテーブルにはセルだけをずらす操作が無いので、一覧は行と列の 2 つ）。実物での確認が要ります。領域の間を移る F6 / Shift+F6 は、Googleスプレッドシートの公式ヘルプでは確かめられなかったため、Excel とブラウザの「次の領域へ」の慣例に合わせました。パネルへ移る Ctrl+Alt+. / Ctrl+Alt+,（Googleスプレッドシートの「サイドパネルに移動」）と全シートの一覧の Alt+Shift+K は、検索結果の要約と解説サイトの記載に合わせたもので、公式ヘルプの本文と Mac のキーは未確認です。ブラウザや OS の設定によっては F6 がアドレスバーへの移動に使われ、ページに届かないことがあります（Chromium のヘッドレスでだけ確かめました）。列のサイズを変更で入れられる幅の上限（2000 ピクセル）は、打ち間違いで極端に広い列にならないように決めたもので、Googleスプレッドシートの上限は確かめていません
- **Ctrl+クリック**: 参照列のセルを Ctrl+クリック（Mac は ⌘+クリック）すると参照先のレコードへ移ります（FR-REF-01）。Googleスプレッドシートでは Ctrl+クリックは離れた複数の範囲の選択（FR-SEL-06、優先度「将来」で未実装）にあたるので、FR-SEL-06 を実装するときは参照先への移動の操作を変える必要があります。右クリックメニューの「参照先へ移動」でも移れます
- **未実装の要件**: 優先度「将来」の FR-SEL-06（離れた複数の範囲の選択）、FR-REF-02（どこから参照されているかの一覧）、FR-VAL-06（`warn_delta`）は実装していません
- **性能（U-5）**: NFR-10〜12 の測定は、この開発環境のヘッドレスの Chromium だけで行いました（`[perf]` の行）。Firefox・Safari と、利用者の実際の環境では測っていません
- **ダウンロード保存方式の保存**: 削除・名前の変更をしたテーブルの元のファイルはダウンロードでは消せないので、手で消すファイルの名前を表示します（P-43）。複数のファイルを保存すると ZIP になるので、展開して元のフォルダに置き直してください
- **GitHub 方式（P-67）**: 単体テストと画面テストは偽の GitHub（`packages/app/src/fs/githubFake.ts`）で行いました。この開発環境からは api.github.com に届かないため、本物の GitHub では動かしていません。OAuth・GitHub App のログインは、トークンを受け取る GitHub の端点がブラウザからの呼び出し（CORS）に対応していないとの公開情報に基づいて採らず、手元では確かめていません。フォルダの中のファイルが多すぎて GitHub が一覧を途中で切ると開けません（小さいフォルダを選んでください）。フォーク先へのプルリクエストには対応していません（対象のリポジトリに書き込める必要があります）
- **メニューからのクリップボード**: ブラウザによっては、メニューの「コピー」「貼り付け」からクリップボードを使えません。その場合は Ctrl+C / Ctrl+X / Ctrl+V（Mac は ⌘）を使ってください
- **旧版（SheetCraft）からの移行**: 旧名の設定ファイル（`sheetcraft.yaml` / `sheetcraft.json`）は読みません。`masterdata-maker.yaml` / `masterdata-maker.json` に名前を変えてください。ブラウザに残っている旧版の未保存の変更の退避・表示言語・最後に開いたフォルダは引き継ぎません（計画書 P-65）
- **TypeScript 7.0（U-3）**: 新しい版なので、型検査で問題が出たら 6.0 系に下げる方針です
- **開発・画面テスト用の口**: ビルドした画面にも `globalThis.masterdataMaker`（状態）、`masterdataMakerWorker`、`masterdataMakerBackup`、`masterdataMakerSamples`（性能の確認用のプロジェクトの生成）を残しています
- **画面テストの環境**: Playwright のフォルダの選択（`webkitdirectory` への読み込み）は、パスに ASCII 以外の文字があると動かないため、受け入れ基準 9 番は OS の一時フォルダを使います
