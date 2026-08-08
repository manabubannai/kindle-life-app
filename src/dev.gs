/**
 * Kindle Life — テンプレートシート構築（開発者用）
 *
 * 配布用テンプレートのシート構造をコードから再構築する。
 * UIは1タブのみ: 説明文＋赤枠の入力エリア3つ（説明書なしで使えることを狙う）。
 * これによりシート構造もgit管理下のコードが正本になる。
 *
 * 入力済みの①②③は退避してから再構築後に書き戻すため、
 * 稼働中のシートで再実行しても設定は消えない（説明文の更新などに使える）。
 */

// 入力エリアの赤（ラベル文字のみ。セルの枠線・背景はコピペで消えるため使わない）
const INPUT_COLOR_ = '#cc0000';

function DEV_buildTemplate() {
  const ss = ss_();

  // 既存の入力（①②③）を退避
  const saved = ['KINDLE_EMAIL', 'NEWSLETTER_LIST', 'NEWSLETTER_DIGEST_TITLES', 'BLOG_LIST'].map(function (name) {
    const range = ss.getRangeByName(name);
    return { name: name, values: range ? range.getValues() : null };
  });

  buildMainSheet_(ss);

  // 退避した入力を書き戻す
  saved.forEach(function (s) {
    if (!s.values) return;
    const range = ss.getRangeByName(s.name);
    if (!range) return;
    const rows = Math.min(s.values.length, range.getNumRows());
    range.offset(0, 0, rows, 1).setValues(s.values.slice(0, rows));
  });

  // 旧構成のタブ・既定の空シートが残っていれば削除
  ['👋 使い方', '⚙️ 設定', '📧 メルマガ', '📰 ブログ', '📜 送信ログ', 'シート1', 'Sheet1'].forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (sheet && ss.getSheets().length > 1) ss.deleteSheet(sheet);
  });

  ss.setActiveSheet(ss.getSheetByName(SHEET_MAIN));
  console.log('テンプレート構築完了 v' + SCRIPT_VERSION);
}

function buildMainSheet_(ss) {
  let sheet = ss.getSheetByName(SHEET_MAIN);
  if (!sheet) sheet = ss.insertSheet(SHEET_MAIN, 0);
  sheet.clear();
  sheet.getDataRange().clearDataValidations();
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) { p.remove(); });
  sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
  sheet.setHiddenGridlines(true);

  sheet.setColumnWidth(1, 24);   // A: 余白
  sheet.setColumnWidth(2, 330);  // B: メルマガ入力 / 見出し
  sheet.setColumnWidth(3, 180);  // C: 週1まとめタイトル（任意）
  sheet.setColumnWidth(4, 24);   // D: 余白
  sheet.setColumnWidth(5, 360);  // E: ブログ入力
  sheet.setColumnWidth(6, 320);  // F: ブログ状態（自動）

  // ── 見出しと使いかた ──
  sheet.getRange('B2').setValue('Kindle Life').setFontSize(20).setFontWeight('bold');
  sheet.getRange('B3').setValue(SHEET_TAGLINE).setFontSize(11);
  sheet.getRange('B5')
    .setValue(SHEET_HOWTO_1)
    .setFontSize(11).setFontWeight('bold');
  sheet.getRange('B6')
    .setValue(SHEET_HOWTO_2)
    .setFontSize(11);

  // ── ① Kindleメールアドレス ──
  sheet.getRange('B8')
    .setValue('① あなたのKindleメールアドレス（○○○@kindle.com）')
    .setFontWeight('bold').setFontColor(INPUT_COLOR_);
  const emailCell = sheet.getRange('B9');
  ss.setNamedRange('KINDLE_EMAIL', emailCell);
  emailCell
    .setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireFormulaSatisfied('=OR(ISBLANK(B9),REGEXMATCH(TO_TEXT(B9),"@kindle\\.com$"))')
        .setAllowInvalid(true)
        .setHelpText('@kindle.com で終わるアドレスを入力してください')
        .build()
    )
    .setNote('Amazonの「コンテンツと端末の管理」→「設定」→「パーソナル・ドキュメント設定」で確認できます。');
  sheet.getRange('B10')
    .setValue('（Amazonの「コンテンツと端末の管理」→「設定」で確認できます）')
    .setFontSize(9).setFontColor('#999999');

  // ── ② メルマガ（B列＋C列の週1まとめ） / ③ ブログ（E列） ──
  const LIST_TOP = 13;
  const LIST_ROWS = 30;

  sheet.getRange('B12')
    .setValue('② 受け取りたいメルマガの差出人アドレス（1行に1つ）')
    .setFontWeight('bold').setFontColor(INPUT_COLOR_);
  const newsletterList = sheet.getRange(LIST_TOP, 2, LIST_ROWS, 1);
  ss.setNamedRange('NEWSLETTER_LIST', newsletterList);
  newsletterList
    .setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireFormulaSatisfied('=OR(ISBLANK(B13),ISEMAIL(B13))')
        .setAllowInvalid(true)
        .setHelpText('メルマガの「差出人」のメールアドレスを貼り付けてください')
        .build()
    );
  sheet.getRange('C12')
    .setValue('週1まとめのタイトル（任意）')
    .setFontWeight('bold').setFontColor('#666666');
  const digestTitles = sheet.getRange(LIST_TOP, 3, LIST_ROWS, 1);
  ss.setNamedRange('NEWSLETTER_DIGEST_TITLES', digestTitles);
  digestTitles.setFontSize(10);
  sheet.getRange('C12').setNote(
    'ここにタイトルを書くと、その差出人のメルマガは1通ずつではなく、毎週月曜の朝にまとめて1冊で届きます。\n' +
    'タイトルはそのままKindleでの書名になります（例:「◯◯メルマガ」→「◯◯メルマガ 7/27〜8/2」）。\n' +
    '空欄なら従来どおり届き次第1件ずつです。'
  );

  sheet.getRange('E12')
    .setValue('③ 読みたいブログのURL（1行に1つ）')
    .setFontWeight('bold').setFontColor(INPUT_COLOR_);
  const blogList = sheet.getRange(LIST_TOP, 5, LIST_ROWS, 1);
  ss.setNamedRange('BLOG_LIST', blogList);
  blogList
    .setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireFormulaSatisfied('=OR(ISBLANK(E13),REGEXMATCH(TO_TEXT(E13),"^https?://"))')
        .setAllowInvalid(true)
        .setHelpText('https:// で始まるブログのURLを入力してください')
        .build()
    );
  // ブログ状態（スクリプトが書く表示専用。説明書きは置かない — 自動で表示されれば分かる）
  sheet.getRange(LIST_TOP, 6, LIST_ROWS, 1).setFontSize(9).setFontColor('#666666');

  // ── 保護: 入力エリア以外は警告付き保護 ──
  const protection = sheet.protect().setWarningOnly(true);
  protection.setUnprotectedRanges([emailCell, newsletterList, digestTitles, blogList]);
}
