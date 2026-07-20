/**
 * Kindle Life — メール送信
 *
 * Kindle宛の送信もエラー通知も MailApp を使う（script.send_mail スコープ）。
 * Send to Kindleはメール本文を変換しないため、本文はHTMLファイル添付で送る。
 * ZIP同梱方式は、Amazonが中の各ファイルを別々のドキュメントとして
 * 変換してしまうため使えない（既存ツールで実証済み）。
 */

/** 合本HTMLを添付してKindleアドレスへ送信する。 */
function sendDigestMail_(kindleEmail, html, dateLabel) {
  const filename = sanitizeFilename_('Kindle Life ' + dateLabel) + '.html';
  const blob = Utilities.newBlob('', 'text/html', filename).setDataFromString(html, 'UTF-8');
  MailApp.sendEmail(kindleEmail, 'Kindle Life ' + dateLabel, 'Sent by Kindle Life', {
    attachments: [blob],
    name: 'Kindle Life',
  });
}

/**
 * 実行失敗をユーザー本人（=スクリプトの所有者）へ平易な日本語で通知する。
 * 通知メールは1日1通まで。詳細は送信ログタブにも残す。
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
      '【Kindle Life】今朝のダイジェストを送れませんでした',
      'Kindle Life が今日のダイジェスト送信でエラーになりました。\n\n' +
        '対処のしかた:\n' +
        '1. スプレッドシートを開き、メニュー「Kindle Life」→「🩺 診断」を実行してください\n' +
        '2. 「⚙️ 設定」タブのKindleメールアドレスと、「📧 メルマガ」「📰 ブログ」タブの登録内容を確認してください\n' +
        '3. 直らない場合は「📜 送信ログ」タブのエラー内容を添えて問い合わせてください\n\n' +
        'なお、今日の新着分は消えません。原因が直れば明日のダイジェストにまとめて入ります。\n\n' +
        '--- 技術的な詳細 ---\n' +
        String((e && e.stack) || e),
      { name: 'Kindle Life' }
    );
  } catch (e2) {
    console.error('エラー通知の送信にも失敗: ' + e2);
  }
}
