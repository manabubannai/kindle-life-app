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
  const saved = ['KINDLE_EMAIL', 'NEWSLETTER_LIST', 'BLOG_LIST'].map(function (name) {
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
  sheet.setColumnWidth(2, 360);  // B: メルマガ入力 / 見出し
  sheet.setColumnWidth(3, 24);   // C: 余白
  sheet.setColumnWidth(4, 360);  // D: ブログ入力
  sheet.setColumnWidth(5, 320);  // E: ブログ状態（自動）

  // ── 見出しと使いかた ──
  sheet.getRange('B2').setValue('Kindle Life').setFontSize(20).setFontWeight('bold');
  sheet.getRange('B3').setValue(SHEET_TAGLINE).setFontSize(11);
  sheet.getRange('B5')
    .setValue('使いかた: 下の赤い①〜③を埋める → 上のメニュー「Kindle Life」→「① 初期セットアップ」→ Googleの画面で「詳細」→「移動」→「許可」')
    .setFontSize(11).setFontWeight('bold');
  sheet.getRange('B6')
    .setValue('最後にAmazonの「コンテンツと端末の管理」→「設定」→「承認済みEメールアドレス」にあなたのGmailアドレスを追加して、メニューの「🧪 テスト送信」で確認。')
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

  // ── ② メルマガ（B列） / ③ ブログ（D列） ──
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
  sheet.getRange('B12').setNote(
    'Gmailでそのメルマガを開き、差出人名の横に表示されるアドレスをコピーして貼り付けます。\n' +
    'やめたいときはセルを空にするだけです。'
  );

  sheet.getRange('D12')
    .setValue('③ 読みたいブログのURL（1行に1つ）')
    .setFontWeight('bold').setFontColor(INPUT_COLOR_);
  const blogList = sheet.getRange(LIST_TOP, 4, LIST_ROWS, 1);
  ss.setNamedRange('BLOG_LIST', blogList);
  blogList
    .setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireFormulaSatisfied('=OR(ISBLANK(D13),REGEXMATCH(TO_TEXT(D13),"^https?://"))')
        .setAllowInvalid(true)
        .setHelpText('https:// で始まるブログのURLを入力してください')
        .build()
    );
  sheet.getRange('D12').setNote(
    'ブログのトップページのURLでOK（フィードの場所は自動で見つけ、ブログ名が右に表示されます）。\n' +
    'やめたいときはセルを空にするだけです。'
  );

  // ブログ状態（スクリプトが書く表示専用。説明書きは置かない — 自動で表示されれば分かる）
  sheet.getRange(LIST_TOP, 5, LIST_ROWS, 1).setFontSize(9).setFontColor('#666666');

  // ── 保護: 入力エリア以外は警告付き保護 ──
  const protection = sheet.protect().setWarningOnly(true);
  protection.setUnprotectedRanges([emailCell, newsletterList, blogList]);
}
