# 配布用テンプレートの作成・リリース手順（開発者用）

シート構造（タブ・named range・入力規則・保護）は `src/dev.gs` の `DEV_buildTemplate()` が正本。
手作業でシートを組む必要はない。

## 初回セットアップ（開発環境）

1. Googleドライブで新規スプレッドシートを作成（名前: `Kindle Life`）
2. 拡張機能 → Apps Script でバインドプロジェクトを開き、プロジェクト名を `Kindle Life` に
3. プロジェクトの設定 → スクリプトID をコピーし、リポジトリ直下に `.clasp.json` を作成
   （`.clasp.json.example` をコピーして scriptId を差し替え）
4. `npx clasp login`（初回のみ）→ `npx clasp push`
5. Apps Scriptエディタで `DEV_buildTemplate` を実行（初回は認証あり）
   → 5タブ・named range・入力規則・保護がすべて構築される

## コード更新の反映

```sh
npx clasp push          # src/ をバインドプロジェクトへ
```

シート構造を変えたときは `DEV_buildTemplate()` を再実行（⚠️ タブ内容はリセットされる）。

## リリース前チェックリスト

- [ ] `src/config.gs` の `SCRIPT_VERSION` と `version.json` の `version` が一致している
- [ ] `UPDATE_URL` / `GUIDE_URL` が実リポジトリのURLになっている
- [ ] テンプレシートに個人情報が入っていない（Kindleアドレス欄が空、メルマガ/ブログタブが空、送信ログが空）
- [ ] ScriptPropertiesは配布時に引き継がれないので気にしなくてよい（トリガー・認証も同様）
- [ ] 別Googleアカウントで `/copy` リンクから導入し、ガイドだけを見て10分以内にセットアップ完了できる
- [ ] テスト送信・今すぐ送信・診断・停止の各メニューが新規コピーで動く

## 配布リンクの作り方

1. テンプレシートを「リンクを知っている全員: **閲覧者**」で共有
2. URLの末尾 `/edit...` を `/copy` に差し替えたものが配布リンク
   `https://docs.google.com/spreadsheets/d/<ID>/copy`
   （開くと「コピーを作成」ボタンだけの画面になり、バインドされたGASごと複製される）
3. `version.json` の `copyUrl` にこのリンクを記入してコミット

## 検証メモ（要実測の項目）

- [x] `gmail.readonly` スコープで `GmailApp.search` が動く（2026-07-20 実測OK: 診断で「直近2日で5スレッドがヒット」）
- [x] テスト送信がKindleに届く（2026-07-20 実機確認OK。送信元=自分のGmailアドレス を承認済みリストに登録して成功）
- [ ] 本番ダイジェスト（実メルマガ+ブログ新着）の合本表示・目次リンク・画像・改ページを実Kindleで確認
- [ ] 毎時トリガーを2日間放置し、指定時間帯に1回だけ届くこと・新着ゼロの日はスキップされることを確認
