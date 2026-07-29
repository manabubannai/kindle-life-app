# Kindle Life

メルマガ+ブログの新着を届いた順に1件ずつKindleへ送るGASツール（1記事 = 1冊）。非エンジニア向けに「スプレッドシートをコピーするだけ」で配布する。

## 読む順序
1. `SPEC.md` — 要件・なぜホスティング型でなくシートコピー方式か・クォータ検算
2. `DESIGN.md` — 設計判断・シート/GAS構成（現在: v0.2.0 個別配信で稼働中・GitHub公開済み）

## 鉄則
- **依存ゼロの素のGAS**（ライブラリ・ビルド不使用。開発ツールとしてのclaspのみ可）
- 既存2ツールの実戦済みロジックを移植する（車輪を再発明しない）:
  - `~/Documents/auto-send-newsletter-to-kindle/src/Code.gs` — cleanEmailHtml_・画像base64埋め込み・処理済みID管理
  - `~/Documents/auto-send-blog-to-kindle/src/Code.gs` — RSS巡回・全文取得・初回記録ガード
- 個人情報（Kindleアドレス・購読メルマガ）をコード/テンプレシートに含めない（公開リポジトリ）
- 設定の読み取りは必ずnamed range経由。シート構造の正本は `docs/template-checklist.md`

## ポートフォリオ連携
大きな変更（設計変更・公開状況の変化）をしたら `~/Documents/portfolio-brain/apps/kindle-life.md` を更新すること。関連: 同ディレクトリの `conventions.md`（技術方針）・`synergies.md`（送信ファミリー統合構想 = 本プロジェクトの出自）。
