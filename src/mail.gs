/**
 * Kindle Life — メール送信
 *
 * Kindle宛の送信もエラー通知も MailApp を使う（script.send_mail スコープ）。
 * Send to Kindleはメール本文を変換しないため、本文はHTMLファイル添付で送る。
 * 記事タイトルを添付ファイル名にすることで、Kindleライブラリ上の
 * 書名がそのまま記事タイトルになる（既存2ツールで実証済みの型）。
 */

/** 記事1件のHTMLを添付してKindleアドレスへ送信する。1件 = 1冊。 */
function sendItemMail_(kindleEmail, item, html) {
  const filename = sanitizeFilename_(item.title) + '.html';
  const blob = Utilities.newBlob('', 'text/html', filename).setDataFromString(html, 'UTF-8');
  MailApp.sendEmail(kindleEmail, item.title, 'Sent by Kindle Life', {
    attachments: [blob],
    name: 'Kindle Life',
  });
}

/**
 * 実行失敗をユーザー本人（=スクリプトの所有者）へ平易な日本語で通知する。
 * 通知メールは1日1通まで。詳細は実行ログにも残す。
 */
function notifyError_(e) {
  try {
    console.error(e && e.stack ? e.stack : e);
    appendLog_('エラー', String((e && e.message) || e), String((e && e.stack) || ''));

    const today = Utilities.formatDate(new Date(), timeZone_(), 'yyyy-MM-dd');
    if (getStateValue_('lastErrorMailDate') === today) return;
    setStateValue_('lastErrorMailDate', today);

    const me = Session.getEffectiveUser().getEmail();
    if (!me) return;
    MailApp.sendEmail(
      me,
      '【Kindle Life】新着をKindleへ送れませんでした',
      'Kindle Life が新着の送信でエラーになりました。\n\n' +
        '対処のしかた:\n' +
        '1. スプレッドシートを開き、メニュー「Kindle Life」→「🩺 診断」を実行してください\n' +
        '2. シートの赤枠①（Kindleアドレス）②（メルマガ差出人）③（ブログURL）の内容を確認してください\n' +
        '3. 直らない場合は、このメール末尾の技術的な詳細を添えて問い合わせてください\n\n' +
        'なお、未送信の新着は消えません。原因が直れば1時間ごとの自動実行で順に届きます。\n\n' +
        '--- 技術的な詳細 ---\n' +
        String((e && e.stack) || e),
      { name: 'Kindle Life' }
    );
  } catch (e2) {
    console.error('エラー通知の送信にも失敗: ' + e2);
  }
}
