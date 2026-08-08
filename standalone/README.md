# Kindle Life スタンドアロン版（スプレッドシートなし）

Google Apps Script だけで完結する構成。シートUIを使わず、設定は `config.gs` の
`USER_CONFIG` に直接書く。エージェント（Claude Code等）に丸ごと任せる配布形態向け。

## 構成

- エンジン部（`../src/` からそのままコピー）:
  `main.gs` `gmail.gs` `rss.gs` `html.gs` `digest.gs` `mail.gs` `state.gs` `triggers.gs` `update.gs`
- このディレクトリ:
  - `config.example.gs` — 設定層。`config.gs` にリネームし `USER_CONFIG` を埋める
    （シート版 `src/config.gs` の named range 読み取りを定数に差し替えたもの）
  - `setup.gs` — `initialSetup` / `sendTestItem` / `runDiagnostics` / `stopAll`
    （シート版 `src/ui.gs` のメニュー・ダイアログをコンソール版にしたもの）
  - `appsscript.json` — spreadsheets / forms スコープを外したマニフェスト
- 使わないもの: `src/ui.gs` `src/dev.gs` `src/bridge.gs`（すべてシート前提の層）

## 組み立て手順（エージェント向け）

```sh
mkdir kindle-life-deploy && cd kindle-life-deploy
cp ../src/{main,gmail,rss,html,digest,mail,state,triggers,update}.gs .
cp ../standalone/setup.gs .
cp ../standalone/appsscript.json .
cp ../standalone/config.example.gs config.gs   # USER_CONFIG をユーザーの値で埋める
clasp create --type standalone --title "Kindle Life"
# ↑ clasp create が appsscript.json を上書きするので standalone/ 版で戻すこと
cp ../standalone/appsscript.json .
clasp push -f
```

その後:

1. スクリプトエディタで `initialSetup` を実行（初回はGoogleの許可画面。
   「詳細」→「Kindle Life（安全ではないページ）に移動」→ チェックを全部オン →「続行」）
2. Amazonの「コンテンツと端末の管理」→「設定」→「承認済みEメールアドレス」に
   実行アカウントのGmailアドレスを追加
3. `sendTestItem` を実行してKindleに届けば完了。以後は毎時トリガーが自動配信
4. つまずいたら `runDiagnostics` の実行ログを見る

## 既知の制約

- bearblog.dev など、GoogleのデータセンターIPをブロックするブログはGASから
  取得できない（User-Agent偽装でも回避不可。IPレンジでのブロックのため）
