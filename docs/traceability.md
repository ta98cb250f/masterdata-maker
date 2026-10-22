# MasterData Maker 要件の対応表（トレーサビリティ）

| 項目 | 内容 |
|---|---|
| 作成日 | 2026-10-15（初版の監査。コミット `677654c` が対象） |
| 更新日 | 2026-10-15（J が再判定。§2.7） |
| 対象の要件定義書 | [requirements.md](./requirements.md)（版 0.5） |
| 対象の実装計画書 | [plan.md](./plan.md)（版 1.0。§5.5 の P-50〜61 を含む） |
| 対象のコード | 作業ブランチ `claude/sheetcraft-v1` のコミット `bf5140b`（H の受け入れ基準の画面テストと README の `33a73b8`、K の P-51 の `bf5140b` を含む）に、J の変更（NFR-40・B-9・NFR-10 の修正。§3.4 に一覧）を加えたもの |
| 対象に含めないもの | なし（初版で対象から外した H の未コミットの変更は `33a73b8` でコミットされ、§2.7 で判定し直した） |

---

## 0. この文書の構成（論点の地図）

要件定義書のすべての要件（R-1、R-2、D-1〜D-11、FR-*、DR-*、NFR-*、§5.17 の受け入れ基準 1〜9。合わせて 197 件）について、実装している箇所・確かめているテスト・状態を調べた。結論を先に書くと、次のとおりである（2026-10-15 の再判定の後）。

- 機能の要件（FR-*）とリソースファイルの要件（DR-*）は、優先度「将来」の 3 件を除いてすべて実装されており、ほとんどに単体テストか画面テストがある（FR-CLP-02 だけは、Googleスプレッドシート・Excel の実物との往復が未確認なので「一部」とした）。未実装の要件は見つからなかった
- 初版で最も重い抜けだった **NFR-40（キーボードだけで全操作ができる。必須）** は直した。列幅は「列のサイズを変更」のダイアログ、パネルは開くとフォーカスが移り、F6 / Shift+F6 で領域の間を巡回できる（G-1。画面テスト `packages/app/e2e/keyboard.spec.ts` でマウスを使わずにひととおりの作業をこなす）
- 受け入れ基準 1〜9 の画面テスト（NFR-31）、100 テーブルを開く時間の測定（NFR-11）、HTTPS の静的ホスティングの手順（NFR-06）は、H の `33a73b8` でそろった。スクロールが途切れないことの判定（NFR-10）も足した
- 残るのは、対象ブラウザのうち Chromium 以外で一度も動かしていないこと（NFR-01、D-11、受け入れ基準 9 番）と、Googleスプレッドシート本体との突き合わせをしていないこと（R-1、NFR-30、FR-CLP-02、受け入れ基準 2 番）である。どちらもこの開発環境からは確かめられず、手作業の確認が要る

| 節 | 内容 | 読む人が知りたいこと |
|---|---|---|
| §1 集計 | 状態ごと・優先度ごとの件数 | 全体としてどこまでできているか |
| §2 調べ方と、動かして確かめた結果 | 読んだもの・走らせたテスト・CLI と画面で試したこと、確かめ方の深さの記号 | この表をどこまで信用してよいか |
| §3 抜けと食い違いの一覧 | 重大なものから。必須の要件の抜けを最優先に。直すならどこを変えるかの見立て付き | 次に何を直すか |
| §4 要件ごとの対応表 | 要件書の節の順。ID・要件の要約・優先度・状態・実装・テスト・備考 | 個々の要件の根拠 |
| §5 付録: §4 のスコープで「再現しない」とした機能 | 再現しないとした機能が、実際に作られていないこと | 範囲の外のものが紛れ込んでいないか |

状態の語は次のとおりに使う。

| 状態 | 意味 |
|---|---|
| 実装済み | 要件の文言の内容がすべて実装されている（テストの有無と確かめ方の深さは「テスト」「備考」の列に書く） |
| 一部 | 実装されていない部分がある。備考に何が足りないかを書く |
| 未実装 | 実装が無い |
| 対象外 | 優先度「将来」、または要件書で求めないとしたもの |

初版にあった状態「H が作業中」（監査と同時に H が作業していたもの。D-4、NFR-11、NFR-31 の 3 件）は、`33a73b8` のコミットの後に判定し直して無くなった（§2.7）。

---

## 1. 集計

### 1.1 状態ごとの件数

| 状態 | 件数 | 初版（`677654c`）からの変化 |
|---|---|---|
| 実装済み | 187 | +7（FR-OUT-07 を追加。D-4・NFR-11・NFR-31 は「H が作業中」から、NFR-40・D-10・NFR-06 は「一部」から） |
| 一部 | 7 | −3 |
| 未実装 | 0 | — |
| 対象外 | 4 | — |
| 合計 | 198 | +1（FR-OUT-07） |

「実装済み」187 件の確かめ方の深さ（記号は §2.6）は次のとおり。

| 確かめ方 | 件数 | 該当 |
|---|---|---|
| 確認=動作 | 126 | 初版の 120 件に、D-4・D-10・NFR-11・NFR-31・NFR-40・FR-OUT-07 を加えた |
| 確認=テスト | 56 | — |
| 確認=コード（選定の記録・構成を読んだ） | 4 | NFR-06、NFR-20、NFR-21、NFR-22 |
| 確認=コード（浅い。要件を判定するテストが無い） | 1 | FR-ANN-04 |

ほかに、要件の一部だけが浅いもの（FR-UI-04 の fx の印など）を §3.5 にまとめた。

### 1.2 分類と状態

| 分類 | 件数 | 実装済み | 一部 | 未実装 | 対象外 |
|---|---|---|---|---|---|
| 最重要要件（R-1、R-2） | 2 | 1 | 1 | 0 | 0 |
| 決定済みの前提（D-1〜D-11） | 11 | 10 | 1 | 0 | 0 |
| 画面と操作（FR-UI〜FR-ETC、§5.1〜5.16） | 79 | 76 | 1 | 0 | 2 |
| 受け入れ基準（§5.17 の 1〜9） | 9 | 7 | 2 | 0 | 0 |
| リソースファイル（DR-*） | 34 | 34 | 0 | 0 | 0 |
| 数式（FR-FML-*） | 16 | 16 | 0 | 0 | 0 |
| 入力規則・検査（FR-VAL-*） | 11 | 10 | 0 | 0 | 1 |
| 出力・CLI（FR-OUT-*、FR-CLI-*） | 13 | 13 | 0 | 0 | 0 |
| 非機能（NFR-*） | 23 | 20 | 2 | 0 | 1 |

「画面と操作」の「一部」1 件は FR-CLP-02（Googleスプレッドシート・Excel の実物との往復が未確認）である。受け入れ基準の「一部」2 件は 2 番（Googleスプレッドシート本体）と 9 番（Firefox 本体）で、画面テストはあるが実物では確かめていない。「前提」の「一部」1 件は D-11（Firefox・Safari）、「非機能」の「一部」2 件は NFR-01（Chromium 以外のブラウザ）と NFR-30（Googleスプレッドシートの計算結果との突き合わせ）である。

### 1.3 優先度と状態（FR-*・DR-*・NFR-* の 176 件）

| 優先度 | 件数 | 実装済み | 一部 | 未実装 | 対象外 |
|---|---|---|---|---|---|
| 必須 | 137 | 134 | 3 | 0 | 0 |
| 推奨 | 35 | 35 | 0 | 0 | 0 |
| 将来・— | 4 | 0 | 0 | 0 | 4 |

必須の「一部」3 件は NFR-01、NFR-30、FR-CLP-02 である（初版の 5 件のうち、NFR-06 と NFR-40 が「実装済み」になった。初版で「H が作業中」だった必須の NFR-31 と推奨の NFR-11 も「実装済み」）。

---

## 2. 調べ方と、動かして確かめた結果

### 2.1 読んだもの

- 要件定義書と実装計画書の全文
- `packages/core`（データモデル・読み書き・数式・計算・検査・出力・編集操作・表計算の操作ロジック・文言）、`packages/cli`、`packages/app`（状態・操作の登録簿・グリッド・部品・ダイアログ・パネル・ファイルの読み書き・Web Worker）のソースコード。要件ごとに、実装している関数を開いて挙動を読んだ
- 単体テスト 56 ファイルのテスト名（934 件）と、要件に関わるテストの本文。画面テストの spec 15 ファイル（71 件）のテスト名と本文

### 2.2 走らせたもの

| 確かめたこと | 方法 | 結果 |
|---|---|---|
| 単体テスト | `pnpm exec vitest run`（詳細表示でも 1 回） | 56 ファイル・934 件がすべて通過 |
| 型検査 | `pnpm -r typecheck` | core・cli・app とも誤りなし |
| 画面テスト（リポジトリの全件） | `E2E_PORT=4178 E2E_OUTDIR=dist-e2e-i pnpm exec playwright test --output test-results-i` | 71 件がすべて通過（1.9 分）。性能の測定値は §2.4 |
| CLI の全コマンド | CLI を scratchpad にビルドし、サンプルを複製して実行 | §2.3 |
| 受け入れ基準 2・7・8・9 番と、画面テストの無い必須の操作 | scratchpad に使い捨ての画面テストを書き、同じビルドの方法（ポート 4178）で Chromium で実行。リポジトリには置いていない | §2.5 |

画面テストのビルドはその時点の作業ツリーから作るので、H の未コミットの変更が混ざりうる。監査を始めた時点では `git status` が空だった。リポジトリの画面テストのビルドに H の変更が入っていたかは確かめていない。使い捨ての画面テストのビルドには H の変更（メニューのサブメニュー、右クリックメニューのセル色など。§3.4）が入っていた。どちらも、監査で確かめた挙動（列幅の項目が無いこと、問題パネルへ移れないことなど）は H の変更の範囲の外である。

### 2.3 CLI で確かめたこと

| コマンド | 入力 | 結果 |
|---|---|---|
| `validate` | `samples/basic-yaml`、`samples/basic-json` | 「問題はありません」、終了コード 0 |
| `validate` | `character.yaml` の hp を `abc` にしたもの | 「エラー tables/character.yaml character 3 hp: int の列に string の値「abc」があります」ほか 2 件、終了コード 1 |
| `export` | 上と同じ | 「検査エラーがあるため出力しませんでした」、`build/` を作らない、終了コード 1 |
| `export --force` | 上と同じ | 出力する。int 列の `abc` は `"hp": "abc"` のまま出る（§3.3 の B-2） |
| `export --tables skill --out out2` | サンプル | `out2/skill.json` だけを書く |
| `export`（`output.format: yaml`） | サンプル | トップレベルがシーケンス、1 フィールド 1 行、`code: "NO"`・`start_at: "…"` は引用符付き |
| `new monster --display-name モンスター` | サンプル | `table` / `display_name` / `fields: []` / `records: []` のファイルを作る。もう一度作ると終了コード 2。`Monster` は名前の書式の誤りで終了コード 2 |
| `fmt --check` / `fmt` | コメント・余分な空白・不要な引用符を入れた `skill.yaml` | `--check` は「正規形ではありません」で終了コード 1。`fmt` で元のサンプルと 1 バイトも違わない形に戻る |
| `convert --to json` → `--to yaml` | `basic-yaml` | JSON にしたテーブルと共通設定は `samples/basic-json` と 1 バイトも違わない。YAML に戻すと元の `basic-yaml` と完全に一致。設定ファイル `sheetcraft.yaml`（現 `masterdata-maker.yaml`）は形式を変えない（P-01） |
| 読み込みエラー | アンカー `&a`、列の直下の `required` | 行と桁付きの読み込みエラー。`fmt` はそのファイルを書き直さず終了コード 1 |
| DR-42 | `string` 列に引用符なしの `1.10` | 警告「…数値として読まれます。元の表記の文字列として扱いました」。`fmt` で `"1.10"` になる |

### 2.4 画面テストで出た性能の測定値（Chromium、この開発環境）

| 測ったもの | 値 | 要件 |
|---|---|---|
| 1 万行 × 50 列: 矢印キーでの移動 | 中央値 16.7 ms、90 パーセンタイル 19.6 ms | NFR-10: 100 ms 以内 |
| 1 万行 × 50 列: Ctrl+End / Ctrl+Home | 中央値 43.8 ms、最大 72.1 ms | NFR-10: 100 ms 以内 |
| 1 万行 × 50 列: 入力して Enter | 中央値 11.3 ms、90 パーセンタイル 16.5 ms | NFR-10: 100 ms 以内 |
| 1 万行 × 50 列: スクロールのフレームの間隔（1 フレームに 100 px） | 中央値 16.7 ms、90 パーセンタイル 33.3 ms、最大 66.5 ms | NFR-10: 途切れない（初版では判定が無かった。§2.7 で足した） |
| 小さいサンプル: 編集から枠とタブの件数への反映 | 26〜44 ms | FR-VAL-09: 300 ms 以内 |
| 1 万行 × 50 列: 編集から反映（Web Worker） | 152〜209 ms、メインスレッドの長いタスク 0 件 | FR-VAL-09・NFR-12: 300 ms 以内 |
| 単体テスト（Node.js）: 1 万行 × 50 列の 1 セル編集後の再計算と再検査 | 215〜263 ms | NFR-12: 300 ms 以内 |

### 2.5 使い捨ての画面テストで確かめたこと

リポジトリの画面テストに無い受け入れ基準と、必須の操作のうち画面テストの無いものを、scratchpad に置いた spec で確かめた（12 件。11 件が通過。残る 1 件は `datetime` の部品の値を秒まで含めて判定した監査の側の誤りで、Chromium は秒が 0 のとき `12:00` と表示する。部品が出て値が入っていることは確かめた）。

| 確かめたこと | 結果 |
|---|---|
| 9 番: `showDirectoryPicker` を消した Chromium で、フォルダの選択（`webkitdirectory`）で `samples/basic-yaml` の複製を読み込み、hp を 1000 にして Ctrl+S → ダウンロードされた `character.yaml` を元のフォルダに置いて開き直す | 他のファイルは 1 バイトも変わらず、開き直すと 1000 |
| 2 番: Googleスプレッドシートの形のタブ区切りテキスト（セル内改行のセルを `"` で囲み、`"` を `""` にしたもの）を `string` 列 3 列に貼る。逆に 3×3 を選んで Ctrl+C | 9 個の値が一致し、コピーしたテキストも貼ったテキストと同じ |
| 7 番: 直接保存方式（OPFS）でサンプルを開いて Ctrl+S。1 セル変えて Ctrl+Z してから Ctrl+S | どちらも「保存する変更はありません」で、どのファイルも変わらない |
| 8 番: `rarity` が SSR、`hp` が 1200 の行の `effective_hp` に `=IF(rarity = "SSR", hp * 2, hp)` | 2400 |
| FR-COL-06: 列ヘッダーの境界を 60 px ドラッグ | `view.column_widths` の hp が 80 → 140。Ctrl+Z で 80 |
| FR-SEL-05: 行番号のクリック・列ヘッダーのクリック・Ctrl+A | 選択がそれぞれ行・列・全体になる |
| FR-FIL-04: 3 行を選んで Ctrl+D、2 列を選んで Ctrl+R | 先頭の値が下・右へ入る |
| FR-CLP-07・FR-EDT-02: セル色とメモのある hp をコピーして Ctrl+Shift+V。そのセルで Delete | 値だけが入る（貼り付け先は 800 だけ）。Delete の後のセルは `{ color: red, comment: 次回調整予定 }` |
| FR-EDT-03: `rarity` で `s` と打つ／`skill_ids`・`element`・`start_at` で Enter／`bool` 列で Space | 候補が SR・SSR に絞られる。参照列は主キーと名前（1 ファイア）を並べる。`list<enum>` は複数選択。`datetime` は日付と時刻の部品（値は `2026-10-13T12:00`）。`bool` はチェックボックスが Space で切り替わる |
| NFR-40: 列ヘッダーの右クリックメニュー | 列幅（「幅」「サイズ」）の項目が無い（§2.7 で直したことを確かめた） |
| NFR-40: 表示メニューから問題パネルを開き、Tab を 5 回 | フォーカスはグリッドの入力欄のまま。パネルへ移らない（§2.7 で直したことを確かめた） |

### 2.6 確かめ方の深さ（対応表の備考に書く記号）

| 記号 | 意味 |
|---|---|
| 確認=動作 | 監査で実際に動かした（単体テスト・画面テストの実行、CLI の実行、使い捨ての画面テスト）うえで、その要件を判定しているテストか操作の結果を見た |
| 確認=テスト | 判定しているテストの本文を読み、そのテストが通ることを確かめた。監査で別の入力は試していない |
| 確認=コード | ライブラリの選定や構成についての要件で、テストで判定する対象にならないもの。計画書の記録とコードを読んで確かめた |
| 確認=コード（浅い） | コードを読んだだけで、要件を判定するテストが無い |

### 2.7 再判定（2026-10-15、J）

H の `33a73b8`（受け入れ基準の画面テスト、NFR-11 の測定、README、サブメニューの不具合の修正、行と列の挿入・削除のショートカット）と K の `bf5140b`（P-51）がコミットされた後に、J が NFR-40・B-9・NFR-10 を直し、その作業ツリーで判定し直した。

| 確かめたこと | 方法 | 結果 |
|---|---|---|
| 型検査 | `pnpm -r typecheck` | core・cli・app とも誤りなし |
| 単体テスト | `pnpm exec vitest run` | 57 ファイル・956 件がすべて通過（初版の 934 件に、H・K・J が足したもの） |
| 画面テスト（リポジトリの全件） | `cd packages/app && E2E_PORT=4174 E2E_OUTDIR=dist-e2e-j pnpm exec playwright test --output test-results-j` | spec 17 ファイル・87 件がすべて通過（約 3 分。初版の 71 件に、H の `acceptance.spec.ts` などと J の `keyboard.spec.ts` の 3 件を足したもの） |
| H の作業（`33a73b8`） | `packages/app/e2e/acceptance.spec.ts`・`packages/app/e2e/perf.spec.ts`（NFR-11）・`README.md` を読み、上の画面テストの全件の中で走らせた | 受け入れ基準 1〜9 が番号順に 1 件ずつある（G-5 は解消）。100 テーブルを開く時間は、グリッドが出るまで YAML 1,601〜1,838 ms・JSON 1,576〜1,992 ms（5 秒未満で判定）、全テーブルの最初の検査の結果が出るまで YAML 3,759〜3,824 ms・JSON 3,624〜4,396 ms（全件の実行 2 回）。README のビルドの節に、HTTPS の静的ホスティングに置く手順と安全なコンテキストの注意がある（G-3） |
| キーボードだけでの操作（NFR-40） | 画面テスト `packages/app/e2e/keyboard.spec.ts`（3 件）と、scratchpad の使い捨ての画面テスト（13 件）で、下の表の箇所をキーだけで操作した | 下の表 |
| スクロールの判定（NFR-10） | `perf.spec.ts` に判定を足し、このテストだけで 11 回（うち 1 回は単体テストと同時）と、画面テストの全件の中で走らせた。わざと遅くした版（scroll のたびに 20 ms 待ち、描き直しを同期しない）でも走らせた（確かめた後に元に戻した） | このテストだけを走らせた 10 回は、どれも 1 回目の測定で中央値 16.7 ms・最大 33〜67 ms・描画の抜け 0 件で通過。画面テストの全件の中と、単体テストと同時に走らせたときは、1 回目が中央値 33.3 ms で、測り直した 2 回目が 16.7 ms で通過（測る前に 500 ms 待つようにした後の全件の実行では、1 回目で 16.7 ms）。遅くした版: 3 回とも中央値 33.3 ms、描画の抜け 91 / 120 フレームで失敗する（途切れを捉えられる） |

キーボードだけで確かめた箇所（「直した」は、確かめる前はキーだけでは届かない・操作できなかったもの）:

| 箇所 | キー操作 | 結果 |
|---|---|---|
| 全体のキーの受け渡し（`packages/app/src/App.tsx`） | ボタン・一覧・タブにフォーカスがあるときの矢印・Tab・Enter・Space・Esc | 直した。直す前は、入力欄の外のキー操作をすべてグリッドへ回していたので、ボタンの上で Tab や矢印を押すとグリッドの選択が動き、Enter はボタンを押す代わりにセルの編集を始めていた（コードを読んで確かめた）。今は、どこでも効く操作（元に戻す・やり直す・検索・ショートカット一覧・シートの切り替え・全シートの一覧・保存）だけを行い、ほかのキーはその部品に任せる。Esc でグリッドへ戻る |
| 領域の間の移動 | F6 / Shift+F6、Ctrl+Alt+. / Ctrl+Alt+, | 直した（新設）。タイトル・メニューバー・ツールバー・数式バー・グリッド・下のパネル・右のパネル・シートタブを巡回する（`keyboard.spec.ts`「F6 / Shift+F6 で…」）。編集中は確定してから移る |
| 開始画面 | Tab、Enter | 届く。Tab でメニューバー → フォルダを開く → サンプルを開く |
| メニューバー | Alt+Shift+F など、F6 で入って ← →、Enter・↓ で開く、↑↓・Enter、→ でサブメニュー、Esc | 届く（F6 で入る経路と ← → を足した） |
| ツールバー | F6 で入って ← →・Home / End、Enter（元に戻す・塗りつぶしの色） | 直した。直す前はグリッドの Tab がセルの移動なので、ツールバーへ移る手段が無かった |
| 数式バー・セル位置の表示 | F6 で入るとセル位置の表示。Enter で位置を入れて移る。Tab で数式の入力欄、Enter で確定 | 直した（同上） |
| 右クリックメニュー | Shift+F10 / ContextMenu キー（セル・行番号・列ヘッダー・シートタブ）、↑↓・Enter・→ | 直した。シートタブのメニューはキーで開けなかった |
| 列幅（FR-COL-06） | 列を選んで Shift+F10 →「列のサイズを変更」、表示メニュー | 直した（新設。ピクセル数か既定の幅。複数の列にまとめて当て、1 回で元に戻る） |
| 問題パネル（FR-UI-06） | 表示メニューで開くとフォーカスが一覧に入る。↑↓・Home / End・PageUp / PageDown、Enter で該当するセルへ。Ctrl+Alt+. で戻る。Esc | 直した |
| セル情報パネル（FR-UI-07） | 開くと本体にフォーカスが入り、↑↓ でスクロール。Shift+Tab で閉じるボタン。Esc | 直した |
| シートタブ（FR-UI-05） | F6 で入ると表示中のタブ。← →・Home / End、Enter で開く、F2 で名前の変更、Shift+F10 でタブのメニュー、＋ に Enter で新しいテーブル | 直した |
| 全シートの一覧 | ≡ に Enter、Alt+Shift+K（新設）、↑↓・Enter、Esc で開く前の場所へ戻る | 直した（Alt+Shift+K と、Esc の後のフォーカスの戻り先） |
| ダイアログ（列の設定・列の挿入・共通設定・出力・テーブルの作成と名前の変更・ショートカット一覧・メッセージ） | Tab / Shift+Tab の巡回、Enter、Esc、↑↓ と PageUp / PageDown | 直した。中身が収まらずにスクロールする部分（本文・失敗の一覧など）に Tab で止まれず、ショートカット一覧の下の分類や、80 件の貼り付けの失敗の一覧の後ろを読めなかった。今はスクロールする間だけ Tab で止まる（`packages/app/src/components/Dialog.tsx`） |
| フィルタの小さな画面 | データメニューの「フィルタ」で開き、Tab で並べ替え・タブ・すべて選択・クリア・検索・値のチェックボックス（Space）・OK を巡回、Esc | 届く |
| メモの編集 | Shift+F2、Ctrl+Enter で閉じて残す、Tab で削除・完了のボタン | 届く |
| 色の一覧 | ツールバーの塗りつぶしの色（Enter → ↑↓ → Enter）、右クリックのセル色のサブメニュー（→ ↑↓ Enter） | 届く（ツールバーへは F6 で） |
| 検索欄 | Ctrl+F、Enter / Shift+Enter、Tab で前へ・次へ・詳細・閉じる、Esc | 直した（ボタンの上の Tab がグリッドの移動に取られていた。全体のキーの受け渡しの修正による） |
| セルの入力部品（FR-EDT-03） | Enter で開く。プルダウンと複数選択は ↑↓・Enter、チェックボックスは Space | 届く。日時の選択部品とリストのタグの × はマウス用だが、同じ値を文字で入れられる |
| タイトルの「ダウンロード保存方式」の印 | F6 で入り、Enter で使えない機能の一覧 | 直した（グリッドからは移る手段が無かった） |

---

## 3. 抜けと食い違いの一覧

重大なものから並べる。各項目は「調べたこと → 分かったこと → 結論 → 直すならどこを変えるか」の順に書く。2026-10-15 の再判定（§2.7）で解消したものは、見出しに「解消」と書き、初版の記述を残したうえで「直したこと」を足した。

| # | 項目 | 状態（2026-10-15） |
|---|---|---|
| G-1 | キーボードだけではできない操作（NFR-40、D-10） | 解消（J） |
| G-2 | Chromium でしか動かしていない（NFR-01、D-11、受け入れ基準 9 番） | 残る（手作業の確認が要る） |
| G-3 | HTTPS で配る手順が無い（NFR-06） | 解消（H の README）。HTTPS 上での実地の確認は未実施 |
| G-4 | Googleスプレッドシート本体との突き合わせが無い（R-1、NFR-30、FR-CLP-02、受け入れ基準 2 番） | 残る（手作業の確認が要る） |
| G-5 | 受け入れ基準の画面テストが 5 件だけ（NFR-31） | 解消（H の `acceptance.spec.ts`） |
| T-1 | 1 万行での 300 ms の判定が 1000 ms（FR-VAL-09、NFR-12） | 一部解消（H の `perf.spec.ts` が 300 ms で判定） |
| T-2 | スクロールの途切れの判定が無い（NFR-10） | 解消（J） |
| T-3 | 画面テストが無いもの | 一部解消（FR-UI-05 の全シートの一覧ボタン、FR-COL-06 のキーでの操作） |
| B-2 | `--force` での型に合わない値（FR-OUT-05） | 決定（P-51: `null` で出す）・実装済み（K） |
| B-9 | 読み込みエラーのテーブルを指す `ref` の文言（FR-VAL-07、DR-17） | 解消（J） |
| B-1、B-3〜B-8、B-10、B-11 | 計画書に記録の無かった判断 | 計画書 §5.5（P-50、P-52〜59）に記録された |

### 3.1 必須の要件の抜け

#### G-1. キーボードだけではできない操作が 2 つある（NFR-40 必須、D-10）— 解消

- 調べたこと: NFR-40 は「キーボードだけで全操作ができる」を求める。マウスで行う操作（`packages/app/src/grid/Grid.tsx` の `onPointerDown` / `endDrag`、`packages/app/src/grid/extensions/*` の `pointerDown`）を一覧し、それぞれにキーで呼べる代わりの操作があるかを、操作の登録簿（`packages/app/src/commands/*.ts` の `id`・`menu`・`shortcut`）と右クリックメニュー（`packages/app/src/grid/extensions/contextMenus.ts`。Shift+F10 で開ける）で探した
- 分かったこと:
  - 代わりがあるもの: 行・列のドラッグでの並べ替え → 編集メニューの「行を上へ」など（`packages/app/src/commands/moveRowsCols.ts`）。範囲の枠のドラッグでの移動 → 切り取りと貼り付け。フィルハンドル → Ctrl+D / Ctrl+R と連番入力（`fill.series`）。セル色 → 右クリックメニュー。参照先へ移動 → 右クリックメニュー。メモの表示 → セル情報パネル。シートの切り替え → Ctrl+Shift+PageDown / PageUp
  - **列幅**: 列幅を変える処理（core の `setColumnWidth`）を呼ぶのは `Grid.tsx` の `endDrag`（境界のドラッグ）だけで、メニュー・右クリックメニュー・ショートカットのどこにも列幅の操作が無い（使い捨ての画面テストで、列ヘッダーの右クリックメニューに項目が無いことも確かめた）。Googleスプレッドシートには列ヘッダーの右クリックメニューに「列のサイズを変更」がある
  - **問題パネル**: 表示メニューから問題パネルを開いても、フォーカスはグリッドの入力欄に残る。グリッドでは Tab がセルの移動（`nav.tab`）に使われるので、Tab を押してもパネルへ移らない（使い捨ての画面テストで確かめた）。パネルの一覧そのものは矢印と Enter で該当セルへ移れる作り（`packages/app/src/panels/problems.tsx` の `onKeyDown`）だが、そこへ入る手段が無い。FR-UI-06 の「クリックすると該当セルへ移動する」が、キーだけではできない
- 結論（初版）: NFR-40 は「一部」。ほかの操作はキーで代わりができる
- 直すなら: (1) 「列のサイズを変更」の操作（例: `column.resize`）を `packages/app/src/commands/columnView.ts` に足し、幅を入れるダイアログ（`packages/app/src/dialogs/` に新設）から `setColumnWidth`（`packages/core/src/edit/commands/columns.ts`）を呼ぶ。列ヘッダーの右クリックメニュー（`contextMenus.ts` の `columnHeaderMenu`）と表示メニューに載せる。(2) パネルを開く操作（`packages/app/src/panels/registry.ts` の `panelCommand`）で一覧にフォーカスを移すか、グリッドとパネルの間でフォーカスを移すショートカットを `packages/core/src/sheet/shortcuts.ts` に足して、`packages/app/src/components/Hosts.tsx` の `PanelHost` で受ける
- 直したこと（2026-10-15、J）:
  - 列幅: 操作 `column.resize`「列のサイズを変更」（`packages/app/src/commands/columnView.ts`）とダイアログ（`packages/app/src/dialogs/columnResize.tsx`）を足し、列ヘッダーの右クリックメニューと表示メニューに載せた。ピクセル数（24〜2000）か既定の幅（100）を選び、選んだ列すべてに `setColumnWidth` を 1 回で当てる（Ctrl+Z の 1 回で戻る）
  - パネル: パネルを開く操作でフォーカスをパネルへ移す（問題パネルは一覧、セル情報パネルは本体）。問題パネルの一覧は ↑↓・Home / End・PageUp / PageDown と Enter で該当するセルへ移る
  - 領域の間の移動: F6 / Shift+F6 でタイトル・メニューバー・ツールバー・数式バー・グリッド・パネル・シートタブを巡回し、Ctrl+Alt+. / Ctrl+Alt+, で開いているパネルへ移る（`packages/app/src/components/focusRegions.ts`。キーは core の `SHORTCUTS` の `focusNextRegion`・`focusPrevRegion`・`focusPanel` で、Ctrl+/ の一覧にも出る）。キーの割り当ての判断: Googleスプレッドシートの公式ヘルプの本文は取得できず（計画書 U-1c）、検索結果の要約では「サイドパネルに移動」（Ctrl+Alt+. / Ctrl+Alt+,）と「スプレッドシートの外にフォーカスを移す」（Ctrl+Alt+Shift+M）は見つかったが、領域を順に巡回するキーは見つからなかった。巡回には、Excel とブラウザで「次の領域へ」に使われる F6 / Shift+F6 を当て、パネルへ移るキーは Googleスプレッドシートと同じ Ctrl+Alt+. / Ctrl+Alt+, にした。Ctrl+Alt+Shift+M は行き先が確かめられなかったので割り当てていない
  - 領域の中: メニューバー・ツールバー・シートタブは ← → と Home / End、シートタブは Enter で開く・F2 で名前の変更・Shift+F10 でタブのメニュー、全シートの一覧は Alt+Shift+K（解説サイトの記載。公式ヘルプでは未確認）でも開く。どの領域でも Esc でグリッドへ戻る
  - 全体のキーの受け渡し（`packages/app/src/App.tsx`）: 入力欄の外のキー操作をすべてグリッドへ回していたため、ボタン・一覧・タブの上の矢印・Tab・Enter がグリッドの操作になっていた。フォーカスが部品の上にあるときは、どこでも効く操作だけを行うようにした
  - ダイアログの中でスクロールする部分（本文・失敗の一覧など）に、スクロールする間だけ Tab で止まれるようにした（`packages/app/src/components/Dialog.tsx`）
  - 確かめ: `packages/app/e2e/keyboard.spec.ts` の 1 件目は、マウスを使わずにサンプルを開く → テーブルを切り替える → セルを選んで入力 → 範囲をコピーして貼り付け → 列の設定を開いて変える → 列幅を変える → 問題パネルを開いて問題の箇所へ移る → 保存、をこなす。ほかに F6 の巡回の順と、領域の中のキー操作を確かめる 2 件。単体テストは `packages/app/src/commands/gridFeatures.test.ts`「列のサイズを変更（…NFR-40）」と `packages/core/src/sheet/shortcuts.test.ts`「フォーカスの移動（NFR-40）」。確かめた箇所の一覧は §2.7
- 結論（再判定）: NFR-40・D-10 は「実装済み」。マウスでの操作には、どれもキーで代わりができる（代わりの一覧は README の「キーボードだけでの操作」）

#### G-2. 対象ブラウザのうち Chromium でしか動かしていない（NFR-01 必須、D-11、受け入れ基準 9 番）

- 調べたこと: `packages/app/playwright.config.ts` の `projects` と、計画書 §7.3、docs の中の確認の記録
- 分かったこと: 画面テストは `chromium` だけ。計画書 §7.3 は「Firefox・Safari 本体での確認は手作業とする」としているが、その記録がリポジトリに無い。9 番（Firefox）は、Chromium で `showDirectoryPicker` を消した擬似で確かめている（監査の使い捨ての画面テストでも同じ方法）。Edge は Chromium 系だが確認していない
- 結論: NFR-01・D-11・受け入れ基準 9 番は「一部」。ダウンロード保存方式の作りは API の有無で切り替える（NFR-04）ので、Firefox でも同じ経路を通るはずだが、`webkitdirectory` の挙動・ダウンロード・IndexedDB は実物で確かめていない
- 直すなら: 開発環境に Firefox と WebKit を入れられれば `playwright.config.ts` に `firefox`・`webkit` の `projects` を足し、少なくとも `fileaccess.spec.ts`「API が無ければダウンロード保存方式になり…」と受け入れ基準 9 番を走らせる。入れられなければ、手作業の確認の手順と結果を docs に残す

#### G-3. HTTPS の静的ホスティングで配る手順が無い（NFR-06 必須）— 解消

- 調べたこと: `packages/app/vite.config.ts`、リポジトリの中の配布の設定（CI の設定、README）
- 分かったこと: `vite build` は `base: './'` で静的ファイルを出し、画面テストのたびにビルドと `vite preview` での配信が成功している。サーバーの処理は無い（NFR-07）。一方、どこに・どう配るか（例: GitHub Pages の設定、手順）が HEAD に無い。README も HEAD には無い（監査の終わりに、H が作成中の `README.md` に「ビルド（静的ホスティング用）」の節が現れた。内容は確かめていない）
- 結論（初版）: 「一部」。配れる形のファイルはできるが、HTTPS で配る部分が無い
- 直すなら: README（H が作業中）に `pnpm --filter @sheetcraft/app build`（現 `@masterdata-maker/app`） で `packages/app/dist` を作って HTTPS の静的ホスティングに置く手順と、`showDirectoryPicker()` が安全な環境（HTTPS か localhost）でしか使えないことを書く。必要なら配布の CI を足す
- 再判定（2026-10-15）: H の `33a73b8` の `README.md`「ビルド（静的ホスティング用）」に、`pnpm --filter @sheetcraft/app build`（現 `@masterdata-maker/app`） で `packages/app/dist` を作り、そのまま静的ホスティングに置けばよいこと（相対パスで出力するのでサブディレクトリでもよい）、`showDirectoryPicker()` は安全なコンテキストでしか使えないので HTTPS で配ること（`localhost` は安全なコンテキスト）、ローカルでは `vite preview` で確かめることが書かれた。NFR-06 は「実装済み」（確認=コード）とした。残ること: 実際の HTTPS のホスティングに置いて動かしたことは無く（画面テストは `localhost` の `vite preview`）、配布の CI も無い（どこに配るかは利用者の運用で決まる）

#### G-4. Googleスプレッドシート本体との突き合わせをしていない（R-1 最重要、NFR-30 必須、FR-CLP-02 必須）

- 調べたこと: 計画書 §8 の U-1・U-2、テスト名に「未検証」を含むテスト、`packages/core/src/sheet/shortcuts.ts` のコメント
- 分かったこと: 関数の結果・クリップボードの形式・キーの割り当ての一部は、公式ヘルプの検索結果の要約と Excel の規則から決めており（計画書 U-1c: support.google.com への接続がプロキシで拒否された）、単体テストの期待値もそこから取っている。テスト名に「未検証」と書いたものが 17 件ある。例: IF の偽を省略したときに FALSE を返す（U-1a。公式ヘルプは「既定は空」と書く）、AND / OR が短絡しない、FLOOR / CEILING の負の数、`0^0`、COUNT の直接の引数、未入力の列を返す式、フィルの最小二乗法の延長（P-41）、貼り付けの敷き詰め、フィルタの「等しい」が大文字小文字を区別しない。ショートカットにも「未検証」と書いた割り当てが 6 か所ある（値のみ貼り付け、右クリックメニューを開くキー、Mac の ⌘+矢印、Ctrl+Shift+Home / End、F2 とセル内の改行、列の非表示）。2026-10-15 に J が足したキー（全シートの一覧の Alt+Shift+K、パネルへ移る Ctrl+Alt+. / Ctrl+Alt+, の Mac のキー、領域を巡回する F6 / Shift+F6）も、公式ヘルプの本文では確かめていない（G-1）。AND / OR が短絡しないこと（P-54）・貼り付けの敷き詰め（P-55）・フィルタの「等しい」（P-56）は、計画書 §5.5 に判断として記録された。FR-CLP-02 の往復は、Googleスプレッドシートが「セル内改行のあるセルを `"` で囲んだタブ区切りテキストを書き出す」という前提（U-2）でテストしている
- 結論: R-1・NFR-30・FR-CLP-02 は「一部」。実装とテストは前提どおりに一貫しているが、前提そのものが実物で確かめられていない
- 直すなら: Googleスプレッドシートで同じ式・操作を手で試して結果を表にし、テストの期待値と照合する（違えば `packages/core/src/formula/functions/*.ts`・`packages/core/src/sheet/fill.ts`・`packages/core/src/sheet/clipboard.ts` を直し、テスト名の「未検証」を外す）。クリップボードは、Googleスプレッドシート・Excel からコピーしたときの `text/plain` の中身を一度記録し、`packages/core/src/sheet/clipboard.test.ts` の入力にする

#### G-5. 受け入れ基準の画面テストが 9 件のうち 5 件しか無い（NFR-31 必須）— 解消

- 調べたこと: `packages/app/e2e/*.spec.ts` を受け入れ基準ごとに照らした
- 分かったこと:

  | 番号 | リポジトリの画面テスト | 足りないこと |
  |---|---|---|
  | 1 | `gridOps.spec.ts`「§5.17 の 1 番」 | なし（1 万行 × 50 列で行う） |
  | 2 | `smoke.spec.ts`「コピーするとタブ区切りのテキストをクリップボードに入れる」 | 貼る向きと、セル内改行を含むセルが無い（単体テスト `packages/core/src/sheet/clipboard.test.ts` だけ） |
  | 3 | `smoke.spec.ts`「貼り付けの失敗は…（§5.17 の 3 番）」 | なし |
  | 4 | `gridOps.spec.ts`「§5.17 の 4 番」 | なし |
  | 5 | `smoke.spec.ts`「テーブルを切り替えても未保存の変更と印が残る」 | なし |
  | 6 | `smoke.spec.ts`「元に戻すと、変更のあったテーブルを表示する」 | なし |
  | 7 | なし（単体テスト `packages/core/src/io/project.test.ts`、`packages/app/src/store/store.test.ts`、`packages/cli/src/run.test.ts` の fmt だけ） | 画面で開いて保存する流れ |
  | 8 | なし（単体テスト `packages/core/src/formula/evaluate.test.ts` だけ） | 画面で式を入れる流れ |
  | 9 | `fileaccess.spec.ts`「API が無ければ…」はモードの切り替えだけ。`smoke.spec.ts`「保存すると変更したファイルをダウンロードし…」はサンプルからの保存だけ | フォルダの読み込み → 保存 → 元のフォルダに置く → 開き直す、の一連 |

- 結論（初版）: 「H が作業中」（`packages/app/e2e/acceptance.spec.ts` を作成中。監査の時点で未コミット）。2・7・8・9 番は監査の使い捨ての画面テストで期待どおりに動くことを確かめたので（§2.5）、テストを足せば通る見込みである
- 直すなら: H の `acceptance.spec.ts` に、上の表の「足りないこと」を含める。9 番は `page.waitForEvent('filechooser')` → `setFiles(フォルダ)` でフォルダの選択を試せる
- 再判定（2026-10-15）: H の `33a73b8` の `packages/app/e2e/acceptance.spec.ts` に、受け入れ基準 1〜9 が番号と表の文言どおりに 1 件ずつ並んだ。上の表の「足りないこと」はすべて入っている（2 番は Googleスプレッドシートの形の `text/plain` と `text/html` で両方向、7 番は OPFS の直接保存方式でバイト列と書き込みの記録を比べる、8 番は画面でセル単位式を入れる、9 番は `webkitdirectory` でフォルダを読み込み、ダウンロードしたファイルを元のフォルダに置いて開き直す）。1 番は 1,000 行 × 20 列で行う（`gridOps.spec.ts` の 1 万行 × 50 列の版も残る）。画面テストの全件の中で 9 件とも通った（§2.7）。NFR-31 は「実装済み」。2 番と 9 番の受け入れ基準そのものは、Googleスプレッドシート本体と Firefox 本体での確認が残るので「一部」のまま（G-2、G-4）

### 3.2 実装はあるが、要件の判定が緩い・無いもの

#### T-1. 1 万行での 300 ミリ秒の判定が 1000 ミリ秒になっている（FR-VAL-09 必須、NFR-12 推奨）— 一部解消

- 分かったこと: FR-VAL-09（編集から 300 ms 以内に反映）の画面テスト `worker.spec.ts`「検査は Worker で動き、編集から 300 ミリ秒以内に…」は、小さいサンプルでだけ 300 ms 未満を判定している。1 万行 × 50 列では `worker.spec.ts`「1 万行 × 50 列: 1 セルの編集の後も…」も、単体テスト `packages/core/src/validate/validate.test.ts`「性能（NFR-12、D-4 の 1 万行 × 50 列）」も、判定は 1000 ms 未満である。測った値（§2.4）は 152〜263 ms で要件を満たしている
- 結論（初版）: 実装は要件を満たすが、テストが要件の値で判定していないので、遅くなっても気付けない
- 直すなら: 判定を 300 ms にする（環境の揺れには、数回測って中央値で判定するなどで対処する）。または測定値を docs に記録として残す。監査の終わりに、H の未コミットの変更で `perf.spec.ts` に「再検査の中央値が 300 ms 未満」の判定が足されつつあった（確かめていない）
- 再判定（2026-10-15）: H の `33a73b8` で、`perf.spec.ts`「1 万行 × 50 列: 矢印キーの移動・…」が、1 セルの編集の後の再検査（Worker との往復）の中央値を 300 ms 未満で判定するようになった（2026-10-15 の測定値は中央値 146〜175 ms）。NFR-12 はこれで要件の値で判定される。残ること: 測っているのは確定の後の検査の往復で、編集から検査を始めるまでの待ち（60 ms）を含まない。FR-VAL-09 の「編集してから 300 ms 以内に反映」を 1 万行で判定するテスト（`worker.spec.ts`「1 万行 × 50 列: …」は 1000 ms 未満）と、core の単体テスト（1000 ms 未満）はそのまま

#### T-2. 「スクロールが途切れない」の判定が無い（NFR-10 必須）— 解消

- 分かったこと: `perf.spec.ts` はフレームの間隔を出力する（90 パーセンタイル 33 ms、最大 66 ms）が、判定は「スクロールした後に表示領域が描かれているか」だけである
- 直すなら: フレームの間隔の 90 パーセンタイルなどに閾値を置く
- 直したこと（2026-10-15、J）: `perf.spec.ts` に判定を足した。毎フレーム 100 px スクロールしたときのフレームの間隔の中央値が 20 ms 以下（60 Hz の 16.7 ms で回っていれば通り、描画が 1 フレームに収まらず 30 fps に落ちると 33.3 ms で失敗する）、各フレームの始めに表示領域の行がすべて描かれている（描画の抜けが 0 件。100 px と 300 px）、250 ms 以上止まるフレームが無い。CPU が混んでいるときの揺れに備えて、100 px は 3 回まで測り直して一番良い回で判定する。根拠と測定値はテストの注記と §2.7（このテストだけなら 10 回とも中央値 16.7 ms・抜け 0 件。CPU が混むと 1 回目が 33.3 ms になることがあり、測り直しで通る。わざと遅くした版では中央値 33.3 ms・抜け 91 件で失敗する）。90 パーセンタイル（33 ms 前後）は、この環境では通常でも揺れるので判定に使わなかった

#### T-3. 画面テストが無く、単体テストか監査の確認だけのもの

| 要件 | 何が無いか | 監査での確認 |
|---|---|---|
| FR-EDT-03（型ごとの入力部品） | 単体テストも画面テストも無い（`packages/app/src/grid/EditorAssist.tsx`）。サンプルに `bool` 列が無い | 使い捨ての画面テストで動作を確認（§2.5） |
| FR-COL-06（境界のドラッグで列幅） | 境界のドラッグの画面テストが無い（core の `setColumnWidth` の単体テストと、当たり判定の単体テストだけ）。2026-10-15 から、同じ `setColumnWidth` をキーで呼ぶ「列のサイズを変更」は `keyboard.spec.ts` で確かめている | 使い捨ての画面テストで確認 |
| FR-SEL-05（行番号・列ヘッダーのクリック、Ctrl+A） | 画面テストが無い（`packages/core/src/sheet/selection.test.ts` だけ） | 使い捨ての画面テストで確認 |
| FR-FIL-04（Ctrl+D / Ctrl+R） | 画面テストが無い | 使い捨ての画面テストで確認 |
| FR-CLP-07（Ctrl+Shift+V） | 画面テストが無い（`store.test.ts` だけ） | 使い捨ての画面テストで確認 |
| FR-UI-05 の「全シートの一覧ボタン」 | 2026-10-15 に解消。`keyboard.spec.ts` が ≡ のボタンで一覧を開き、一覧から選んでテーブルを切り替える（Alt+Shift+K でも同じ一覧） | — |

### 3.3 要件の文言と実装の挙動の食い違い

#### (a) 計画書 §5 の判断（P-xx）・§1 の方針（C-x）で補った・変えたもの

要件書に書かれていない点を計画書で決め、そのとおりに実装されている。要件の文言から読み取る挙動と違って見えるものを挙げる。

| 判断 | 要件 | 実装の挙動 | 実装の箇所 |
|---|---|---|---|
| P-03 共通列はテーブルの `fields` に書かない | DR-10、FR-CLI-03「共通列を含む雛形」 | `new` の雛形は `fields: []`。共通列は共通設定（`config/base_fields`）から付く | `packages/core/src/model/table.ts` の `tableColumns` |
| P-10 実効値は「値 ＞ セル単位式 ＞ 列レベル式 ＞ default ＞ 未入力」 | FR-FML-01、FR-VAL-04 の `required` | `required` の列に `default` があれば、未入力でもエラーにならない | `packages/core/src/calc/calculator.ts` の `compute` |
| P-11 空のリスト `[]` は未入力 | DR-15 は `""` についてだけ書く | `[]` も読み込みで未入力にし、保存でキーを消す | `packages/core/src/model/cell.ts` の `isEmptyValue` |
| P-12 `null` は未入力にして警告 | DR-15 | YAML の `null`・`~`・空と JSON の `null` を未入力にする。`string`・`enum` 列の引用符なしの `null` は文字列 `"null"` に復元する | `packages/core/src/io/decode-value.ts` の `decodeScalar` |
| P-13 式の結果に暗黙の変換をしない | FR-FML-12 | `string` 列の式が数値を返すとエラー（`TO_TEXT` で包む） | `packages/core/src/formula/resultType.ts` の `checkResultType` |
| P-20 文字列はコードポイント順、空欄は昇順でも降順でも末尾 | FR-SRT-01「文字コード順」 | そのとおり | `packages/core/src/sheet/compare.ts` |
| P-33 循環参照は `#REF!` | FR-FML-11・13 | そのとおり | `packages/core/src/formula/errors.ts` の `circularReference` |
| P-40 読み込みエラーのテーブルは編集も保存もしない | NFR-17 | シートタブには出し、エラーだけを表示する | `packages/app/src/components/BrokenTableView.tsx` |
| P-41 フィルは等差でなければ最小二乗法の直線で延長 | FR-FIL-02 は等差の例だけ | `1, 2, 4` → 直線で延長 | `packages/core/src/sheet/fill.ts` の `extendSeries` |
| P-43 テーブルの削除・名前変更のファイル操作は保存のとき | FR-TBL-02 | ダウンロード保存方式では、手で消すファイル名を示す | `packages/core/src/edit/session.ts` の `planSave`、`packages/app/src/fs/download.ts` の `downloadPlan` |
| C-2 `regex` は RE2 構文 | FR-VAL-04 は構文を決めていない | 先読み・後方参照などは使えず、列定義の検査でエラーになる | `packages/core/src/validate/regex.ts` |

#### (b) 実装の担当が決めたもの（初版の監査の時点では計画書に記録が無かった）

初版の監査の後に、B-9 を除くものは計画書 §5.5「実装の途中で決めた事項」（P-50〜61）に記録された（対応は「計画書」の列）。B-2 は利用者が決め（P-51）、K が実装した。B-9 は判断ではなく文言の誤りなので、J が直した。P-60（最後の 1 枚のテーブルの削除）と P-61（参照先への移動を Ctrl+クリックにした）は、監査で挙げなかった判断として計画書に足されたもの。

| # | 要件 | 実装の挙動（具体例） | 箇所 | 見立て | 計画書・状態（2026-10-15） |
|---|---|---|---|---|---|
| B-1 | FR-EDT-04「先頭に `'` を付けると文字列として扱う」 | `string` 以外の列では、`'` の後ろを列の型で変換する。例: `int` 列に `'123` → 数値 123。Googleスプレッドシートでは常に文字列になる | `packages/core/src/edit/input.ts` の `parseCellInput` | 型付きテーブル（D-1）では文字列を入れられないための判断。計画書 §5 に追記すべき | P-50 に記録 |
| B-2 | FR-OUT-05「`--force` を付けたときだけ出力する」 | 初版: 型に合わない値は、ファイルの値のまま出力していた。例: `int` 列の `abc` → `"hp": "abc"`（監査で CLI を実行して確認）。式のエラーは `null` | `packages/core/src/export/export.ts` の `exportTableText` | ゲーム側で型が崩れる。要件に定めが無いので、`null` にするか、そのまま出すかを要件か計画書で決めるべき | 決定・実装済み: P-51（2026-10-15 に利用者が決定）。K の `bf5140b` で、型に合わない値は `null` で出すようにした（`export.ts` の `typedRaw`。判定は常に行う検査と同じ `packages/core/src/validate/values.ts` の `checkRawValue`、`default` は `checkDefaultValue`）。式のエラーも `null`。検査ルールの違反・警告・`ref` の参照先が無い値は、型には合っているのでそのまま出す。テストは `packages/core/src/export/export.test.ts` と `packages/cli/src/run.test.ts` |
| B-3 | FR-OUT-05「検査エラーがあるときは出力しない」 | テーブルを選んで出力するとき（`--tables`、画面の出力のダイアログ）は、選んだテーブルと共通設定だけを検査し、選ばなかったテーブルのエラーでは止めない。選んだテーブルが `ref` や `REF()` で参照するテーブルのエラーも見ない | `packages/core/src/export/export.ts` の `planExport` | 「テーブル単位で止める」と読んだ判断。参照先のエラーが選んだテーブルの式の結果に響くときは、選んだテーブルの式のエラーとして見つかるので実害は小さいが、計画書に記録すべき | P-52 に記録 |
| B-4 | FR-HIS-02「履歴は…テーブルを切り替えても保存しても消さない」 | 外部で書き換えられたファイルを読み込み直すと（FR-FIO-07）、そのテーブルを指す履歴を消す（共通列を読み込み直したときはすべて消す）。確認のダイアログに「履歴はすべて消えます」と示す | `packages/core/src/edit/session.ts` の `reloadFiles`、`packages/app/src/i18n/locales/ja/external.json` の `ui.external.historyNote` | 読み込み直した内容に古い履歴は当てられないので妥当。要件の想定外の場面として記録すべき | P-53 に記録 |
| B-5 | FR-FML-10「AND / OR などの評価の仕方も Googleスプレッドシートに合わせる」 | AND / OR は短絡しない（全引数を評価し、最初のエラーを返す）。Excel の公式ヘルプの規則 | `packages/core/src/formula/functions/logical.ts` の `logicalValues` | G-4 の突き合わせで確かめる | P-54 に記録 |
| B-6 | FR-CLP-03 | 1 セルを範囲に貼るときに加えて、貼り付け先がコピー元のちょうど整数倍なら敷き詰める（Excel の規則） | `packages/core/src/sheet/clipboard.ts` の `planPaste` | 要件の拡張。G-4 で確かめる | P-55 に記録 |
| B-7 | FR-SRT-03「等しい」 | 既定で大文字と小文字を区別しない | `packages/core/src/sheet/filter.ts` | G-4 で確かめる | P-56 に記録 |
| B-8 | FR-SRT-05「`version` 列は semver として並べる」 | 列名が `version` の列なら、共通列でなくても semver として比べる | `packages/app/src/sheet/sortFilter.ts` の `computeOrder`（`semver: field.name === 'version'`） | 実害は小さい | P-57 に記録 |
| B-9 | FR-VAL-07「存在しない…参照先」 | 読み込みエラーのテーブルを参照する `ref` は「ref「skill.id」の参照先のテーブル skill はありません」と出る（監査で CLI を実行して確認）。テーブルはあるが読み込みエラーなので、文言が実際と食い違う | `packages/core/src/validate/fields.ts` の `checkRef`（`calc.findTable` は読み込みエラーのテーブルを含まない） | 読み込みエラーのテーブル名を見て、別の文言（「参照先のテーブル skill は読み込みエラーです」）にする | 解消（J）: `checkRef` は、参照先が読み込みエラーのテーブルなら `validate.refTableBroken`「ref「skill.id」の参照先のテーブル skill は読み込みエラーのため参照できません。先にそのテーブルのファイルを直してください」を出す。同じ食い違いのあった式の `REF()` も、列定義の検査（`packages/core/src/validate/formula.ts`）と計算（`packages/core/src/calc/calculator.ts` の `lookupRef`）で `formula.ref.tableBroken`「テーブル「skill」は読み込みエラーのため参照できません」にした（どちらも `#REF!`）。読み込みエラーかどうかは `Calculator.isBrokenTable` で見る。テストは `packages/core/src/validate/validate.test.ts`「読み込みエラーのテーブルを ref・REF で指すと…」 |
| B-10 | DR-15「次の保存でキーを消す」 | `""` を読み込んだテーブルは、そのテーブルに変更があって保存したときにだけキーが消える（変更の無いテーブルは保存しない。FR-FIO-02）。`fmt` では消える | `packages/core/src/edit/session.ts`（開いた直後は読み込んだテキストを基準にする） | 受け入れ基準 7 番（何も変えなければ 1 バイトも変えない）と両立させる読み方で、妥当 | P-58 に記録 |
| B-11 | FR-ETC-02「文言をコードに直接書かない」 | 既定の共通設定の値（共通列 `version` の表示名「バージョン」、セル色 8 色のラベル「赤」など）は日本語のデータで、英語の画面でも日本語で出る | `packages/core/src/model/defaults.ts` | ファイルに書かれるデータの既定値なので、文言ではないという判断（コメントに理由あり）。画面の文言には日本語の直書きは無い（監査でコメントを除いて検索した） | P-59 に記録 |

### 3.4 初版の後に取り込んだ変更（H・K・J）

#### (a) J の変更（2026-10-15。この対応表の更新と同時。コミットは親が行う）

| 作業 | 関わる要件 | 変えたファイル |
|---|---|---|
| キーボードだけでの操作（列のサイズを変更、パネルへのフォーカス、F6 / Shift+F6 の領域の巡回、Ctrl+Alt+. / Ctrl+Alt+,、Alt+Shift+K、領域の中の ← → と Esc、部品の上のキーをグリッドへ回さない、ダイアログのスクロールする部分への Tab） | NFR-40、D-10、FR-COL-06、FR-UI-05〜07、FR-CTX-01（G-1） | `packages/core/src/sheet/shortcuts.ts`（と `shortcuts.test.ts`・`i18n/locales/*/sheet.json`）、`packages/app/src/App.tsx`、`packages/app/src/components/focusRegions.ts`（新規）・`Hosts.tsx`・`MenuBar.tsx`・`Toolbar.tsx`・`TitleBar.tsx`・`FormulaBar.tsx`・`NameBox.tsx`・`SheetTabs.tsx`・`StartScreen.tsx`・`BrokenTableView.tsx`・`Dialog.tsx`、`packages/app/src/commands/columnView.ts`・`navigate.ts`、`packages/app/src/dialogs/columnResize.tsx`（新規）・`dialogs/index.ts`、`packages/app/src/grid/extensions/contextMenus.ts`・`grid/CellInput.tsx`・`grid/Grid.tsx`、`packages/app/src/panels/registry.ts`・`panels/problems.tsx`、`packages/app/src/i18n/locales/*/columnResize.json`・`focus.json`（新規）、`packages/app/src/styles.css`、`packages/app/src/commands/gridFeatures.test.ts`、`packages/app/e2e/keyboard.spec.ts`（新規） |
| 読み込みエラーのテーブルを指す `ref`・`REF()` の文言 | FR-VAL-07、DR-17、FR-FML-04（B-9） | `packages/core/src/validate/fields.ts`・`codes.ts`・`formula.ts`・`validate.test.ts`、`packages/core/src/calc/calculator.ts`（`isBrokenTable`）、`packages/core/src/formula/errors.ts`・`index.ts`、`packages/core/src/i18n/locales/*/validate.json`・`formula.json` |
| `default` の検査を `checkDefaultValue`（K が `values.ts` に切り出したもの）に寄せる（挙動は変えない） | FR-VAL-07 | `packages/core/src/validate/fields.ts` |
| スクロールが途切れないことの判定 | NFR-10（T-2） | `packages/app/e2e/perf.spec.ts` |
| README の「キーボードだけでの操作」と、この対応表へのリンク | NFR-40 | `README.md` |

#### (b) K の変更（`bf5140b`）

| 作業 | 関わる要件 | 変えたファイル |
|---|---|---|
| `--force` で出力するとき、型に合わない値は `null` で出す（P-51） | FR-OUT-05（B-2） | `packages/core/src/export/export.ts`・`export.test.ts`、`packages/core/src/validate/values.ts`（`checkRawValue`・`checkDefaultValue`）、`packages/cli/src/run.test.ts` |

#### (c) 初版の監査の時点で H が作業中だったもの（`33a73b8` でコミットされ、§2.7 で判定し直した）


| 作業 | 関わる要件 | H が触っていたファイル |
|---|---|---|
| 受け入れ基準の画面テスト | NFR-31、§5.17（G-5） | `packages/app/e2e/acceptance.spec.ts`（新規）、`packages/app/e2e/opfs.ts` |
| 100 テーブルのプロジェクトを開く時間の測定 | NFR-11、D-4 | `packages/app/src/fs/largeSample.ts`、`packages/app/src/fs/fs.test.ts`、`packages/app/src/main.tsx` |
| メニューのサブメニューの不具合（HEAD ではどのメニューもサブメニューを使っていない。右クリックメニューのセル色をサブメニューにする変更と合わせて修正中） | FR-UI-01、FR-CTX-01、FR-ANN-01 | `packages/app/src/components/MenuBar.tsx`、`packages/app/src/components/MenuList.tsx`、`packages/app/src/grid/extensions/contextMenus.ts`、`packages/app/src/store/types.ts` |
| 行と列の挿入・削除のショートカット（Ctrl+Alt+= / Ctrl+Alt+-）。HEAD では `packages/core/src/sheet/shortcuts.ts` に `insertRowsCols`・`deleteRowsCols` の定義だけがあり、どの操作にも結び付いていない | R-1（キー操作）、FR-ROW-01・02、FR-COL-01 | `packages/app/src/commands/rowsCols.ts`（新規）、`packages/app/src/commands/index.ts`、`packages/app/src/i18n/locales/*/rowsCols.json` |
| README | NFR-06（G-3） | `README.md`（新規。監査の終わりに現れた） |

監査の終わりの時点では、上の表に加えて `packages/app/e2e/gridOps.spec.ts`・`packages/app/e2e/perf.spec.ts`（NFR-12 の 300 ms の判定と、100 テーブルを開く時間の測定）・`packages/app/src/store/AppStore.ts`・`packages/app/src/store/store.test.ts`・`packages/core/src/edit/session.ts`（手で元の値に戻したテーブルを保存の後に保存済みにする `markUnchangedSaved`）・`packages/core/src/edit/session.test.ts` も H が変更していた。どれも未コミットで、この対応表の判定には入れていない。H の作業がコミットされたら、§1 の集計のうち「H が作業中」の 3 件（D-4、NFR-11、NFR-31）と、G-3・G-5・T-1 を見直す必要がある（2026-10-15 に見直した。§2.7、§3.1、§3.2）。

### 3.5 確かめ方が浅く残ったもの

要件の全体か一部を、コードを読んだだけ、または偽物の部品を使った単体テストだけで確かめたもの。

| 要件 | 何を確かめていないか |
|---|---|
| FR-UI-04 | 列ヘッダーの式の有無の印（fx）が出ることを判定するテストが無い（`packages/app/src/grid/GridCells.tsx` の `ColumnHeader` を読んだだけ） |
| FR-ANN-04 | エラー（赤枠）・警告（黄枠）・式・編集不可・出力対象外の見た目の区別は CSS のクラス（`packages/app/src/styles.css` の `.sc-issue-error` など）を読んだだけ。画面テストはエラーのセルに `sc-issue-error` のクラスが付くことまでしか見ていない（色や線の見え方は判定していない） |
| FR-FIO-01 | 「ブラウザの許可確認」は `ensurePermission`（`packages/app/src/fs/direct.ts`）を読んだだけ。画面テストの OPFS では許可の確認が出ない |
| NFR-03 | Safari の `webkitdirectory` でファイルが選べてしまう場合の扱い（`filesToProject` でそのファイルをルートに置く）は、単体テストも実物での確認も無い。要件では失敗してよいとしている |
| NFR-15 | `createWritable()` → `close()` を待つことは単体テスト（偽物のハンドル）で確かめているが、実物のファイルで途中の失敗を起こしてはいない |
| NFR-17 | 確認せずに捨てる経路が無いことは、主な経路（開く・閉じる・サンプル・読み込み直し・列の削除・型の変更）を読んで確かめた。すべての経路を網羅的に調べてはいない |
| NFR-20〜22 | ライブラリの選定は計画書 §2.1 の記録を読んだだけ（npm の公開日を監査で調べ直してはいない）。ライセンスは `pnpm licenses list --prod` で確かめた |
| FR-CLP-02、R-1、NFR-30 | G-4 のとおり、実物との突き合わせが無い |

---

## 4. 要件ごとの対応表

列の意味: 「実装」は主なファイルと関数・部品の名前。「テスト」は単体テストのファイル（describe の名前）と画面テストの spec（テストの名前の一部）。パスはリポジトリのルートからの相対パス。

### §1 最重要要件

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| R-1 | Googleスプレッドシートのコピー。キー操作・マウス操作・数式・範囲のコピーの往復を同じにする | 最重要 | 一部 | キー: `packages/core/src/sheet/shortcuts.ts` の `SHORTCUTS`・`resolveShortcut`。マウス: `packages/app/src/grid/Grid.tsx`、`packages/app/src/grid/extensions/fillHandle.tsx`。数式: `packages/core/src/formula/`。往復: `packages/core/src/sheet/clipboard.ts` | `packages/core/src/sheet/shortcuts.test.ts`、画面テストの全 spec | 足りないこと: Googleスプレッドシート本体との突き合わせ（G-4）。初版で足りなかった行・列の挿入・削除のショートカット（Ctrl+Alt+= / Ctrl+Alt+-。`packages/app/src/commands/rowsCols.ts`、H の `33a73b8`）とキーだけでの列幅の変更（G-1、J）はそろった。例に挙げられたキー（Ctrl+C / V / Z、Ctrl+D、Ctrl+Shift+V、Ctrl+/）とマウス操作（ドラッグ、フィルハンドル、列ヘッダー、境界）はすべてある。確認=動作 |
| R-2 | リソースは YAML または JSON。1 シート＝1 ファイル、形式はプロジェクトごと、差分が小さい | 最重要 | 実装済み | `packages/core/src/io/serialize.ts` の `serializeTable`、`packages/core/src/io/emit.ts`、`packages/core/src/io/project.ts` の `planProjectWrite` | `packages/core/src/io/roundtrip.test.ts`「要件書 §1 の例の往復」（§1 の差分の例: D2 を 1000 に変えると 1 行だけ変わる） | 確認=動作 |

### §2 決定済みの前提

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| D-1 | 型付きテーブル。列ごとに入力制限 | 前提 | 実装済み | `packages/core/src/model/field.ts`、`packages/core/src/edit/input.ts` の `parseCellInput`、`packages/core/src/validate/values.ts` | `packages/core/src/edit/input.test.ts`、`packages/core/src/validate/validate.test.ts`「常に行う検査」 | 型に合わない値はファイルにあっても捨てずに保持し、検査でエラーにする（計画書 §4.1）。確認=動作 |
| D-2 | YAML と JSON の両対応。モデルは共通、読み書きの層だけ差し替え | 前提 | 実装済み | `packages/core/src/io/tree.ts`（共通の構文木）、`packages/core/src/io/yaml-parse.ts`、`packages/core/src/io/json-parse.ts`、`packages/core/src/io/emit.ts` の `emitYaml`・`emitJson` | `packages/core/src/io/project.test.ts`「YAML → モデル → JSON → モデル → YAML で元に戻る」、`packages/cli/src/run.test.ts`「convert」 | 監査で `convert` の往復を実行。確認=動作 |
| D-3 | ブラウザで動く Web アプリ | 前提 | 実装済み | `packages/app/`（React + Vite） | 画面テストの全 spec | 確認=動作 |
| D-4 | 1 テーブル最大 1 万行 × 50 列、1 プロジェクト 100 テーブル | 前提 | 実装済み | `packages/app/src/fs/largeSample.ts`（1 万行 × 50 列の生成） | `packages/app/e2e/perf.spec.ts`「1 万行 × 50 列: …」「100 テーブル（1,000 行 × 20 列 × 99 と skill）のプロジェクトを直接保存方式で開く」、`packages/app/e2e/worker.spec.ts` | 1 万行 × 50 列は確認済み（§2.4）。100 テーブルは 1,000 行 × 20 列 × 99 と skill で測る（100 テーブルすべてを最大の大きさにはしない理由は `perf.spec.ts` の注記。合計約 200 万セル）。NFR-11 を参照。確認=動作 |
| D-5 | 出力する。形式は JSON か YAML（既定は JSON） | 前提 | 実装済み | `packages/core/src/export/export.ts` の `planExport` | `packages/core/src/export/export.test.ts` | 確認=動作 |
| D-6 | `list<enum>`・`list<float>`・`datetime`・`int64` を加え、型は全 11 種 | 前提 | 実装済み | `packages/core/src/model/field.ts` の `FIELD_TYPES` | `packages/core/src/model/model.test.ts`「11 種の型とリスト型の要素」 | 確認=テスト |
| D-7 | 手動保存（Ctrl+S）。自動保存はしない | 前提 | 実装済み | `packages/app/src/store/AppStore.ts` の `save`、`packages/app/src/commands/file.ts` の `file.save` | `packages/app/src/store/store.test.ts`「AppStore: 保存」、`packages/app/e2e/smoke.spec.ts`「保存すると変更したファイルをダウンロードし…」 | リソースファイルを書くのは `save` だけ（出力ファイルは FR-OUT-06 の出力の操作で書く）。IndexedDB への退避（FR-FIO-06）はファイルを書かない。確認=動作 |
| D-8 | 列幅などの表示設定はテーブルファイルに含める | 前提 | 実装済み | `packages/core/src/model/table.ts` の `TableView`、`packages/core/src/io/serialize.ts` の `viewNode` | `packages/core/src/io/table.test.ts`「view（DR-06、P-05）」 | 確認=動作 |
| D-9 | YAML のコメントは保存時に警告なしで消してよい | 前提 | 実装済み | `packages/core/src/io/serialize.ts`（モデルから書き出すのでコメントは残らない） | `packages/core/src/io/table.test.ts`「YAML のコメントは保存で消す（DR-44）」 | 監査で `fmt` を実行して確認。確認=動作 |
| D-10 | スクリーンリーダーは対応しない。キーボードだけでの操作は必須 | 前提 | 実装済み | NFR-40 を参照 | NFR-40 を参照 | キーだけでできない操作は無くなった（G-1。NFR-40 を参照）。スクリーンリーダー向けの作り込み（読み上げの順など）はしていない（NFR-41）。確認=動作 |
| D-11 | Firefox / Safari を非対応とせず、ダウンロード保存方式で使えるようにする | 前提 | 一部 | `packages/app/src/fs/download.ts`、`packages/app/src/commands/file.ts` の `openFolder` | `packages/app/e2e/fileaccess.spec.ts`「API が無ければダウンロード保存方式になり…」 | 作りはある。Firefox・Safari の実物では動かしていない（G-2） |

### §5.1 画面構成

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-UI-01 | メニューバーとツールバー | 必須 | 実装済み | `packages/app/src/components/MenuBar.tsx`、`packages/app/src/components/Toolbar.tsx`、`packages/app/src/commands/registry.ts` の `CommandRegistry.menuGroups`・`toolbarGroups` | `packages/app/src/store/store.test.ts`「操作の登録簿・ダイアログ・パネル」、多くの画面テストが `menubar-*` を使う | メニューは ファイル・編集・表示・挿入・データ・ヘルプ。Alt+Shift+F などで開ける。F6 でメニューバー・ツールバーへ移り、← → で動ける（NFR-40）。サブメニュー（右クリックのセル色）は H の `33a73b8` で親の一覧の外に出すようにした（`gridOps.spec.ts`「右クリックメニューのセル色はサブメニュー…」）。確認=動作 |
| FR-UI-02 | 数式バー。セル単位式は `=hp*2` を、列レベル式に従うセルは列の式を「列の式」と区別して表示。グリッドは計算結果 | 必須 | 実装済み | `packages/app/src/components/FormulaBar.tsx` の `FormulaBar` | `packages/app/e2e/smoke.spec.ts`「数式バー: セル単位式は式を、列レベル式に従うセルは列の式を「列の式」として表示する」 | 確認=動作 |
| FR-UI-03 | セル位置の表示 `テーブル / 列名 / id`。入力するとそのセルへ移動 | 推奨 | 実装済み | `packages/app/src/components/NameBox.tsx` の `NameBox`・`goToLocationText`、`packages/app/src/sheet/location.ts` の `resolveLocation` | `packages/app/src/sheet/location.test.ts`、`packages/app/e2e/tools.spec.ts`「名前ボックスに「テーブル / 列名 / 主キー」を入れて Enter で…」 | 確認=動作 |
| FR-UI-04 | グリッド: 行番号の列と列ヘッダー（表示名・列名・型・式の有無の印） | 必須 | 実装済み | `packages/app/src/grid/GridCells.tsx` の `ColumnHeader`・`GridRow`、`packages/app/src/grid/Grid.tsx` | `packages/app/e2e/smoke.spec.ts`「サンプルを開くとグリッドが表示される」（表示名）、`packages/app/e2e/columnSettings.spec.ts`「型を変えると…」（型の表示）、`packages/app/src/grid/layout.test.ts` | 列名は画面テストの補助関数 `colIndex` が毎回読む。式の有無の印（fx）だけは判定が無い（§3.5）。確認=動作 |
| FR-UI-05 | 画面下部のシートタブと全シートの一覧ボタン。タブに未保存の印とエラー件数 | 必須 | 実装済み | `packages/app/src/components/SheetTabs.tsx` の `SheetTabs`、`packages/app/src/store/AppStore.ts` の `tabs` | `packages/app/e2e/smoke.spec.ts`「テーブルを切り替えても未保存の変更と印が残る」、`packages/app/e2e/worker.spec.ts`（タブのエラー件数）、`packages/app/e2e/keyboard.spec.ts`（タブと全シートの一覧をキーで操作する） | 並び順はテーブル識別子の昇順（P-06）。タブの印と件数は確認=動作。全シートの一覧ボタン（≡）は `keyboard.spec.ts` で開き、一覧から選んで切り替える（Alt+Shift+K でも同じ一覧）。確認=動作 |
| FR-UI-06 | 問題パネル: 全テーブルのエラー・警告を一覧し、クリックで該当セルへ | 必須 | 実装済み | `packages/app/src/panels/problems.tsx` の `problemsPanel`・`problemRows`・`revealDiagnostic` | `packages/app/src/commands/dialogsPanels.test.ts`「問題パネル（FR-UI-06）」、`packages/app/e2e/panels.spec.ts`「問題パネル: …押すとそのテーブルに切り替えてセルを選ぶ」、`packages/app/e2e/keyboard.spec.ts`（キーで開いて ↓ と Enter で移る） | クリックでは要件どおり。キーでも、開くとフォーカスが一覧に入り、↑↓・Home / End・PageUp / PageDown と Enter で該当セルへ移る。Ctrl+Alt+. でパネルへ戻れる（G-1 を解消）。確認=動作 |
| FR-UI-07 | セル情報パネル: セル色・メモ・検査メッセージ | 推奨 | 実装済み | `packages/app/src/panels/cellInfo.tsx` の `cellInfoPanel` | `packages/app/e2e/panels.spec.ts`「セル情報パネル: セル色・メモ・値の出どころと式・検査のメッセージ」 | 開くとフォーカスがパネルの本体に入り、↑↓ でスクロールできる（NFR-40）。確認=動作 |

### §5.2 選択と移動

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-SEL-01 | 矢印で 1 セル移動。Tab / Shift+Tab で左右、Enter / Shift+Enter で上下 | 必須 | 実装済み | `packages/core/src/sheet/selection.ts` の `moveCell`・`advanceInSelection`、`packages/app/src/commands/navigate.ts`、`packages/app/src/store/AppStore.ts` の `commitEdit`・`advanceSelection` | `packages/core/src/sheet/selection.test.ts`「1 セルの移動と範囲の拡張」「Enter / Tab による範囲の中での移動」、`packages/app/e2e/smoke.spec.ts`「…Enter で確定すると下へ移る」、`packages/app/e2e/perf.spec.ts`（矢印） | セルを選んでいるときの Enter は編集の開始（Googleスプレッドシートと同じ。FR-EDT-01）、編集中の Enter は確定して下へ。確認=動作 |
| FR-SEL-02 | Ctrl+矢印でデータの端、Ctrl+Home / End で先頭・末尾 | 必須 | 実装済み | `packages/core/src/sheet/selection.ts` の `moveToDataEdge`・`moveToSheetStart`・`moveToSheetEnd` | `packages/core/src/sheet/selection.test.ts`「Ctrl+矢印（データの端）」「Ctrl+Home / Ctrl+End / Home / End」、`packages/app/e2e/perf.spec.ts`（Ctrl+End / Ctrl+Home） | 確認=動作 |
| FR-SEL-03 | ドラッグ・Shift+クリック・Shift+矢印・Ctrl+Shift+矢印で範囲選択 | 必須 | 実装済み | `packages/core/src/sheet/selection.ts` の `extendTo`・`extendCell`・`extendToDataEdge`、`packages/app/src/grid/Grid.tsx` の `onPointerDown` | `packages/core/src/sheet/selection.test.ts`、`packages/app/e2e/smoke.spec.ts`「コピーすると…」（Shift+クリック）、`packages/app/e2e/gridOps.spec.ts`（ドラッグ、Shift+矢印） | 確認=動作 |
| FR-SEL-04 | ドラッグで表示領域の外に出たら自動でスクロール | 必須 | 実装済み | `packages/core/src/sheet/selection.ts` の `autoScrollVelocity`、`packages/app/src/grid/Grid.tsx` の `tick` | `packages/core/src/sheet/selection.test.ts`「自動スクロールの速さ（FR-SEL-04）」、`packages/app/e2e/gridOps.spec.ts`「§5.17 の 1 番」 | 確認=動作 |
| FR-SEL-05 | 行番号のクリックで行全体、列ヘッダーで列全体、Ctrl+A で全体 | 必須 | 実装済み | `packages/core/src/sheet/selection.ts` の `selectRowRange`・`selectColRange`・`selectAll`、`packages/app/src/grid/Grid.tsx` の `onPointerDown`、`packages/app/src/commands/navigate.ts` の `nav.selectAll` | `packages/core/src/sheet/selection.test.ts`「行全体・列全体・全体の選択」 | 画面テストは無い。監査の使い捨ての画面テストで確認（§2.5）。並べ替えは列ヘッダーのメニュー（`packages/app/src/grid/extensions/sortFilterHeader.tsx`）。確認=動作 |
| FR-SEL-06 | Ctrl+クリックで離れた複数の範囲 | 将来 | 対象外 | — | — | 計画書 §6 で実装しないとした。Ctrl+クリックは参照先への移動（FR-REF-01）に使っている（P-61） |

### §5.3 入力と編集

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-EDT-01 | 文字を打つと上書き入力。Enter / F2 / ダブルクリックは既存の値を残して編集。Esc で取り消す | 必須 | 実装済み | `packages/app/src/grid/CellInput.tsx` の `onGridKey`・`onEditKey`、`packages/app/src/store/AppStore.ts` の `beginEdit`・`cancelEdit` | `packages/app/src/store/store.test.ts`「編集できない列は編集を始めない（FR-EDT-06）。Enter / F2 では今の値から始める」、`packages/app/e2e/smoke.spec.ts`「int の列に 12a を入れると…」（Esc） | IME の変換を途切れさせないよう、同じ入力欄をそのまま使う。確認=動作 |
| FR-EDT-02 | Delete / Backspace で値を消す（未入力に戻す）。セル色・メモは残す | 必須 | 実装済み | `packages/core/src/edit/commands/cells.ts` の `clearCells`、`packages/app/src/commands/edit.ts` の `edit.clear` | `packages/core/src/edit/commands.test.ts`「値とセル単位式を消し、セル色とメモは残す」 | 監査の使い捨ての画面テストで確認（§2.5）。確認=動作 |
| FR-EDT-03 | 型ごとの入力部品（数値、改行を含む文字列、チェックボックスと Space、絞り込み付きのプルダウン、複数選択、日付と時刻、タグ、参照先の候補） | 必須（リスト型・参照列は推奨） | 実装済み | `packages/app/src/grid/EditorAssist.tsx` の `assistKindOf`・`refOptions`・`EditorAssist`、`packages/app/src/commands/edit.ts` の `toggleCheckboxes`、`packages/app/src/grid/CellInput.tsx`（Alt+Enter / Ctrl+Enter のセル内改行） | なし（`packages/app/src/sheet/display.test.ts` はチェックボックスの表示だけ） | テストが無い（T-3）。監査の使い捨ての画面テストで確認（§2.5）。数値の列には専用の部品は無く、文字の入力を型で解釈する。確認=動作 |
| FR-EDT-04 | `=` で始まる入力はセル単位式。先頭の `'` は文字列 | 必須 | 実装済み | `packages/core/src/edit/input.ts` の `parseCellInput`、`packages/core/src/edit/commands/cells.ts` の `applyParsedInput` | `packages/core/src/edit/input.test.ts`「共通の規則（FR-EDT-04、DR-15）」 | `string` 以外の列では `'` の後ろを型で変換する（B-1、P-50）。式は先頭の `=` を除いて `override` に保存（P-04）。確認=テスト |
| FR-EDT-05 | 型に合わない入力は確定させず、入力を残して理由を表示（`12a` →「整数を入力してください」） | 必須 | 実装済み | `packages/core/src/edit/input.ts`、`packages/core/src/edit/messages.ts` の `formatInputHint`、`packages/app/src/store/AppStore.ts` の `commitEdit`、`packages/app/src/grid/CellInput.tsx`（`sc-edit-error`） | `packages/core/src/edit/codes.test.ts`「FR-EDT-05: int 列に 12a →「整数を入力してください」」、`packages/app/e2e/smoke.spec.ts`「int の列に 12a を入れると確定されず、入力を残したまま理由が出る」 | 確認=動作 |
| FR-EDT-06 | 編集できない列（`editable: false`、自動採番）は入力を受け付けず、見た目でも区別 | 必須 | 実装済み | `packages/core/src/model/field.ts` の `isFieldEditable`、`packages/core/src/edit/helpers.ts` の `readonlyFailure`、`packages/app/src/grid/GridCells.tsx`（`sc-readonly`・鍵の印） | `packages/core/src/edit/commands.test.ts`「編集できない列は入力を受け付けない」、`packages/app/e2e/smoke.spec.ts`「編集できない列（id）は入力を受け付けない」 | 確認=動作 |
| FR-EDT-07 | 数式バーとセル内の編集で列名と関数名を補完 | 推奨 | 実装済み | `packages/app/src/sheet/complete.ts` の `completionItems`・`applyCompletion`、`packages/app/src/components/FormulaAssist.tsx` | `packages/app/src/sheet/complete.test.ts`、`packages/app/e2e/tools.spec.ts`「セル内の編集と数式バーで、= から始まる式の列名と関数名を補完する」、`packages/app/e2e/columnSettings.spec.ts`（列レベル式の欄） | 確認=動作 |

### §5.4 コピー・切り取り・貼り付け

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-CLP-01 | Ctrl+C / X / V でコピー・切り取り・貼り付け | 必須 | 実装済み | `packages/app/src/grid/CellInput.tsx` の `onCopy`・`onPaste`、`packages/app/src/grid/clipboard.ts` の `copySelection`・`pasteText`、`packages/core/src/edit/commands/clipboard.ts` の `copyCells`・`pasteCells` | `packages/core/src/edit/commands.test.ts`「貼り付け（FR-CLP-03〜07）」、`packages/app/e2e/smoke.spec.ts`（コピー・貼り付け） | キー操作はブラウザの copy / cut / paste のイベントで行う。メニューからの貼り付けは本ツールの中でコピーした内容だけ（他のアプリのクリップボードを読むには許可が要るため）。確認=動作 |
| FR-CLP-02 | Googleスプレッドシート・Excel と範囲をそのまま往復（タブ区切り。改行・タブを含むセルも崩れない） | 必須 | 一部 | `packages/core/src/sheet/clipboard.ts` の `toTsv`・`parseTsv`・`toHtmlTable` | `packages/core/src/sheet/clipboard.test.ts`「受け入れ基準 2: セル内改行を含む 3×3 の往復」、`packages/app/e2e/smoke.spec.ts`「コピーするとタブ区切りのテキストをクリップボードに入れる」 | 想定した形式（計画書 U-2）では往復できる（監査の使い捨ての画面テストでも確認）。Googleスプレッドシート・Excel の実物との往復は未確認（G-4） |
| FR-CLP-03 | 1 セルを範囲に貼ると範囲全体を同じ値で埋める | 必須 | 実装済み | `packages/core/src/sheet/clipboard.ts` の `planPaste` | `packages/core/src/sheet/clipboard.test.ts`「1 セルを範囲に貼ると範囲全体を埋める」、`packages/core/src/edit/commands.test.ts` | ちょうど整数倍なら敷き詰めもする（B-6、P-55）。確認=テスト |
| FR-CLP-04 | 貼り付け先の列の型に変換。1 セルでも失敗したら全体を取りやめ、失敗の一覧 | 必須 | 実装済み | `packages/core/src/edit/commands/clipboard.ts` の `pasteInto`・`convertClipCell`、`packages/app/src/store/AppStore.ts` の `formatFailures` | `packages/core/src/edit/commands.test.ts`「§5.17 の 3 番」、`packages/app/e2e/smoke.spec.ts`「貼り付けの失敗は…」 | 確認=動作 |
| FR-CLP-05 | 末尾を超えたら行を追加（主キーは採番） | 推奨 | 実装済み | `packages/core/src/edit/commands/clipboard.ts`（`insertRecords`）、`packages/app/src/grid/clipboard.ts` の `pasteClipboard`（表の外の行を `null` にする） | `packages/core/src/edit/commands.test.ts`「レコードの末尾を超えたら行を追加し、主キーを採番する」 | 確認=テスト |
| FR-CLP-06 | 切り取りと貼り付けで値・色・メモ・式を移す。範囲の枠のドラッグでも移す | 推奨 | 実装済み | `packages/core/src/edit/commands/clipboard.ts`（切り取りの元を空にする）、`packages/app/src/grid/extensions/fillHandle.tsx` の `moveRange` | `packages/core/src/edit/commands.test.ts`「切り取りと貼り付けで元のセルを空にする」、`packages/app/src/commands/gridFeatures.test.ts`「範囲の枠のドラッグによる移動」、`packages/app/e2e/gridOps.spec.ts`「範囲の枠をドラッグすると、値・セル色・メモを移す」 | 確認=動作 |
| FR-CLP-07 | Ctrl+Shift+V で値のみ貼り付け | 推奨 | 実装済み | `packages/app/src/commands/edit.ts` の `edit.pasteValues`（`pasteValuesPending`）、`pasteCells` の `valuesOnly` | `packages/core/src/edit/commands.test.ts`「値のみ貼り付けは計算済みの値を使い…」、`packages/app/src/store/store.test.ts` | 画面テストは無い。監査の使い捨ての画面テストで確認。確認=動作 |

### §5.5 フィル

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-FIL-01 | フィルハンドルのドラッグで隣のセルへ広げる | 必須 | 実装済み | `packages/app/src/grid/extensions/fillHandle.tsx` の `fillHandleExtension`・`applyFill`、`packages/app/src/grid/dragMath.ts`、`packages/core/src/edit/commands/fill.ts` の `fillCells` | `packages/app/src/grid/dragMath.test.ts`「フィルハンドルの向きと範囲」、`packages/app/e2e/gridOps.spec.ts`「§5.17 の 4 番」「フィルハンドルをダブルクリックすると…」 | 確認=動作 |
| FR-FIL-02 | 数値は等差、日時は間隔を見つけて続ける。1 セルなら複製 | 必須 | 実装済み | `packages/core/src/sheet/fill.ts` の `extendSeries`・`extendSeriesBackward` | `packages/core/src/sheet/fill.test.ts`「数値」「日時」「受け入れ基準 4」 | 等差でなければ最小二乗法（P-41。未検証）。確認=動作 |
| FR-FIL-03 | 末尾が数字の文字列は数字を進める | 推奨 | 実装済み | `packages/core/src/sheet/fill.ts` | `packages/core/src/sheet/fill.test.ts`「末尾が数字の文字列（FR-FIL-03）」 | ゼロ埋めの桁数を保つ。確認=テスト |
| FR-FIL-04 | Ctrl+D で下、Ctrl+R で右へ先頭の値をコピー | 必須 | 実装済み | `packages/core/src/edit/commands/clipboard.ts` の `fillDown`・`fillRight`、`packages/app/src/commands/edit.ts` の `edit.fillDown`・`edit.fillRight` | `packages/core/src/edit/commands.test.ts`「Ctrl+D / Ctrl+R: 先頭の行・列をコピーする」 | 1 行だけなら上の行をコピー（Googleスプレッドシートと同じ）。画面テストは無い。監査の使い捨ての画面テストで確認。確認=動作 |
| FR-FIL-05 | 連番入力（開始値と増分） | 推奨 | 実装済み | `packages/core/src/edit/commands/fill.ts` の `fillSeriesCells`、`packages/app/src/dialogs/series.tsx` の `seriesDialog` | `packages/core/src/sheet/fill.test.ts`「連番入力（FR-FIL-05）」、`packages/app/e2e/tools.spec.ts`「連番入力: 開始値と増分を入れて選択範囲を埋める」 | 確認=動作 |

### §5.6 行

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-ROW-01 | 行の挿入（上・下、複数行まとめて）。主キーを採番 | 必須 | 実装済み | `packages/core/src/edit/commands/rows.ts` の `insertRows`、`packages/app/src/commands/rows.ts` の `row.insertAbove`・`row.insertBelow`（選んだ行の数だけ） | `packages/core/src/edit/commands.test.ts`「上・下への挿入（複数行）。主キーは既存の最大値＋1 から」、`packages/app/e2e/gridOps.spec.ts`「§5.17 の 4 番」（準備として行番号の右クリックで下に 1 行ずつ挿入する）、`packages/app/e2e/gridOps.spec.ts`「Ctrl+Alt+= / Ctrl+Alt+-: …」、`packages/app/src/commands/rowsCols.test.ts` | 複数行まとめての挿入は単体テストと、Ctrl+Alt+= の画面テスト（行を選べば選んだ行数だけ上に挿入）。ショートカットは H の `33a73b8` で `packages/app/src/commands/rowsCols.ts` に割り当てた。確認=動作 |
| FR-ROW-02 | 行の削除（複数行まとめて） | 必須 | 実装済み | `packages/core/src/edit/commands/rows.ts` の `deleteRows`、`packages/app/src/commands/rows.ts` の `row.delete` | `packages/core/src/edit/commands.test.ts`「削除（複数行）」、`packages/app/e2e/gridOps.spec.ts`「フィルタ: …表示中の行だけを消す」、`packages/app/e2e/gridOps.spec.ts`「Ctrl+Alt+= / Ctrl+Alt+-: …」 | ショートカット（Ctrl+Alt+-）は H の `33a73b8` で割り当てた。確認=動作 |
| FR-ROW-03 | 行の複製（主キーは採番し直す） | 推奨 | 実装済み | `packages/core/src/edit/commands/rows.ts` の `duplicateRows`、`packages/app/src/commands/rowDuplicate.ts` | `packages/core/src/edit/commands.test.ts`「複製は主キーを採番し直す」、`packages/app/src/commands/gridFeatures.test.ts`「行を複製すると主キーを採番し直し…」 | 確認=テスト |
| FR-ROW-04 | 行のドラッグで並べ替え（ファイル上の順も変わる） | 必須 | 実装済み | `packages/app/src/grid/extensions/reorder.tsx` の `moveDisplayedRows`、`packages/core/src/edit/commands/rows.ts` の `moveRows` | `packages/app/src/commands/gridFeatures.test.ts`「行・列のドラッグによる並べ替え」、`packages/app/e2e/gridOps.spec.ts`「行番号・列ヘッダーをドラッグして並べ替える」 | キーでは編集メニューの「行を上へ／下へ」（`packages/app/src/commands/moveRowsCols.ts`）。確認=動作 |

### §5.7 列

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-COL-01 | 列の挿入・削除（削除時はデータも消えることを確認） | 必須 | 実装済み | `packages/core/src/edit/commands/columns.ts` の `insertColumn`・`deleteColumns`、`packages/app/src/commands/columns.ts`、`packages/app/src/dialogs/columnInsert.tsx` | `packages/core/src/edit/commands.test.ts`「列（FR-COL-01〜08）」、`packages/app/e2e/columnSettings.spec.ts`「列の挿入（右・左）と削除（データも消えることを確認する）」「複数の列を選んで削除する」 | 共通列は消せない（共通設定で編集する）。Ctrl+Alt+= / Ctrl+Alt+- は列を選んでいれば列（左に挿入）を挿入・削除する（`rowsCols.ts`、`gridOps.spec.ts`）。確認=動作 |
| FR-COL-02 | 列設定の編集（表示名・出力対象・編集可否・列レベル式・既定値・検査ルール・警告条件・列挙型・参照先） | 必須 | 実装済み | `packages/app/src/dialogs/columnSettings.tsx` の `columnSettingsDialog`、`packages/app/src/dialogs/ColumnForm.tsx`、`packages/app/src/dialogs/columnDraft.ts`、`packages/core/src/edit/commands/columns.ts` の `updateColumn` | `packages/app/src/dialogs/columnDraft.test.ts`「列の設定の下書き（FR-COL-02）」、`packages/app/e2e/columnSettings.spec.ts` | 説明（`description`）も編集できる。確定の前に列定義の検査（FR-VAL-07）を通す。確認=動作 |
| FR-COL-03 | 列名の変更で、同じテーブルの式・他テーブルの `ref`・`REF()` の中もまとめて書き換え | 推奨 | 実装済み | `packages/core/src/edit/commands/columns.ts` の `renameColumn`、`packages/core/src/formula/rename.ts` の `renameColumnInFormula`・`renameRefColumnInFormula` | `packages/core/src/edit/commands.test.ts`「列名の変更（FR-COL-03）」、`packages/core/src/formula/dependencies.test.ts`「renameColumnInFormula」、`packages/app/e2e/columnSettings.spec.ts`「列名を変えると…Ctrl+Z で 1 回で戻る」 | 表示設定の中の列名も書き換える。確認=動作 |
| FR-COL-04 | 型の変更。変換できない値を先に一覧で示し、承認されたら変換 | 推奨 | 実装済み | `packages/core/src/edit/commands/columns.ts` の `checkColumnTypeChange`・`changeColumnType` | `packages/core/src/edit/commands.test.ts`「型の変更（FR-COL-04）」、`packages/app/e2e/columnSettings.spec.ts`「型を変えると、変換できない値を先に一覧で示し…」 | 変換できない値は捨てずに残し、検査で型のエラーにする（NFR-17）。確認=動作 |
| FR-COL-05 | 列のドラッグで並べ替え（列定義の順も変わる） | 必須 | 実装済み | `packages/app/src/grid/extensions/reorder.tsx` の `moveDisplayedColumns`、`packages/core/src/edit/commands/columns.ts` の `moveColumns` | `packages/app/src/commands/gridFeatures.test.ts`「列を移すと列定義の順序が変わる。共通列は動かせない」、`packages/app/e2e/gridOps.spec.ts`「行番号・列ヘッダーをドラッグして並べ替える」 | 確認=動作 |
| FR-COL-06 | 境界のドラッグで列幅を変更し、表示設定として保存 | 必須 | 実装済み | `packages/app/src/grid/Grid.tsx` の `endDrag`、`packages/core/src/edit/commands/columns.ts` の `setColumnWidth`。キーで行う「列のサイズを変更」: `packages/app/src/commands/columnView.ts` の `column.resize`、`packages/app/src/dialogs/columnResize.tsx` | `packages/core/src/edit/commands.test.ts`「列幅・固定する列の数・非表示（表示設定）」、`packages/app/src/grid/layout.test.ts`「列の境界の当たり判定」、`packages/app/src/commands/gridFeatures.test.ts`「列のサイズを変更（…NFR-40）」、`packages/app/e2e/keyboard.spec.ts`（列のサイズを変更で 2 列を 150 にし、Ctrl+Z の 1 回で戻る。保存したファイルの `view.column_widths`） | 境界のドラッグの画面テストは無い（監査の使い捨ての画面テストで確認）。キーだけでも、列ヘッダーの右クリックメニューと表示メニューの「列のサイズを変更」で、ピクセル数（24〜2000）か既定の幅を選んだ列にまとめて当てられる（G-1 を解消）。確認=動作 |
| FR-COL-07 | 左端からの列の固定（表示設定として保存） | 必須 | 実装済み | `packages/core/src/edit/commands/columns.ts` の `setFrozenColumns`、`packages/app/src/commands/columnView.ts` の `column.freeze`・`column.unfreeze`、`packages/app/src/grid/layout.ts` の `GridGeometry` | `packages/app/src/commands/gridFeatures.test.ts`「列の固定・非表示」、`packages/app/e2e/gridOps.spec.ts`「列の固定・固定の解除（FR-COL-07）」 | 確認=動作 |
| FR-COL-08 | 列の非表示（表示設定として保存） | 推奨 | 実装済み | `packages/core/src/edit/commands/columns.ts` の `setColumnsHidden`、`packages/app/src/commands/columnView.ts` の `column.hide`・`column.showHidden`、`packages/app/src/sheet/model.ts` の `buildSheetModel` | `packages/app/src/store/store.test.ts`「非表示の列は除き、隠れた位置を覚える」、`packages/app/e2e/gridOps.spec.ts`「右クリックメニュー…」（非表示と再表示） | 確認=動作 |

### §5.8 並べ替えとフィルタ

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-SRT-01 | 表示だけの並べ替え（ファイルを変えず保存しない）。昇順・降順・解除。数値・日時は大小、文字列は文字コード順 | 必須 | 実装済み | `packages/app/src/commands/sortFilter.ts` の `sort.asc`・`sort.desc`・`sort.clear`、`packages/app/src/sheet/sortFilter.ts` の `computeOrder`・`sortKeyOf`、`packages/core/src/sheet/compare.ts` の `sortRows` | `packages/core/src/sheet/compare.test.ts`、`packages/app/src/commands/gridFeatures.test.ts`「並べ替え（FR-SRT-01、02、05）」、`packages/app/e2e/gridOps.spec.ts`「並べ替え: 表示だけの昇順・降順・解除と…」 | 1 列だけで並べ替え、前の並べ替えは置き換える。確認=動作 |
| FR-SRT-02 | 並べ替えの適用（ファイル上の順を書き換える。元に戻せる） | 推奨 | 実装済み | `packages/core/src/edit/commands/rows.ts` の `applySortOrder`、`packages/app/src/commands/sortFilter.ts` の `sort.apply` | `packages/core/src/edit/commands.test.ts`「並べ替えの適用」、`packages/app/e2e/gridOps.spec.ts`（並べ替えの適用） | 確認=動作 |
| FR-SRT-03 | 列ごとのフィルタ（値の一覧／等しい・含む・範囲・空欄）。状態は保存しない | 必須 | 実装済み | `packages/core/src/sheet/filter.ts` の `compileCondition`・`matchesCondition`・`visibleRows`、`packages/app/src/dialogs/filter.tsx` | `packages/core/src/sheet/filter.test.ts`、`packages/app/e2e/gridOps.spec.ts`「フィルタ: 値の一覧と条件で絞り込み…」 | 「等しい」は大文字小文字を区別しない（B-7、P-56）。確認=動作 |
| FR-SRT-04 | フィルタ中のコピー・貼り付け・フィル・削除は表示中の行だけ | 必須 | 実装済み | `packages/app/src/sheet/model.ts`（`rowUids` は表示中の行だけ）、`packages/app/src/commands/helpers.ts` の `selectionTarget` | `packages/app/src/commands/gridFeatures.test.ts`「フィルタ中のコピー・貼り付け・フィル・値の消去・行の削除は、表示中の行だけを対象にする」、`packages/app/e2e/gridOps.spec.ts` | 確認=動作 |
| FR-SRT-05 | `version` 列は semver の数値として比べる（`0.1.2` < `0.1.11`） | 必須 | 実装済み | `packages/core/src/sheet/compare.ts` の `compareSemver`、`packages/app/src/sheet/sortFilter.ts` の `computeOrder` | `packages/core/src/sheet/compare.test.ts`「セマンティック バージョニング（FR-SRT-05）」、`packages/app/src/commands/gridFeatures.test.ts`「version 列はセマンティック バージョニングで並べる」 | 判定は列名（B-8、P-57）。確認=テスト |
| FR-SRT-06 | エラー・警告のある行だけに絞る | 推奨 | 実装済み | `packages/app/src/commands/sortFilter.ts` の `filter.issuesOnly`、`packages/core/src/sheet/filter.ts` の `visibleRows`（`onlyRowsWithIssues`） | `packages/core/src/sheet/filter.test.ts`「エラー・警告のある行だけに絞る（FR-SRT-06）」、`packages/app/src/commands/gridFeatures.test.ts` | 確認=テスト |

### §5.9 検索と置換

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-FND-01 | Ctrl+F で検索、Ctrl+H で検索と置換 | 必須 | 実装済み | `packages/app/src/components/FindBar.tsx`、`packages/app/src/dialogs/findReplace.tsx` の `findReplaceDialog`、`packages/app/src/commands/find.ts` | `packages/app/e2e/findReplace.spec.ts`「Ctrl+F で右上の検索欄を出し…」「Ctrl+H の置換は…」 | Mac の置換は ⌘+Shift+H。確認=動作 |
| FR-FND-02 | 大文字小文字の区別・セル全体の一致・正規表現・式の中も検索 | 推奨 | 実装済み | `packages/core/src/sheet/find.ts` の `createMatcher`、`packages/app/src/sheet/findHits.ts` の `findInSheet`・`cellFindText` | `packages/core/src/sheet/find.test.ts`、`packages/app/src/sheet/findHits.test.ts`、`packages/app/e2e/findReplace.spec.ts`「…正規表現・セル全体の一致・数式内も検索・全テーブル」 | 正規表現は RE2 構文。確認=動作 |
| FR-FND-03 | 検索範囲: 選択範囲／テーブル／全テーブル | 推奨 | 実装済み | `packages/app/src/dialogs/findReplace.tsx` の `computeHits`、`packages/app/src/sheet/findHits.ts` | `packages/app/src/sheet/findHits.test.ts`「範囲を指定できる（選択範囲）」、`packages/app/e2e/findReplace.spec.ts`（全テーブル） | 確認=動作 |
| FR-FND-04 | 置換は型の変換規則と編集可否に従い、置換できなかったセルを一覧 | 必須 | 実装済み | `packages/core/src/edit/commands/cells.ts` の `replaceCells`、`packages/app/src/dialogs/findReplace.tsx` の `replaceFailureText` | `packages/core/src/edit/commands.test.ts`「置換（FR-FND-04）」、`packages/app/e2e/findReplace.spec.ts`「Ctrl+H の置換は型の変換規則と編集可否に従い…」 | 確認=動作 |

### §5.10 セル色・メモ・表示

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-ANN-01 | セル色をプリセットから設定・解除。範囲にまとめて | 必須 | 実装済み | `packages/core/src/edit/commands/cells.ts` の `setCellColor`、`packages/app/src/commands/annotations.ts` の `cell.color`、`packages/app/src/dialogs/cellColor.tsx` | `packages/core/src/edit/commands.test.ts`「セル色を範囲にまとめて設定・解除する」、`packages/app/e2e/gridOps.spec.ts`「セル色: ツールバーの一覧から範囲にまとめて当て…」 | 右クリックメニューのセル色は、H の `33a73b8` でサブメニューにした（`gridOps.spec.ts`「右クリックメニューのセル色はサブメニュー…」。→ と ↑↓ で選べる）。確認=動作 |
| FR-ANN-02 | メモの追加・編集・削除。右上の三角、マウスを重ねると表示 | 必須 | 実装済み | `packages/core/src/edit/commands/cells.ts` の `setCellComment`、`packages/app/src/commands/annotations.ts` の `cell.comment`（Shift+F2）、`packages/app/src/dialogs/note.tsx`、`packages/app/src/grid/extensions/notes.tsx` | `packages/core/src/edit/commands.test.ts`「メモの追加・編集・削除」、`packages/app/e2e/gridOps.spec.ts`「メモ: Shift+F2 で書き、マウスを重ねると内容を出す」 | 確認=動作 |
| FR-ANN-03 | 範囲を選択していてもセル色が見分けられる | 必須 | 実装済み | `packages/app/src/grid/Grid.tsx` の `SelectionLayer`（半透明の塗り）、`packages/app/src/styles.css` の `.sc-sel-range` | `packages/app/e2e/gridOps.spec.ts`「セル色: …選択中でも見分けられる」 | 確認=動作 |
| FR-ANN-04 | 状態の見た目の区別: エラー（赤枠）・警告（黄枠）・セル単位式・列レベル式・編集不可・出力対象外 | 必須 | 実装済み | `packages/app/src/grid/GridCells.tsx` の `renderCell`（`sc-issue-error`・`sc-issue-warning`・`sc-src-override`・`sc-src-formula`・`sc-readonly`・`sc-noexport`）、`packages/app/src/styles.css` | `packages/app/e2e/worker.spec.ts`（エラーのセルに `sc-issue-error` が付くこと） | 赤枠・黄枠は内側の 1 px の線。式は文字の色と左上の印。エラーの枠のクラス以外（警告・式・編集不可・出力対象外）は判定が無い。確認=コード（浅い） |
| FR-ANN-05 | 参照列のセルに参照先の名前を添える | 推奨 | 実装済み | `packages/app/src/grid/extensions/references.tsx` の `referencesExtension`、`packages/app/src/sheet/references.ts` の `refNamesText` | `packages/app/src/commands/gridFeatures.test.ts`「参照列のセルに参照先の名前を添える」、`packages/app/e2e/gridOps.spec.ts`「参照: 参照先の名前を添え…」 | 確認=動作 |

### §5.11 元に戻す・やり直し

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-HIS-01 | Ctrl+Z / Ctrl+Y（Ctrl+Shift+Z）。セル・行・列・列設定・表示設定・共通設定のすべて | 必須 | 実装済み | `packages/core/src/edit/session.ts` の `EditSession.apply`・`undo`・`redo`、`packages/core/src/edit/patch.ts` の `applyPatch`（逆のパッチ） | `packages/core/src/edit/patch.test.ts`「各パッチの適用と逆のパッチ」、`packages/core/src/edit/session.test.ts`「履歴（FR-HIS-01〜04）」、`packages/app/e2e/tools.spec.ts`（共通設定を 1 回で元に戻す） | F4 もやり直しに割り当てている。確認=動作 |
| FR-HIS-02 | 履歴はプロジェクト全体で 1 本。切り替えても保存しても消さない。戻したテーブルを表示 | 必須 | 実装済み | `packages/core/src/edit/session.ts`、`packages/app/src/store/AppStore.ts` の `onEditEvent`・`focusTransaction` | `packages/core/src/edit/session.test.ts`「保存すると保存したテキストが新しい基準になる。履歴は消えず…」、`packages/app/e2e/smoke.spec.ts`「元に戻すと、変更のあったテーブルを表示する」 | 外部での変更を読み込み直したときは履歴を消す（B-4、P-53）。確認=動作 |
| FR-HIS-03 | 1 回の操作を 1 回で戻す（100 セルの貼り付けも） | 必須 | 実装済み | `packages/core/src/edit/transaction.ts` の `TxBuilder`、`packages/core/src/edit/session.ts` の `applyGroup` | `packages/core/src/edit/commands.test.ts`「…100 セルの貼り付けも 1 回で戻る（FR-HIS-03）」 | 確認=テスト |
| FR-HIS-04 | 履歴は 100 件以上 | 推奨 | 実装済み | `packages/core/src/sheet/history.ts` の `DEFAULT_HISTORY_LIMIT`（200。P-44） | `packages/core/src/sheet/history.test.ts`「件数の上限（既定 200。P-44）」 | 確認=テスト |

### §5.12 テーブル（シート）の管理

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-TBL-01 | テーブルの新規作成（共通列を含む雛形） | 必須 | 実装済み | `packages/core/src/edit/commands/tables.ts` の `createTable`、`packages/app/src/commands/tables.ts` の `table.create`、`packages/app/src/dialogs/tableDialogs.tsx` | `packages/core/src/edit/commands.test.ts`「新規作成（共通列だけの雛形）」、`packages/app/e2e/tables.spec.ts`「シートタブの + で新しいテーブルを作る」 | 確認=動作 |
| FR-TBL-02 | 複製・名前変更（参照も書き換え）・削除（参照されていれば警告） | 推奨 | 実装済み | `packages/core/src/edit/commands/tables.ts` の `duplicateTable`・`renameTable`・`deleteTable`・`findTableReferences`、`packages/app/src/dialogs/tableDialogs.tsx` の `tableDeleteDialog` | `packages/core/src/edit/commands.test.ts`「テーブル（FR-TBL-01〜03）」、`packages/app/e2e/tables.spec.ts`「名前を変更すると…」「削除は、参照されていれば参照元を示して警告する」「複製すると…」 | ファイルの削除・名前変更は保存のとき（P-43）。確認=動作。最後の 1 枚のテーブルも削除できる（P-60） |
| FR-TBL-03 | 共通設定（列挙型・共通列・セル色）を画面から編集 | 推奨 | 実装済み | `packages/app/src/dialogs/commonSettings.tsx` の `commonSettingsDialog`、`packages/app/src/dialogs/commonDraft.ts`、`packages/core/src/edit/commands/tables.ts` の `setEnums`・`setColors`・`setBaseFields`・`renameEnum`・`renameEnumValues`・`renameBaseField` | `packages/core/src/edit/commands.test.ts`「列挙型の値の名前の変更: …」、`packages/app/src/dialogs/commonDraft.test.ts`、`packages/app/e2e/tools.spec.ts`「共通設定: …」 | 列挙型の値は 1 行に 1 つの入力欄で編集し、行はもとの値を覚える。値の文字を変えると、その列挙型を使う列（`enum`・`list<enum>`）のセルの値と列定義の `default` も書き換える。式の中の文字列は値を指すとは限らないので書き換えない。確認=動作 |

### §5.13 ファイルを開く・保存する

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-FIO-01 | フォルダを開く。直接保存方式では前回のフォルダを覚えて開き直せる（許可確認を含む） | 必須 | 実装済み | `packages/app/src/commands/file.ts` の `openFolder`・`openLastFolder`、`packages/app/src/fs/direct.ts` の `rememberDirectory`・`recallDirectory`・`ensurePermission` | `packages/app/src/fs/fs.test.ts`「API の有無で方式を決める（NFR-04）。許可が無ければ求める」、`packages/app/e2e/fileaccess.spec.ts`「…前回のフォルダを開き直せる」 | 許可の確認は画面テスト（OPFS）では出ないので、偽物のハンドルの単体テストだけ。確認=動作 |
| FR-FIO-02 | Ctrl+S で変更のあるすべてのテーブルを保存。自動保存しない | 必須 | 実装済み | `packages/core/src/edit/session.ts` の `planSave`・`markSaved`、`packages/app/src/store/AppStore.ts` の `save` | `packages/app/src/store/store.test.ts`「変更のあるテーブルだけを保存し、未保存の印が消える。何も変えなければ保存しない」、`packages/app/e2e/fileaccess.spec.ts`「…そのファイルだけが書き換わる」 | 共通設定の変更も保存する。確認=動作 |
| FR-FIO-03 | テーブルごとに未保存の印 | 必須 | 実装済み | `packages/core/src/edit/session.ts` の `isTableModified`、`packages/app/src/components/SheetTabs.tsx`（`tab-modified`） | `packages/core/src/edit/session.test.ts`「未保存の判定（FR-FIO-03〜05）」、`packages/app/e2e/smoke.spec.ts` | 手で元の値に戻しても、正規形のテキストが同じなら未保存にしない。確認=動作 |
| FR-FIO-04 | 未保存の変更はテーブルを切り替えても残す | 必須 | 実装済み | `packages/core/src/edit/session.ts`（テーブルごとの状態の番号） | `packages/core/src/edit/session.test.ts`「§5.17 の 5 番」、`packages/app/e2e/smoke.spec.ts`「テーブルを切り替えても未保存の変更と印が残る」 | 確認=動作 |
| FR-FIO-05 | 未保存のまま閉じる・再読み込みするときは確認 | 必須 | 実装済み | `packages/app/src/App.tsx`（`beforeunload`）、`packages/app/src/store/AppStore.ts` の `confirmDiscard` | `packages/app/e2e/fileaccess.spec.ts`「未保存のままページを閉じるときは確かめる」、`packages/app/e2e/discard.spec.ts` | 確認=動作 |
| FR-FIO-06 | 未保存の変更を IndexedDB に随時退避し、異常終了後に復元を提案 | 推奨 | 実装済み | `packages/app/src/store/backup.ts` の `BackupManager`・`installBackup`、`packages/app/src/fs/backupStore.ts`、`packages/app/src/dialogs/backup.tsx` | `packages/app/src/store/backup.test.ts`（退避の書き込みに失敗したときの知らせ方を含む）、`packages/app/e2e/backup.spec.ts` | 退避は Web Worker で行い、1 万行でもメインスレッドを止めない。退避に失敗したら、成功から失敗に変わったときに 1 回だけステータスに出す（P-66）。確認=動作 |
| FR-FIO-07 | 直接保存方式では、ウィンドウに戻ったときと保存の直前に更新日時を確認し、読み込み直すか上書きするかを選ばせる | 必須 | 実装済み | `packages/app/src/store/externalChanges.ts` の `ExternalChangeWatcher`、`packages/app/src/dialogs/externalChanges.tsx`、`packages/core/src/edit/session.ts` の `reloadFiles` | `packages/app/src/store/externalChanges.test.ts`、`packages/core/src/edit/reload.test.ts`、`packages/app/e2e/external.spec.ts` | 更新日時が変わっても中身が同じなら変更とみなさない。確認=動作 |
| FR-FIO-08 | 検査エラーがあっても保存は止めない | 必須 | 実装済み | `packages/app/src/store/AppStore.ts` の `save`（検査を見ない） | `packages/app/e2e/fileaccess.spec.ts`（hp を 0 にしてエラー 1 件のまま保存） | 確認=動作 |

### §5.14 参照

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-REF-01 | 参照列のセルから参照先のレコードへ移動 | 推奨 | 実装済み | `packages/app/src/commands/reference.ts` の `gotoReference`・`cell.gotoRef`、`packages/app/src/grid/extensions/references.tsx`（Ctrl+クリック） | `packages/app/src/commands/gridFeatures.test.ts`「参照先へ移動する」、`packages/app/e2e/gridOps.spec.ts`「参照: …Ctrl+クリックと右クリックで参照先へ移る」 | 確認=動作。Ctrl+クリックにした判断は P-61 |
| FR-REF-02 | 選択中のレコードがどこから参照されているかを一覧 | 将来 | 対象外 | — | — | 計画書 §6 で実装しないとした。テーブル単位の参照元の一覧（`findTableReferences`）は削除の警告にだけ使う |

### §5.15 右クリックメニュー

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-CTX-01 | セル・行番号・列ヘッダー・シートタブの 4 か所で右クリックメニュー（項目は表のとおり） | 必須 | 実装済み | `packages/app/src/grid/extensions/contextMenus.ts` の `cellMenu`・`rowHeaderMenu`・`columnHeaderMenu`、`packages/app/src/grid/extensions/sheetTabs.ts` の `sheetTabMenuExtension`、`packages/app/src/commands/contextMenu.ts`（Shift+F10）、`packages/app/src/components/SheetTabs.tsx`（タブの上の Shift+F10） | `packages/app/src/commands/gridFeatures.test.ts`「右クリックメニュー（FR-CTX-01）」、`packages/app/e2e/gridOps.spec.ts`「右クリックメニュー: …Shift+F10 でも開く」、`packages/app/e2e/tables.spec.ts`（シートタブ）、`packages/app/e2e/keyboard.spec.ts`（列ヘッダーとシートタブのメニューをキーで開く） | 項目を要件書の表と 1 つずつ照らし、すべてあることを確かめた（セル 11 項目、行番号 4、列ヘッダー 9、シートタブ 3）。列ヘッダーには「列のサイズを変更」を足した（Googleスプレッドシートと同じ）。シートタブのメニューは、タブにフォーカスがあるときの Shift+F10 / ContextMenu キーでも開く（J）。確認=動作 |

### §5.16 その他

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-ETC-01 | Ctrl+/ でショートカットの一覧 | 推奨 | 実装済み | `packages/app/src/commands/help.ts` の `help.shortcuts`、`packages/app/src/dialogs/shortcuts.tsx` の `shortcutsDialog`・`groupShortcuts`、`packages/core/src/sheet/shortcuts.ts` | `packages/app/src/commands/dialogsPanels.test.ts`「ショートカットを分類ごとに分ける」、`packages/app/e2e/tools.spec.ts`「Ctrl+/ でキーボード ショートカットの一覧を分類ごとに出す」 | J が足した F6 / Shift+F6、Ctrl+Alt+. / Ctrl+Alt+,、Alt+Shift+K も一覧に出る（分類「フォーカスの移動」「シート」）。一覧の下の分類は、ダイアログの本文に Tab で止まってスクロールして読める（J）。確認=動作 |
| FR-ETC-02 | 文言を外部ファイルに分け、日本語と英語を切り替えられる | 推奨 | 実装済み | `packages/app/src/i18n/locales/{ja,en}/*.json`、`packages/core/src/i18n/locales/{ja,en}/*.json`、`packages/app/src/store/locale.ts` の `changeLocale`、`packages/app/src/commands/locale.ts` | `packages/app/src/i18n/i18n.test.ts`「コードで使っている ui. の文言キーは、すべて文言ファイルにある」、`packages/core/src/i18n/bundles.test.ts`、`packages/app/e2e/locale.spec.ts` | 監査でコメント以外の日本語の直書きを検索し、画面の文言には無いことを確かめた。既定の共通設定の値は日本語のデータ（B-11、P-59）。確認=動作 |

### §5.17 受け入れ基準

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| AC-1 | 1,000 行 × 20 列で下へドラッグして下端を越え、500 行目で離すと 1〜500 行目が選択 | 受け入れ基準 | 実装済み | FR-SEL-03・04 を参照 | `packages/app/e2e/gridOps.spec.ts`「§5.17 の 1 番」、`packages/core/src/sheet/selection.test.ts`「受け入れ基準 1」 | 画面テストは 1 万行 × 50 列で行う。確認=動作 |
| AC-2 | Googleスプレッドシートで 3×3（1 セルはセル内改行）をコピーして `string` 列 3 列に貼り、逆にもコピーすると 9 個が一致 | 受け入れ基準 | 一部 | FR-CLP-02 を参照 | `packages/app/e2e/acceptance.spec.ts`「2. …」（Googleスプレッドシートの形の `text/plain` と `text/html` で両方向）、`packages/core/src/sheet/clipboard.test.ts`「受け入れ基準 2」 | 想定した形式（計画書 U-2）では両方向とも 9 個が一致する（H の `33a73b8` で画面テストを足した）。Googleスプレッドシートの実物では未確認（G-4） |
| AC-3 | `int` 列に `10`・`abc`・`30` を貼ると、どのセルも変わらず「2 行目: abc は整数ではありません」 | 受け入れ基準 | 実装済み | FR-CLP-04 を参照 | `packages/app/e2e/smoke.spec.ts`「貼り付けの失敗は…（§5.17 の 3 番）」、`packages/core/src/edit/codes.test.ts`「§5.17 の 3 番」 | 「2 行目」は表示上の行の番号（1 行目に貼ったので、貼った範囲の 2 行目と一致する）。確認=動作 |
| AC-4 | `1`・`2` を選んでフィルハンドルで下へ 3 セルで `3`・`4`・`5` | 受け入れ基準 | 実装済み | FR-FIL-01・02 を参照 | `packages/app/e2e/gridOps.spec.ts`「§5.17 の 4 番」、`packages/core/src/sheet/fill.test.ts`「受け入れ基準 4」 | 確認=動作 |
| AC-5 | A の hp を 800 → 1000、保存せず B を開いて A に戻ると 1000 のまま。A のタブに未保存の印 | 受け入れ基準 | 実装済み | FR-FIO-03・04 を参照 | `packages/app/e2e/smoke.spec.ts`「テーブルを切り替えても未保存の変更と印が残る（§5.17 の 5 番）」 | 確認=動作 |
| AC-6 | A を編集し、B を編集してから Ctrl+Z を 2 回で B、A の順に戻り、それぞれ表示される | 受け入れ基準 | 実装済み | FR-HIS-02 を参照 | `packages/app/e2e/smoke.spec.ts`「元に戻すと、変更のあったテーブルを表示する（§5.17 の 6 番）」、`packages/core/src/edit/session.test.ts` | 確認=動作 |
| AC-7 | サンプルを開いて何も変えずに保存すると、どのファイルも 1 バイトも変わらない | 受け入れ基準 | 実装済み | DR-30、FR-FIO-02 を参照 | `packages/app/e2e/acceptance.spec.ts`「7. …」（直接保存方式。保存の前後でバイト列・更新日時を比べ、書き込みが起きないことも確かめる）、`packages/core/src/io/project.test.ts`「NFR-16・DR-30」、`packages/app/src/store/store.test.ts`、`packages/cli/src/run.test.ts`「fmt」 | YAML と JSON の両方のサンプルで行う。確認=動作 |
| AC-8 | Googleスプレッドシートと本ツールで `IF` の式がどちらも 2400 | 受け入れ基準 | 実装済み | FR-FML-02・03 を参照 | `packages/app/e2e/acceptance.spec.ts`「8. …」（画面でセル単位式を入れる）、`packages/core/src/formula/evaluate.test.ts`「§5.17 の 8 番」 | 本ツールの側は画面テストで 2400。Googleスプレッドシートの側（`=IF(C2="SSR", D2*2, D2)` が 2400）は手で確かめる（テストの注記）。確認=動作 |
| AC-9 | Firefox でフォルダを読み込み、1 セル変えて保存するとダウンロード。元のフォルダに置いて開き直すと反映 | 受け入れ基準 | 一部 | NFR-03 を参照 | `packages/app/e2e/acceptance.spec.ts`「9. …」（`showDirectoryPicker` を消した Chromium で、`webkitdirectory` でフォルダを読み込み → 保存 → ダウンロードしたファイルを元のフォルダに置く → 開き直す）、`packages/app/e2e/fileaccess.spec.ts` | Chromium の擬似では一連が動き、差分は変えたセルの 1 行だけ（H の `33a73b8`）。Firefox の実物では未確認（G-2） |

### §6.1 プロジェクトの構成

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| DR-01 | ルートのプロジェクト設定ファイルでプロジェクトを認識 | 必須 | 実装済み | `packages/core/src/io/project.ts` の `loadProject`（`masterdata-maker.yaml` / `masterdata-maker.json`。P-01） | `packages/core/src/io/project.test.ts`「設定ファイルが無ければプロジェクトではない。両方あればエラー」、`packages/app/src/store/store.test.ts`「プロジェクトでないフォルダは開かず、理由を残す」 | 確認=テスト |
| DR-02 | リソースファイルの形式を 1 つ指定。混在させない。違う拡張子は警告 | 必須 | 実装済み | `packages/core/src/io/decode-config.ts` の `decodeProjectConfig`、`packages/core/src/io/parse.ts` の `parseTableFile`（`formatMismatch`） | `packages/core/src/io/table.test.ts`「DR-02: storage.format と違う拡張子は警告する…」、`packages/core/src/io/project.test.ts` | 違う拡張子のファイルも読み込んで警告し、保存では元の形式のまま書く（混在は `convert` で解消する）。確認=テスト |
| DR-03 | `format_version` を持たせる | 必須 | 実装済み | `packages/core/src/io/decode-config.ts`（`CURRENT_FORMAT_VERSION` より新しければエラー） | `packages/core/src/io/project.test.ts`「設定ファイルの知らないキー・新しすぎる版・形式の指定漏れはエラー」 | 確認=テスト |
| DR-04 | テーブルの識別子は `table` に一本化。ファイル名が違えば警告 | 必須 | 実装済み | `packages/core/src/io/parse.ts` の `parseTableFile`（`fileNameMismatch`） | `packages/core/src/io/table.test.ts`「…DR-04: ファイル名が <table>.<拡張子> でなければ警告する」 | 同じ `table` が複数あれば、どれも読み込みエラーにする。確認=テスト |
| DR-05 | 共通設定とテーブルの置き場所を指定できる | 推奨 | 実装済み | `packages/core/src/model/project.ts` の `resolveProjectPaths` | `packages/core/src/io/project.test.ts`「paths で置き場所を変えられる（DR-05）」 | 確認=テスト |
| DR-06 | 表示設定は `view` に保存。並べ替えとフィルタは保存しない | 必須 | 実装済み | `packages/core/src/io/serialize.ts` の `viewNode`、`packages/app/src/store/types.ts`（並べ替え・フィルタは画面の状態だけ） | `packages/core/src/io/table.test.ts`「view（DR-06、P-05）」 | 確認=テスト |
| DR-07 | タイムゾーンを持たせる（省略時はブラウザ） | 必須 | 実装済み | `packages/core/src/io/decode-config.ts`（`timezone`）、`packages/core/src/calc/calculator.ts` の `resolveTimeZone`、`packages/core/src/util/datetime.ts` の `defaultTimeZone` | `packages/core/src/io/project.test.ts`「使えないタイムゾーンは警告にとどめる」、`packages/core/src/util/datetime.test.ts`「タイムゾーン」 | 確認=テスト |

### §6.2 テーブルファイル

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| DR-10 | `table`・`display_name`・`fields`・`records`・`view` を持つ | 必須 | 実装済み | `packages/core/src/io/decode-table.ts` の `decodeTable`、`packages/core/src/io/serialize.ts` の `tableToTree` | `packages/core/src/io/roundtrip.test.ts`、`packages/core/src/io/table.test.ts` | 確認=テスト |
| DR-11 | SimpleCell か RichCell `{ value, override, color, comment }`。注記が無ければ値だけ。`value` にリストも | 必須 | 実装済み | `packages/core/src/model/cell.ts` の `RichCell`、`packages/core/src/io/decode-value.ts` の `decodeCell`、`packages/core/src/io/serialize.ts` の `cellNode` | `packages/core/src/io/table.test.ts`「RichCell（DR-11、P-04）」 | 確認=テスト |
| DR-12 | 列定義の知らないキーは読み込みエラー（直下の `required` を見つける） | 必須 | 実装済み | `packages/core/src/io/decode-field.ts` の `decodeFieldDef`（`fieldKeyBelongsToValidation`） | `packages/core/src/io/table.test.ts`「DR-12: 列定義の知らないキー」 | 監査で CLI を実行して確認。確認=動作 |
| DR-13 | 型は 11 種。`enum` と `list<enum>` は `enum_ref` が必須 | 必須 | 実装済み | `packages/core/src/model/field.ts`、`packages/core/src/validate/fields.ts` の `checkFieldDef`（`enumRefMissing`） | `packages/core/src/model/model.test.ts`、`packages/core/src/validate/validate.test.ts`「列定義の検査（FR-VAL-07）」 | `enum_ref` の欠けは読み込みエラーではなく検査のエラー。確認=テスト |
| DR-14 | 列定義のキーの一覧 | 必須 | 実装済み | `packages/core/src/model/field.ts` の `FIELD_KEYS` | `packages/core/src/io/table.test.ts`「列定義の保持」 | 確認=テスト |
| DR-15 | 未入力と `""` は区別しない。未入力はキーを書かない。出力は `default` か `null` | 必須 | 実装済み | `packages/core/src/model/cell.ts` の `isEmptyValue`、`packages/core/src/io/decode-value.ts`、`packages/core/src/export/export.ts` の `outValue` | `packages/core/src/io/table.test.ts`「DR-15・P-11・P-12: 未入力」、`packages/core/src/export/export.test.ts`「default と null（FR-OUT-04）」 | キーが消えるのはそのテーブルを保存したとき（B-10、P-58）。確認=テスト |
| DR-16 | 主キーは一意。行の追加では `auto: increment` に最大値＋1 | 必須 | 実装済み | `packages/core/src/edit/helpers.ts` の `nextNumbers`・`numberingColumns`、`packages/core/src/validate/validate.ts`（`primaryKeyDuplicate`） | `packages/core/src/edit/commands.test.ts`「主キーは既存の最大値＋1 から（DR-16）」、`packages/core/src/validate/validate.test.ts` | 確認=テスト |
| DR-17 | `ref` は `<テーブル>.<列>`。参照先は主キーか一意制約の列 | 必須 | 実装済み | `packages/core/src/validate/fields.ts` の `checkRef`・`parseRef`（`refTargetNotUnique`） | `packages/core/src/validate/validate.test.ts`「列定義の検査（FR-VAL-07）」「読み込みエラーのテーブルを ref・REF で指すと…」 | 読み込みエラーのテーブルを指すときは、そのことを示す文言を出す（B-9 を J が解消。`validate.refTableBroken`）。確認=テスト |
| DR-18 | `datetime` は時差付きの ISO 8601（秒まで）。画面はプロジェクトのタイムゾーン | 必須 | 実装済み | `packages/core/src/util/datetime.ts` の `parseIsoOffset`・`formatIsoOffset`・`parseUserDateTime`・`formatDisplay`、`packages/core/src/edit/input.ts` の `parseDateTime` | `packages/core/src/util/datetime.test.ts`、`packages/core/src/edit/input.test.ts`「datetime（P-19、DR-18）」 | 秒未満の入力は拒否する。確認=テスト |
| DR-19 | `int64` は引用符なしの数値で、BigInt で精度を落とさない | 必須 | 実装済み | `packages/core/src/io/json-parse.ts`（BigInt で読む）、`packages/core/src/io/yaml-parse.ts`（`intAsBigInt`）、`packages/core/src/io/emit.ts` | `packages/core/src/io/table.test.ts`「int64 は BigInt で精度を落とさずに読み書きする」 | サンプルの `power: 9007199254740993` が出力でも保たれることを CLI で確認。確認=動作 |

### §6.3 共通設定

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| DR-20 | 列挙型の定義（名前・表示名・値の一覧） | 必須 | 実装済み | `packages/core/src/model/common.ts` の `EnumDef`、`packages/core/src/io/decode-config.ts` の `decodeEnums`、`packages/core/src/io/serialize.ts` の `serializeEnums` | `packages/core/src/io/project.test.ts`「列挙型の値は文字列。引用符なしの数値は復元して警告する」 | 確認=テスト |
| DR-21 | 共通列の既定は `id`（主キー・自動採番・編集不可）と `version`（文字列で手入力） | 必須 | 実装済み | `packages/core/src/model/defaults.ts` の `defaultBaseFields` | `packages/core/src/io/project.test.ts`「共通設定のファイルが無ければ既定値を使い、保存してもファイルを作らない」 | 確認=テスト |
| DR-22 | セル色のプリセット（キー・色コード・ラベル） | 必須 | 実装済み | `packages/core/src/model/defaults.ts` の `defaultColors`、`packages/core/src/io/decode-config.ts` の `decodeColors` | `packages/core/src/model/model.test.ts`「既定のセル色は 8 色」 | 確認=テスト |

### §6.4 書き出し規則（正規形）

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| DR-30 | 同じデータは同じバイト列。読み込んで何も変えずに保存したら 1 バイトも変わらない | 必須 | 実装済み | `packages/core/src/io/serialize.ts`、`packages/core/src/io/project.ts` の `planProjectWrite`（`changed`） | `packages/core/src/io/project.test.ts`「NFR-16・DR-30: サンプルの往復」、`packages/cli/src/run.test.ts`「fmt」 | 監査で `fmt --check` を実行して確認。確認=動作 |
| DR-31 | UTF-8（BOM なし）、LF、末尾に改行 1 つ、インデント 2 | 必須 | 実装済み | `packages/core/src/io/emit.ts` の `emitYaml`・`emitJson`、`packages/core/src/io/parse.ts` の `parseText`（BOM を警告して除く） | `packages/core/src/io/table.test.ts`「テキストの扱い（DR-31）」 | 確認=テスト |
| DR-32 | キーの順を固定（テーブル・レコード・列定義） | 必須 | 実装済み | `packages/core/src/io/serialize.ts` の `tableToTree`・`recordNode`・`fieldNode` | `packages/core/src/io/table.test.ts`「DR-32・DR-34: レコードのキーの順と知らないキー」「キーの順が違う列定義は DR-14 の順に直す」 | 確認=テスト |
| DR-33 | YAML のレコードは 1 フィールド 1 行。リストと RichCell も 1 行 | 推奨 | 実装済み | `packages/core/src/io/serialize.ts`（`seq(..., true)`・`map(..., true)`） | `packages/core/src/io/roundtrip.test.ts`、`packages/core/src/io/table.test.ts` | 確認=テスト |
| DR-34 | 列定義に無いキーは消さずに末尾に残し、警告 | 推奨 | 実装済み | `packages/core/src/io/decode-table.ts` の `decodeRecord`（`unknownRecordKey`）、`packages/core/src/io/serialize.ts` の `recordNode` | `packages/core/src/io/table.test.ts`「列定義に無いキーは警告し、レコードの末尾に元の順で残す」 | 確認=テスト |
| DR-35 | 小数は最短の 10 進表記。`NaN`・`Infinity` は保存できない | 必須 | 実装済み | `packages/core/src/io/emit.ts` の `formatNumber`、`packages/core/src/edit/input.ts` の `parseFloat64` | `packages/core/src/io/table.test.ts`「DR-35: 小数」 | 確認=テスト |
| DR-36 | `int` は安全な整数の範囲に限る | 必須 | 実装済み | `packages/core/src/edit/input.ts` の `parseInt32`、`packages/core/src/validate/values.ts`（`intOutOfRange`） | `packages/core/src/io/table.test.ts`「int は安全な整数なら number、範囲外なら BigInt のまま保持する」、`packages/core/src/edit/input.test.ts`「int（DR-36）」 | 範囲外の値は読み込みで保持し、検査でエラーにする。確認=テスト |

### §6.5 YAML の規則

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| DR-40 | YAML 1.2 で書き出す | 必須 | 実装済み | `packages/core/src/io/emit.ts` の `emitYaml`、`packages/core/src/io/yaml-parse.ts`（`%YAML 1.1` は拒否） | `packages/core/src/io/yaml-parse.test.ts`「%YAML 1.1 の指示は値の解釈が変わるので拒否する」 | 確認=テスト |
| DR-41 | YAML 1.1・1.2 で文字列以外に読まれうる文字列は引用符。`datetime` は常に引用符 | 必須 | 実装済み | `packages/core/src/io/emit.ts` の `yamlNeedsQuote`・`yamlDoubleQuote` | `packages/core/src/io/emit.test.ts`「DR-41: 文字列の引用」（YAML 1.1 と 1.2 で読み直す） | 監査で CLI の出力に `code: "NO"`・`name: "no"` を確認。確認=動作 |
| DR-42 | YAML のタグではなく列の型で解釈。`string` 列の引用符なしの `1.10` は警告（復元できればなお良い） | 必須（復元は推奨） | 実装済み | `packages/core/src/io/decode-value.ts` の `decodeScalar`・`restoreSource` | `packages/core/src/io/table.test.ts`「DR-42: 列の型で値を解釈する」 | 復元もする。監査で CLI を実行して確認。確認=動作 |
| DR-43 | アンカー・エイリアス・独自のタグは読み込みエラー | 必須 | 実装済み | `packages/core/src/io/yaml-parse.ts` の `parseYamlWithLibrary`（`yamlAnchorNotAllowed` など） | `packages/core/src/io/yaml-parse.test.ts`「DR-43: アンカー・エイリアス・タグは読み込みエラー」 | 標準のタグも拒否する。高速の読み込み（C-4）は正規形でない入力を辞退してライブラリの経路に回す。確認=動作 |
| DR-44 | YAML のコメントは保存時に残さない。警告もしない | 必須 | 実装済み | `packages/core/src/io/serialize.ts` | `packages/core/src/io/table.test.ts`「YAML のコメントは保存で消す（DR-44）」 | 確認=動作 |

### §6.6 JSON の規則

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| DR-50 | 標準の JSON（RFC 8259）。JSON5・JSONC は受け付けない | 必須 | 実装済み | `packages/core/src/io/json-parse.ts` の `parseJson`（自前の厳密なパーサー） | `packages/core/src/io/json-parse.test.ts`「JSON の厳密なパーサー（DR-50）」 | 重複キーも拒否する。確認=テスト |
| DR-51 | JSON のレコードは 1 フィールド 1 行。リストと RichCell は 1 行 | 必須 | 実装済み | `packages/core/src/io/emit.ts` の `emitJson`・`jsonInline` | `packages/core/src/io/emit.test.ts`「JSON: ブロックは複数行、フローは 1 行」、`packages/core/src/io/roundtrip.test.ts` | 確認=テスト |

### §7 数式

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-FML-01 | 列レベル式とセル単位式。値 ＞ セル単位式 ＞ 列レベル式 | 必須 | 実装済み | `packages/core/src/calc/calculator.ts` の `Calculator.compute`・`formulaCell` | `packages/core/src/calc/calculator.test.ts`「サンプルの実効値（P-10）」 | `default` を加えた順（P-10）。確認=テスト |
| FR-FML-02 | 演算子（`+ - * / ^ & = <> < > <= >= %`）、`"…"` と `""`、`TRUE` / `FALSE` | 必須 | 実装済み | `packages/core/src/formula/lexer.ts`、`packages/core/src/formula/parser.ts`、`packages/core/src/formula/arith.ts` の `applyBinary`・`applyPercent` | `packages/core/src/formula/parser.test.ts`、`packages/core/src/formula/evaluate.test.ts`「演算子」 | 優先順位は `-2^2 = 4`（第三者の報告で確認）。確認=テスト |
| FR-FML-03 | 表の関数を、名前・引数・結果を Googleスプレッドシートと同じに。関数名は大文字小文字を区別しない | 必須 | 実装済み | `packages/core/src/formula/functions/*.ts`、`packages/core/src/formula/functions/index.ts` の `FUNCTIONS` | `packages/core/src/formula/functions.test.ts`「要件書 §7 の関数がすべてある」ほか 66 件 | 表の 40 関数がすべてある。結果の一部は Googleスプレッドシートで未検証（G-4）。確認=テスト |
| FR-FML-04 | 独自の関数は `REF(テーブル名, キーまたはキーのリスト, 列名)` だけ | 必須 | 実装済み | `packages/core/src/formula/functions/ref.ts` の `REF`、`packages/core/src/calc/calculator.ts` の `lookupRef` | `packages/core/src/formula/evaluate.test.ts`「REF（FR-FML-04、P-31）」、`packages/core/src/calc/calculator.test.ts`「REF」、`packages/core/src/validate/validate.test.ts`「読み込みエラーのテーブルを ref・REF で指すと…」 | テーブル名と列名は文字列リテラルに限る（P-31）。参照先が読み込みエラーのテーブルなら `#REF!`「テーブル「…」は読み込みエラーのため参照できません」（B-9、J）。確認=テスト |
| FR-FML-05 | リスト型の値は範囲と同じに扱う（`SUM(costs)`、`COUNTIF(...)`） | 必須 | 実装済み | `packages/core/src/formula/values.ts` の `FList`、`packages/core/src/formula/functions/aggregate.ts` | `packages/core/src/formula/functions.test.ts`「SUM」「COUNTIF」 | 確認=テスト |
| FR-FML-06 | `datetime` は比較と日付の関数で扱える。`NOW`・`TODAY`・`RAND`・`RANDBETWEEN` は使えない | 必須 | 実装済み | `packages/core/src/formula/functions/date.ts`、`packages/core/src/formula/functions/index.ts` の `VOLATILE_FUNCTIONS` | `packages/core/src/formula/evaluate.test.ts`「日時の計算（P-15）」「実行のたびに結果が変わる関数は使えない」 | 確認=テスト |
| FR-FML-07 | `int64` の計算は整数のまま。小数と混ぜたらエラー | 必須 | 実装済み | `packages/core/src/formula/arith.ts` | `packages/core/src/formula/evaluate.test.ts`「int64（FR-FML-07）」 | 割り切れない割り算は `#NUM!`（P-14）。確認=テスト |
| FR-FML-08 | 式は一度構文木にし、計算と依存関係の抽出の両方に使う | 必須 | 実装済み | `packages/core/src/formula/parser.ts` の `parseFormula`・`ParseCache`、`packages/core/src/formula/dependencies.ts` の `extractDependencies` | `packages/core/src/formula/parser.test.ts`、`packages/core/src/formula/dependencies.test.ts` | 確認=テスト |
| FR-FML-09 | 依存関係の順に計算する | 必須 | 実装済み | `packages/core/src/calc/calculator.ts`（必要になったときに再帰的に評価） | `packages/core/src/calc/calculator.test.ts`「a = b + 1、b = 10 なら a は 11」 | 確認=テスト |
| FR-FML-10 | `IF` は選ばれなかった側を計算しない。AND / OR の評価も合わせる | 必須 | 実装済み | `packages/core/src/formula/evaluate.ts` の `LazyArg`、`packages/core/src/formula/functions/logical.ts` | `packages/core/src/formula/evaluate.test.ts`「FR-FML-10: IF(1 = 1, 1, 1 / 0) は 1」、`packages/core/src/formula/functions.test.ts`「AND / OR / NOT」 | AND / OR は短絡しない（Excel の規則。B-5、P-54）。確認=テスト |
| FR-FML-11 | 循環参照を列レベル式・セル単位式・`REF()` のすべてで検出。文字列の中の語は依存でない | 必須 | 実装済み | `packages/core/src/calc/calculator.ts`（`EVALUATING` の印、`storeCircular`）、`packages/core/src/formula/dependencies.ts` | `packages/core/src/calc/calculator.test.ts`「循環参照（FR-FML-11、P-33）」、`packages/core/src/formula/dependencies.test.ts`「文字列リテラルの中の語…は依存とみなさない」 | 確認=テスト |
| FR-FML-12 | 計算結果を列の型で検査（`int` 列の 1.5 はエラー） | 必須 | 実装済み | `packages/core/src/formula/resultType.ts` の `checkResultType` | `packages/core/src/formula/resultType.test.ts`、`packages/core/src/calc/calculator.test.ts`「結果の型の検査」 | 確認=テスト |
| FR-FML-13 | エラー値（`#DIV/0!` など）を表示。種類・列・主キー・式の中の位置を持つ | 必須 | 実装済み | `packages/core/src/formula/values.ts` の `FormulaError`、`packages/core/src/validate/formula.ts` の `formulaIssue`、`packages/app/src/sheet/display.ts` の `cellDisplay` | `packages/core/src/validate/validate.test.ts`「式のエラー（FR-FML-13）」、`packages/app/src/sheet/display.test.ts`「式のエラーはエラー値を赤い文字で出す」 | 構文エラーは `#ERROR!`（P-35）。確認=動作 |
| FR-FML-14 | セルを編集したら依存する式だけを計算し直す | 推奨 | 実装済み | `packages/core/src/calc/calculator.ts` の `invalidateCell`・`propagate`、`packages/core/src/calc/invalidate.ts` の `invalidateForPatch` | `packages/core/src/calc/calculator.test.ts`「キャッシュと無効化（FR-FML-14）」、`packages/core/src/calc/invalidate.test.ts` | 確認=テスト |
| FR-FML-15 | `eval` や `Function` を使わない | 必須 | 実装済み | `packages/core/src/formula/evaluate.ts`（構文木を辿る評価器） | — | 監査で `packages` の中を `eval(`・`Function(` で検索し、使っていないことを確かめた。確認=動作 |
| FR-FML-16 | 出力には計算結果を書く | 必須 | 実装済み | `packages/core/src/export/export.ts` の `exportTableText` | `packages/core/src/export/export.test.ts`「§9.1 の例」 | 監査で CLI の出力（`effective_hp: 1560`・セル単位式の 1600）を確認。確認=動作 |

### §8 入力規則・検査

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-VAL-01 | エラー（`validation`）と警告（`anomaly`）の 2 段階 | 必須 | 実装済み | `packages/core/src/model/diagnostic.ts`、`packages/core/src/validate/validate.ts` | `packages/core/src/validate/validate.test.ts` | 確認=テスト |
| FR-VAL-02 | 検査するのは式を計算した後の値 | 必須 | 実装済み | `packages/core/src/validate/validate.ts` の `validateTable`（`calc.getCell`） | `packages/core/src/validate/validate.test.ts`「サンプルの値を変えると、検査で見つかる（実効値を検査する。FR-VAL-02）」 | 確認=テスト |
| FR-VAL-03 | 常に行う検査（型・列挙型・参照先・主キーの一意性・整数の範囲・`datetime`・リストの要素） | 必須 | 実装済み | `packages/core/src/validate/values.ts` の `inspectRawValue`、`packages/core/src/validate/validate.ts` の `checkItem`・`collectStats` | `packages/core/src/validate/validate.test.ts`「常に行う検査（FR-VAL-03）」 | 確認=動作 |
| FR-VAL-04 | `required`・`min`・`max`・`max_length`・`max_items`・`regex`・`unique`。`min`/`max` は `datetime` にも | 必須 | 実装済み | `packages/core/src/validate/validate.ts` の `planColumns`・`checkItem`、`packages/core/src/validate/fields.ts` の `compareToBound`、`packages/core/src/validate/regex.ts` の `regexTest` | `packages/core/src/validate/validate.test.ts`「列ごとのルール（FR-VAL-04）と警告（FR-VAL-05）」 | `max_length` はコードポイントで数える。`regex` は RE2 の部分一致（C-2）。確認=テスト |
| FR-VAL-05 | `warn_above`・`warn_below`・`warn_deviation` | 必須 | 実装済み | `packages/core/src/validate/validate.ts` の `collectStats`（母標準偏差） | `packages/core/src/validate/validate.test.ts`「warn_above・warn_below・warn_deviation（母標準偏差）」 | 確認=テスト |
| FR-VAL-06 | `warn_delta`（前回からの変化量） | 将来 | 対象外 | — | — | 実装しない。書かれていれば `anomaly` の知らないキーとして読み込みエラーになる |
| FR-VAL-07 | 列定義の検査（知らないキー・列名の重複・列名の書式・存在しない列挙型や参照先・式の構文エラー） | 必須 | 実装済み | `packages/core/src/validate/fields.ts` の `checkFieldDef`・`isValidColumnName`、`packages/core/src/validate/validate.ts` の `checkTableFields` | `packages/core/src/validate/validate.test.ts`「列定義の検査（FR-VAL-07）」、`packages/app/e2e/columnSettings.spec.ts`「…列定義の検査に違反するときは、理由を示して確定させない」 | 読み込みエラーのテーブルを指す `ref`・`REF()` の文言は J が直した（B-9）。`default` の検査は K が切り出した `checkDefaultValue`（`packages/core/src/validate/values.ts`）を使う（出力の P-51 と同じ判定）。確認=動作 |
| FR-VAL-08 | 結果はテーブル・主キー・列・重大度・メッセージを持つ。配列の番号でなく主キー | 必須 | 実装済み | `packages/core/src/model/diagnostic.ts` の `Diagnostic`（`recordKey`・`recordUid`）、`packages/core/src/calc/calculator.ts` の `recordKey` | `packages/core/src/validate/validate.test.ts`「エラーの種類・列・主キー・式の中の位置を持つ」、`packages/cli/src/run.test.ts`「「重大度 ファイル テーブル 主キー 列: メッセージ」の形で出す」 | 確認=動作 |
| FR-VAL-09 | 編集から 300 ms 以内に全テーブルを検査し直し、枠・問題パネル・タブの件数に反映 | 必須 | 実装済み | `packages/app/src/store/AppStore.ts` の `scheduleValidation`・`runValidation`、`packages/core/src/validate/deps.ts` の `affectedTables` | `packages/app/src/store/store.test.ts`「AppStore: 検査（FR-VAL-09）」、`packages/app/e2e/worker.spec.ts`「検査は Worker で動き、編集から 300 ミリ秒以内に…」 | 変更のあったテーブルとそれを参照するテーブルだけを検査し直す（計画書 §4.2）。1 万行では、編集から反映までの判定は 1000 ms のまま（T-1）。確定の後の再検査の往復は `perf.spec.ts` が中央値 300 ms 未満で判定する（測定値 146〜175 ms）。測定値（反映まで）は 152〜242 ms。確認=動作 |
| FR-VAL-10 | 検査は Web Worker で動かし、時間制限を設ける | 推奨 | 実装済み | `packages/app/src/worker/validation.worker.ts`、`packages/app/src/worker/engine.ts`、`packages/app/src/store/workerValidator.ts`（時間切れで作り直す） | `packages/app/src/store/workerValidator.test.ts`、`packages/app/e2e/worker.spec.ts`「時間制限を過ぎたら Worker を作り直し、時間切れを示す」 | RE2 なので ReDoS はもともと起きない（C-2）。確認=動作 |
| FR-VAL-11 | 画面と CLI で同じ検査処理 | 必須 | 実装済み | `packages/core/src/validate/validate.ts` の `validateTable`（画面: `packages/app/src/store/validation.ts` の `runValidation`、CLI: `packages/cli/src/run.ts` の `cmdValidate` → `validateProject`） | `packages/app/src/store/workerValidator.test.ts`「…検査の結果はメインスレッドの検査と一致する」 | 確認=テスト |

### §9.1 出力

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-OUT-01 | 出力の形式は JSON・YAML・CSV・Protocol Buffers（既定は `output.format`、無ければ JSON。画面と CLI でその回だけ変えられる）。リソースファイルとは別に選べる | 必須 | 実装済み | `packages/core/src/model/project.ts` の `resolveProjectPaths`（`outputFormat`）、`packages/core/src/export/export.ts`・`csv.ts`（P-62）・`protobuf.ts`（P-63）、`packages/app/src/dialogs/export.tsx`（形式の選択）、`packages/cli/src/run.ts`（`--format`） | `packages/core/src/export/export.test.ts`「サンプルの出力（FR-OUT-01〜04）」、`packages/core/src/export/formats.test.ts`、`packages/cli/src/run.test.ts`「--format で形式を選ぶ…」、`packages/app/e2e/export.spec.ts`「形式を選べる…」 | 監査で YAML の出力も確認。`.proto` は protoc でコンパイルでき、`.pb` を Python の protobuf で読み戻すと JSON の出力と一致することを手元で確認（CI では行わない）。確認=動作 |
| FR-OUT-02 | `export: false` を除く、式は計算結果、色とメモは含めない、共通列は含める、1 テーブル＝1 ファイル＝レコードの配列 | 必須 | 実装済み | `packages/core/src/export/export.ts` の `exportTableText` | `packages/core/src/export/export.test.ts` | 確認=動作 |
| FR-OUT-03 | 出力にも正規形。キーは列定義の順。同じ入力からは同じ出力 | 必須 | 実装済み | `packages/core/src/export/export.ts`（`emitJson`・`emitYaml` を共用） | `packages/core/src/export/export.test.ts`「YAML の出力: トップレベルはシーケンス、1 フィールド 1 行、リストはフロー、DR-41 の引用」 | 確認=動作 |
| FR-OUT-04 | 未入力は `default` か `null` | 必須 | 実装済み | `packages/core/src/export/export.ts` の `outValue`（実効値の `raw`） | `packages/core/src/export/export.test.ts`「default と null（FR-OUT-04）」 | 確認=動作 |
| FR-OUT-05 | 検査エラーがあれば出力しない（CLI は終了コード 1）。`--force` のときだけ出力 | 必須 | 実装済み | `packages/core/src/export/export.ts` の `planExport`、`packages/cli/src/run.ts` の `cmdExport` | `packages/core/src/export/export.test.ts`「検査エラーと --force（FR-OUT-05）」、`packages/cli/src/run.test.ts`「検査エラーがあれば書かずに終了コード 1。--force なら書く」、`packages/app/e2e/export.spec.ts`、`packages/core/src/export/export.test.ts` と `packages/cli/src/run.test.ts` の `--force` の型に合わない値の場合（K の `bf5140b`） | `--force` で出力するとき、型に合わない値は `null` で出す（P-51。判定は常に行う検査と同じ `packages/core/src/validate/values.ts` の `checkRawValue`、`default` は `checkDefaultValue`。式のエラーも `null`。検査ルールの違反・警告・`ref` の参照先が無い値は、型には合っているのでそのまま出す。B-2）。テーブルを選んだときの検査の範囲は P-52（B-3）。確認=動作 |
| FR-OUT-06 | 画面から全テーブル（または選んだテーブル）を出力。直接保存方式は出力先フォルダ、ダウンロード保存方式はダウンロード | 推奨 | 実装済み | `packages/app/src/store/exportOutput.ts` の `runExport`、`packages/app/src/dialogs/export.tsx` の `exportDialog`、`packages/app/src/commands/export.ts` | `packages/app/src/store/exportOutput.test.ts`、`packages/app/e2e/export.spec.ts` | 保存していない変更も出力に含む。確認=動作 |
| FR-OUT-07 | 出力する版を指定すると、`version` がその版以下のレコードだけを出す（空の `version` は常に出す）。指定が無ければすべて | 必須 | 実装済み | `packages/core/src/export/version.ts` の `selectByVersion`、`packages/core/src/export/export.ts` の `planExport`（`version`）、`packages/app/src/dialogs/export.tsx`（版の入力欄）、`packages/cli/src/run.ts`（`--until`） | `packages/core/src/export/export.test.ts`「版を指定した出力（FR-OUT-07、P-64）」、`packages/cli/src/run.test.ts`「--until を付けると…」、`packages/app/src/store/exportOutput.test.ts`「版を指定すると…」、`packages/app/e2e/export.spec.ts`「版を指定すると…」 | 比べ方・空の版・読めない版・参照切れの扱いは P-64。確認=動作 |

### §9.2 CLI

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| FR-CLI-01 | `validate`: エラーがあれば終了コード 1 | 必須 | 実装済み | `packages/cli/src/run.ts` の `cmdValidate` | `packages/cli/src/run.test.ts`「validate（FR-CLI-01）」 | 警告だけなら 0、使い方の誤りと読み込みの失敗は 2。確認=動作 |
| FR-CLI-02 | `export`: 出力する | 必須 | 実装済み | `packages/cli/src/run.ts` の `cmdExport`（`--force`・`--tables`・`--out`・`--format`・`--until`） | `packages/cli/src/run.test.ts`「export（FR-CLI-02）」 | 確認=動作 |
| FR-CLI-03 | `new`: 共通列を含むテーブルの雛形 | 必須 | 実装済み | `packages/cli/src/run.ts` の `cmdNew` | `packages/cli/src/run.test.ts`「new（FR-CLI-03）」 | 雛形は `fields: []`（共通列は共通設定から付く。P-03）。確認=動作 |
| FR-CLI-04 | `fmt`: 正規形で書き直す。`--check` で正規形でなければ終了コード 1 | 推奨 | 実装済み | `packages/cli/src/run.ts` の `cmdFmt` | `packages/cli/src/run.test.ts`「fmt（FR-CLI-04）」 | 読み込みエラーのファイルは書かない（P-40）。確認=動作 |
| FR-CLI-05 | `convert`: YAML ⇔ JSON | 必須 | 実装済み | `packages/cli/src/run.ts` の `cmdConvert`、`packages/core/src/io/project.ts` の `planProjectWrite`（`format`） | `packages/cli/src/run.test.ts`「convert（FR-CLI-05）」 | 読み込みエラーのテーブルがあれば全体を取りやめる。確認=動作 |
| FR-CLI-06 | 実行環境は Node.js | 必須 | 実装済み | `packages/cli/src/main.ts`、`packages/cli/package.json`（esbuild で Node.js 20 向けの 1 ファイルにまとめる） | `packages/cli/src/run.test.ts` | 監査で Node.js 22 でビルドと実行を確認。確認=動作 |

### §10.1 動作環境

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| NFR-01 | デスクトップ版の Chrome・Edge・Firefox・Safari（最新の安定版） | 必須 | 一部 | ブラウザの名前で分けない作り（NFR-04） | `packages/app/playwright.config.ts`（chromium だけ） | Chromium 以外で動かしていない（G-2） |
| NFR-02 | 直接保存方式（`showDirectoryPicker()` が使えれば直接読み書き） | 必須 | 実装済み | `packages/app/src/fs/direct.ts` の `DirectoryProjectFs`・`directSource`・`pickDirectory` | `packages/app/src/fs/fs.test.ts`「直接保存方式（DirectoryProjectFs）」、`packages/app/e2e/fileaccess.spec.ts`（OPFS で本物の `createWritable()` を通る） | 確認=動作 |
| NFR-03 | ダウンロード保存方式（`webkitdirectory` で読み込み、1 ファイルならそのファイル、複数なら ZIP） | 推奨 | 実装済み | `packages/app/src/fs/download.ts` の `FileListProjectFs`・`filesToProject`・`downloadPlan`・`pickFolderWithInput` | `packages/app/src/fs/fs.test.ts`「ダウンロード保存方式」、`packages/app/e2e/export.spec.ts`（ZIP） | Safari の不具合の場合の扱いは未確認（§3.5）。確認=動作 |
| NFR-04 | 方式はブラウザの名前でなく API の有無で自動的に決める | 必須 | 実装済み | `packages/app/src/fs/direct.ts` の `supportsDirectAccess` | `packages/app/src/fs/fs.test.ts`「API の有無で方式を決める（NFR-04）」、`packages/app/e2e/fileaccess.spec.ts` | 確認=動作 |
| NFR-05 | ダウンロード保存方式では使えない機能を画面に示す | 必須 | 実装済み | `packages/app/src/components/TitleBar.tsx`（`mode-badge`）、`packages/app/src/components/StartScreen.tsx` | `packages/app/e2e/fileaccess.spec.ts`「API が無ければダウンロード保存方式になり、使えない機能を示す」 | 確認=動作 |
| NFR-06 | HTTPS の静的ホスティングで配る | 必須 | 実装済み | `packages/app/vite.config.ts`（`base: './'` の静的ファイル）、`README.md`「ビルド（静的ホスティング用）」（HTTPS の静的ホスティングに置く手順と、安全なコンテキストの注意） | 画面テストのたびにビルドと配信が成功 | 配布の手順は H の `33a73b8` の README にある（G-3 を解消）。実際の HTTPS のホスティングに置いて動かしたことは無い（画面テストは `localhost`）。配布の CI は無い。確認=コード |
| NFR-07 | サーバーを持たない。データを外部に送らない | 必須 | 実装済み | `packages/app/`（通信の処理が無い。サンプルは `import.meta.glob` でビルドに含める） | — | 監査で `fetch(`・`XMLHttpRequest`・`WebSocket`・`sendBeacon`・外部の URL を検索し、無いことを確かめた。確認=動作 |

### §10.2 性能

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| NFR-10 | 1 万行 × 50 列で移動や入力への反応が 100 ms 以内。スクロールが途切れない | 必須 | 実装済み | `packages/app/src/grid/useVirtual.ts`（`@tanstack/virtual-core`）、`packages/app/src/grid/GridCells.tsx`（行ごとの memo）、Web Worker での検査 | `packages/app/e2e/perf.spec.ts`「1 万行 × 50 列: 矢印キーの移動・入力の確定・スクロール」、`packages/app/e2e/worker.spec.ts`、`packages/app/e2e/backup.spec.ts` | 測定値は §2.4・§2.7。スクロールは J が判定を足した（T-2 を解消）: 100 px/フレームでフレームの間隔の中央値 20 ms 以下、描画の抜け 0 件（100 px・300 px）、250 ms 以上止まるフレームが無い。CPU の混み具合で揺れるので、100 px は 3 回まで測り直して一番良い回で判定する（根拠はテストの注記）。確認=動作 |
| NFR-11 | 100 テーブルのプロジェクトを 5 秒以内に開ける | 推奨 | 実装済み | `packages/core/src/io/yaml-fast.ts`（正規形の YAML の高速の読み込み。C-4）、`packages/app/src/fs/largeSample.ts`（100 テーブルの生成） | `packages/app/e2e/perf.spec.ts`「100 テーブル（1,000 行 × 20 列 × 99 と skill）のプロジェクトを直接保存方式で開く（yaml）」「…（json）」（5 秒未満で判定）。1 テーブルの読み込みの測定は `packages/core/scripts/bench-load.ts` | H の `33a73b8`。グリッドが出るまで YAML 1,601〜1,838 ms・JSON 1,576〜1,992 ms、全テーブルの最初の検査の結果がシートタブに出るまで 3,624〜4,396 ms（2026-10-15、Chromium。§2.7）。テーブルの大きさの決め方は D-4 を参照。Firefox・Safari では測っていない。確認=動作 |
| NFR-12 | 1 万行で 1 セル編集後の再計算と再検査が 300 ms 以内 | 推奨 | 実装済み | `packages/core/src/calc/calculator.ts` の `invalidateCell`、`packages/core/src/validate/deps.ts` の `affectedTables` | `packages/core/src/validate/validate.test.ts`「性能（NFR-12、D-4 の 1 万行 × 50 列）」、`packages/app/e2e/worker.spec.ts`、`packages/app/e2e/perf.spec.ts`（再検査の往復の中央値を 300 ms 未満で判定） | 測定値 215〜263 ms（Node.js）・146〜175 ms（画面。Worker との往復の中央値）で満たす。画面は H の `33a73b8` で 300 ms で判定するようになった。core の単体テストと `worker.spec.ts` の判定は 1000 ms のまま（T-1）。確認=動作 |

### §10.3 データの保全

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| NFR-15 | 保存の途中で失敗してもファイルが壊れない。`close()` の完了を待つ | 必須 | 実装済み | `packages/app/src/fs/direct.ts` の `DirectoryProjectFs.write`（失敗で `abort`）、`packages/cli/src/node-fs.ts` の `writeFileAtomic`（一時ファイルに書いて名前を変える） | `packages/app/src/fs/fs.test.ts`「書き込みに失敗したら元のファイルを残し、失敗として返す（NFR-15）」 | 実物のファイルでの途中の失敗は試していない（§3.5）。確認=テスト |
| NFR-16 | 読み込んで何も変えずに保存してもデータが変わらないことを、全サンプルで自動テスト | 必須 | 実装済み | — | `packages/core/src/io/project.test.ts`「basic-yaml: …1 バイトも変わらない」「basic-json: …」、`packages/core/src/io/roundtrip.test.ts`、`packages/core/src/io/yaml-fast.test.ts`（乱数で作った正規形のテーブル） | 確認=動作 |
| NFR-17 | 確認せずに未保存のデータを捨てない | 必須 | 実装済み | `packages/app/src/store/AppStore.ts` の `confirmDiscard`、`packages/app/src/commands/file.ts`、`packages/app/src/dialogs/externalChanges.tsx`、`packages/core/src/edit/commands/columns.ts` の `changeColumnType`（変換できない値を残す） | `packages/app/e2e/discard.spec.ts`、`packages/app/e2e/external.spec.ts`「保存していない変更のあるテーブルを読み込み直すときは…確かめる」、`packages/app/src/store/store.test.ts`「未保存の変更があれば、捨てる前に確かめる」 | 主な経路を確かめた。網羅的ではない（§3.5）。確認=動作 |

### §10.4 保守性と GUI ライブラリの選定条件

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| NFR-20 | 範囲選択・フィルハンドル・クリップボード・右クリック・列の固定・仮想スクロールを、有償版なしの公開 API で | 必須 | 実装済み | `@tanstack/virtual-core`（仮想スクロールだけ）と自前の DOM（計画書 C-1、§2.1） | — | 確認=コード（選定は計画書の記録を読んだ） |
| NFR-21 | ライブラリ内部の DOM 構造や非公開の属性に依存しない | 必須 | 実装済み | `packages/app/src/grid/useVirtual.ts`（`Virtualizer` の公開 API だけを使う）、グリッドの DOM は自前 | — | 確認=コード |
| NFR-22 | 直近 12 か月以内のリリース、MIT と両立するライセンス | 推奨 | 実装済み | `packages/app/package.json`（`@tanstack/virtual-core` 3.19.3） | — | 公開日は計画書 §2.1 の記録（2026-10-13）。ライセンスは監査で確認（MIT）。確認=コード |
| NFR-23 | 表計算の操作ロジックは描画ライブラリから独立した関数にして単体テスト | 必須 | 実装済み | `packages/core/src/sheet/`（`selection.ts`・`clipboard.ts`・`fill.ts`・`history.ts`・`compare.ts`・`filter.ts`・`find.ts`） | `packages/core/src/sheet/*.test.ts`（9 ファイル・168 件） | 確認=動作 |
| NFR-24 | データモデル・読み書き・数式・検査・出力は GUI に依存しないパッケージに置き、画面と CLI で共有 | 必須 | 実装済み | `packages/core/`（DOM・Node.js の API に依存しない。読み書きは `ProjectFs` を通す） | core の単体テストは Node.js で、画面はブラウザで同じコードを使う | 確認=動作 |

### §10.5 テスト

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| NFR-30 | データ処理の単体テスト（数式は Googleスプレッドシートの計算結果との一致を含む）、検査、読み書き（往復）、出力 | 必須 | 一部 | — | `packages/core/src/**/*.test.ts`（37 ファイル・776 件） | 数式・検査・読み書き・出力の単体テストはある。期待値が Googleスプレッドシートの実物の計算結果ではない（G-4） |
| NFR-31 | Playwright で §5.17 の受け入れ基準を自動化 | 必須 | 実装済み | `packages/app/playwright.config.ts`、`packages/app/e2e/acceptance.spec.ts` | `packages/app/e2e/acceptance.spec.ts`（受け入れ基準 1〜9 を番号順に 9 件） | H の `33a73b8` で 9 件そろった（G-5 を解消）。Googleスプレッドシート本体・Firefox・Safari が要る部分は、各テストの注記のとおり手で確かめる（G-2、G-4）。確認=動作 |

### §10.6 その他

| ID | 要件の要約 | 優先度 | 状態 | 実装 | テスト | 備考 |
|---|---|---|---|---|---|---|
| NFR-40 | キーボードだけで全操作ができる | 必須 | 実装済み | メニューバーの Alt+Shift+文字（`packages/app/src/components/MenuBar.tsx`）、右クリックメニューの Shift+F10（`packages/app/src/commands/contextMenu.ts`）、行・列の移動のメニュー（`packages/app/src/commands/moveRowsCols.ts`）、領域の間の移動 F6 / Shift+F6・Ctrl+Alt+.（`packages/app/src/components/focusRegions.ts`、core の `SHORTCUTS`）、列のサイズを変更（`packages/app/src/dialogs/columnResize.tsx`）、部品の上のキーの扱い（`packages/app/src/App.tsx`） | `packages/app/e2e/keyboard.spec.ts`（マウスを使わずにひととおりの作業をこなす。F6 の巡回の順。領域の中のキー操作）、`packages/app/src/commands/gridFeatures.test.ts`「行・列の移動のメニュー（キーだけでの操作。NFR-40）」「Shift+F10 と ContextMenu キーで…」「列のサイズを変更（…NFR-40）」、`packages/core/src/sheet/shortcuts.test.ts`「フォーカスの移動（NFR-40）」 | J が G-1 を解消した。キーで確かめた箇所の一覧は §2.7、マウスの操作の代わりの一覧は README「キーボードだけでの操作」。F6 / Shift+F6 と Alt+Shift+K の割り当ては Googleスプレッドシートの公式ヘルプで確かめられていない（G-1）。ブラウザによっては F6 がページに届かないことがありうる（Chromium のヘッドレスでだけ確かめた）。確認=動作 |
| NFR-41 | スクリーンリーダーへの対応は求めない | — | 対象外 | — | — | — |
| NFR-42 | 依存ライブラリのライセンスは MIT と両立 | 必須 | 実装済み | `packages/*/package.json` | — | 監査で `pnpm licenses list --prod` を実行: react・react-dom・scheduler・@tanstack/virtual-core・fflate・re2js が MIT、yaml が ISC、idb-keyval が Apache-2.0。確認=動作 |

---

## 5. 付録: §4 のスコープで「再現しない」とした機能

件数の集計には入れていない。再現しないとした機能が作られていないこと（範囲の外のものが紛れ込んでいないこと）を確かめた。

| Googleスプレッドシートの機能 | 要件書の扱い | 実装の状態 |
|---|---|---|
| 自動保存 | 再現しない（D-7） | 無い。IndexedDB への退避（FR-FIO-06）はファイルを書かない |
| 文字の装飾（フォント・太字・罫線・配置） | 再現しない | 無い。セルの配置は型で決まる（数値は右寄せ。`packages/app/src/sheet/display.ts`） |
| 条件付き書式・グラフ・ピボットテーブル | 再現しない | 無い |
| 版の履歴 | 再現しない | 無い |
| 複数人での編集 | 扱わない | 無い |
| Googleスプレッドシート本体との連携 | 対象外 | 無い。外部への通信の処理も無い（NFR-07） |
| 塗りつぶしの色 | 一部を再現（プリセット色のみ） | プリセットのキーだけを保存する（`setCellColor` は未定義のキーを拒否する） |
| 範囲の保護 | 形を変えて再現（列の編集不可設定） | `editable: false` と自動採番の列だけ（FR-EDT-06） |
