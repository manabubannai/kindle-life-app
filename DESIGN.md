# Kindle Life — DESIGN

SPEC.md の要件を実現する設計。既存2ツール（auto-send-newsletter-to-kindle / auto-send-blog-to-kindle）の実戦済みロジックを統合する。

## 0. 主要な設計判断

| 論点 | 決定 | 理由 |
|---|---|---|
| 配信単位 | **1記事 = 1通 = Kindleの1冊（個別配信）** | v0.1は2日に1回の合本ダイジェストだったが、1件ずつ届く方が使いやすいためv0.2で転換。書名が記事タイトルになり、読みたいものだけ開ける。合本のコードはgit履歴に残置 |
| 配信形式 | HTMLファイル添付（EPUBは見送り） | 2ツールで長期実運用済み。`Utilities.zip` はmimetypeを非圧縮・先頭配置できずEPUB仕様準拠が不可能。Chrome拡張のSTORE専用ZIPライター移植はv2候補 |
| トリガー | **毎時トリガー**（毎回新着チェック・届き次第送信） | 個別配信では時刻ゲートが不要になり、毎時実行がそのまま「最長1時間以内に届く」を実現。空振りコストは数秒×24回/日で無視できる |
| タイムゾーン | シートのタイムゾーン設定に追従（`getSpreadsheetTimeZone()`） | テンプレはAsia/Tokyoで作るが、海外ユーザーもそのまま正しく動く |
| OAuthスコープ | appsscript.json に明示宣言で最小化: `gmail.readonly` + `script.send_mail` + `script.external_request` + `spreadsheets.currentonly` + `script.scriptapp` + `userinfo.email` | フル `mail.google.com` を要求しないことで同意画面の威圧感を下げる。※gmail.readonly で `GmailApp.search` が動くかは実装最初期に実測（Step 2） |
| 設定の正本 | シートのセル（**named range経由で読む**）。処理済み状態はScriptProperties | 行挿入・並べ替えに強い。コピー時にPropertiesは引き継がれない = 新ユーザーはクリーン状態で開始（好都合） |
| コード統合 | 2ツールで重複していた `cleanHtml_` / 画像埋め込み / escape系を `html.gs` に一本化 | synergies.md「Kindle送信ファミリー共通エンジン化」の実現 |

## 1. スプレッドシート構造（1タブのみ）

説明書なしで使えることを最優先し、**「Kindle Life」1タブに全部まとめる**。ユーザーが触るのは赤枠（赤ラベル+赤枠線）の3箇所だけ:

- **赤枠① `KINDLE_EMAIL`**（B9・`@kindle\.com$`検証）
- **赤枠② `NEWSLETTER_LIST`**（B13:B42・`ISEMAIL`検証。書いた行が有効、解除はセルを空に）
- **赤枠③ `BLOG_LIST`**（D13:D42・`^https?://`検証。トップページURLでOK＝フィード自動検出。右隣のE列にスクリプトがブログ名/エラーを自動表示）

上部に使いかた2行（赤枠に書く→メニューからセットアップ→Amazonで承認）と「確認されていないアプリ」突破手順を記載。

**持たないもの（シンプルさ優先で固定値化）**: 配信タイミングの選択（毎時チェック・届き次第配信で固定）・一時停止・ステータス表示・送信ログタブ（ログはStackdriverの実行ログのみ。異常はエラーメール通知でユーザーに届く）。

保護: シート全体を警告付き保護し、入力3エリアを `setUnprotectedRanges` で除外（赤枠内は警告なしで編集できる）。所有者はユーザー自身なので完全ロックは不可能 → 警告付きで十分。

## 2. GASファイル構成（コンテナバインド、依存ゼロ）

```
src/
├── appsscript.json   # timeZone / V8 / oauthScopes明示
├── main.gs           # hourlyTick(), runDeliveryNow()
├── config.gs         # named range読み書き・検証。SCRIPT_VERSION定数
├── gmail.gs          # 検索クエリ組立・収集・メール→クリーンHTML（cleanEmailHtml_移植）
├── rss.gs            # RSS2.0 + Atomパース、記事全文fetch（<article>優先抽出）
├── html.gs           # 共通エンジン: 白リストクリーナー・escape・相対URL絶対化
├── digest.gs         # 1記事HTML組立: 出典行・画像埋め込み予算・時間/サイズガード
├── mail.gs           # Kindle宛送信（MailApp+添付）、エラー通知（1日1通制限）
├── state.gs          # ScriptProperties: 処理済みID / フィード別GUID / lastRun / 通知済み版数
├── triggers.gs       # 毎時トリガー設置/撤去、初期セットアップフロー
├── ui.gs             # カスタムメニュー・ダイアログ・診断
└── update.gs         # GitHub raw version.json照会・新版通知
```

## 3. 中核ロジック

### hourlyTick（トリガー設計の核心）
```
1. 新着収集（メルマガ+ブログ。新着ゼロなら数百msで抜ける）
2. 1件ずつ: HTML化 → 送信 → 成功後にのみ処理済みを記録
   （1実行の送信上限 MAX_SENDS_PER_RUN=10。残りは次の毎時実行へ持ち越し）
3. Gmail検索窓の起点（lastSuccessTs）は全件送り切れた実行でのみ前進
   （失敗・持ち越しがある間は窓を進めず、取りこぼしを防ぐ）
4. 1日1回だけ新版チェック
```
トリガー作成は初期セットアップの1回だけ（既存同名ハンドラ全削除→再作成、何度実行しても安全）。

### Gmail収集
- `from:("a@x.com" OR ...) newer_than:2d` の1クエリ + スレッド内の無関係メール除外 + 処理済みID照合
- 検索窓は「前回の全件処理成功〜現在」（上限72h）。失敗した回があっても後続の毎時実行で拾われ取りこぼさない
- newsletter版の `cleanEmailHtml_` を**そのまま移植**（Substack不可視文字除去・CDN URL復元・トラッキングピクセル除去は実戦で獲得した資産。削らない）

### RSS/Atom収集
- RSS 2.0は既存ロジック。Atomはルート要素 `feed` → `<entry>`、`link[rel=alternate]` の`href`、namespaceは `getRootElement().getNamespace()` 経由で取得
- **フィード別GUID管理**（既存のグローバル1マップから変更）: `{feedUrl: {guid: ts}}` → 後からフィード追加してもそのフィードだけ「初回は記録のみ」になり過去記事の一斉配信を防ぐ
- 1フィードあたり新着上限5本/実行（暴走対策）。フィードエラーはURL右隣のセルに書いてスキップ（実行全体は止めない）

### 1記事HTML（個別配信）
- 構造: `<h1>`記事タイトル + 出典行（配信元・日時・元記事リンク）+ クリーン済み本文の自己完結HTML。添付ファイル名 = 記事タイトル（= Kindleライブラリの書名）
- **クリーンアップは記事単位で収集時に実行**し、タイトル・出典行は組立段階で後付け（白リストクリーナーが属性を落とすため、この順序が必須）
- 画像予算は1冊ごとにリセット: 30枚/合計20MB/1枚5MB（メール1通25MBに対する安全枠）
- **時間ウォッチドッグ**: 開始4.5分超過で以降の画像埋め込み・全文fetchを打ち切り（6分制限で途中死しメール自体が飛ばないのが最悪。劣化送信を優先）。未処理の記事は次の毎時実行で送られる

## 4. セットアップフロー・UX

メニュー（onOpenシンプルトリガー、認証不要で表示）:
`① 初期セットアップ / ✉️ 今すぐ送信 / 🧪 テスト送信 / 🩺 診断 / ❓ ヘルプ`

初期セットアップ: 認証発動 → 設定検証（不備は日本語ダイアログ）→ RSS初期記録（配信しない）+ lastRun初期化 → トリガー設置 → STATUS更新・完了ダイアログ。

- 「確認されていないアプリ」警告: ユーザー自身が所有者なので審査不要で通過可能。ガイドにスクショ付き手順（最大離脱ポイント）
- エラー時: `Session.getEffectiveUser().getEmail()` 宛に平易な日本語メール（技術詳細は末尾）、1日1通まで
- 診断: 設定検証・トリガー有無・直近ログ・フィード疎通・Gmail検索ヒット数を1画面表示

## 5. 配布とアップデート

- テンプレシートを「リンクを知っている全員: 閲覧者」で共有し、URL末尾 `/copy` で配布（バインドGASごと複製される）
- 引き継がれる: シート内容・検証・保護・named range・スクリプト。引き継がれない: トリガー・Properties・認証（→初期セットアップが必須の根拠）
- テンプレに個人情報ゼロ（conventions.md 伏字化方針）
- バージョン: `SCRIPT_VERSION` vs GitHub raw `version.json`。1日1回照会、新版はログ+同一版数1回だけの通知メール
- コピー配布はin-place更新不可 → 通知は破壊的/重要修正のみ。移行手順: 新テンプレをコピー→登録タブをコピペ→旧シートは「このシートを停止」メニュー

## 6. リポジトリ構成

```
kindle-life-app/
├── README.md / SPEC.md / DESIGN.md / CLAUDE.md / LICENSE(MIT) / version.json
├── src/                   # clasp管理（前述12ファイル）
├── .clasp.json.example    # 実物は.gitignore
├── docs/
│   ├── setup-guide-ja.md / setup-guide-en.md   # 警告画面スクショ含む
│   └── template-checklist.md  # シート構造の正本（タブ・named range・検証・保護の再現手順）
└── site/                  # 任意。まずは mblog.com 記事で代替
```

シート構造はコード管理できないため `template-checklist.md` が正本。v1.1候補: named range・検証をスクリプトから再構築する開発者用 `rebuildSheetStructure_()`。

## 7. 実装ステップ

※v0.1（合本ダイジェスト）時点の実装記録。v0.2で個別配信に転換済み（§0参照）。

| Step | 成果物 | 検証 |
|---|---|---|
| 0 | SPEC/DESIGN（本書） | 確定済み |
| 1 | リポジトリ雛形 + clasp接続 + 開発用シート手作業構築（checklistに記録） | `clasp push` が通りメニューが出る |
| 2 | config.gs + ui.gs骨格。**gmail.readonlyでGmailApp.searchが動くか実測** | 診断で設定値が読める/不備が日本語で出る |
| 3 (MVP) | html.gs + gmail.gs + digest.gs + mail.gs → メルマガのみのダイジェストを自分のKindleへ | 実機でSubstack含む3通合本の表示・目次リンク・画像を確認 |
| 4 | rss.gs統合（RSS2.0+Atom、フィード別GUID） | 新着検知→合本掲載。フィード追加で過去記事が流れない |
| 5 | triggers.gs + state.gs（毎時ゲート・窓・ログ・セットアップ一気通貫） | 実トリガーで2日間放置、指定時間帯に1回だけ届く |
| 6 | エラー処理仕上げ（通知・ウォッチドッグ・サイズガード）+ update.gs | 疑似障害で劣化送信と通知が機能。版数上げで通知が1回だけ |
| 7 | 別アカウントで/copy導入テスト → ガイド執筆 → GitHub公開 + mblog.com記事 | **非開発アカウントがガイドだけで10分以内にセットアップ完了** |

Step 3完了時点で自分用に既存2ツールを置き換え、ドッグフーディング開始。

## 8. リスクと手当

- **1実行6分制限** → 時間ウォッチドッグ（Step 6）
- **警告画面での離脱** → スクショ付きガイド + スコープ最小化（Step 7）
- **gmail.readonlyの動作未確認** → Step 2冒頭で実測。ダメなら `mail.google.com` にフォールバックしガイドで説明
- **1通25MB超** → 1冊ごとの画像予算（30枚/20MB）で間引き（Step 3）

## 移植元（Critical Files）

- `~/Documents/auto-send-newsletter-to-kindle/src/Code.gs` — cleanEmailHtml_・画像埋め込み・処理済みID管理
- `~/Documents/auto-send-blog-to-kindle/src/Code.gs` — RSS巡回・全文取得・初回記録ガード
- `~/Documents/Send-to-Kindle-for-Google-Chrome/src/background.js:556` — v2 EPUB化時のSTORE専用ZIPライター
- `~/Documents/portfolio-brain/conventions.md` — 依存最小・伏字化・配布方針
