/**
 * Kindle Life — 新バージョン通知
 *
 * コピー配布はin-place更新ができないため、GitHubのversion.jsonを
 * 1日1回照会し、新版が出ていたら本人へ知らせる。
 * 通知は同一バージョンにつきメール1回だけ。
 * チェックの失敗（オフライン・URL変更等）は本体動作に影響させず無視する。
 */

/** 毎時実行から呼ばれ、1日1回だけ実際のチェックを行う。 */
function dailyUpdateCheck_() {
  const today = Utilities.formatDate(new Date(), timeZone_(), 'yyyy-MM-dd');
  if (getStateValue_('lastUpdateCheckDate') === today) return;
  setStateValue_('lastUpdateCheckDate', today);
  checkForUpdate_();
}

function checkForUpdate_() {
  try {
    const resp = UrlFetchApp.fetch(UPDATE_URL, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return;
    const info = JSON.parse(resp.getContentText());
    if (!info || !info.version) return;

    if (!isNewerVersion_(info.version, SCRIPT_VERSION)) {
      setStateValue_('availableVersion', '');
      return;
    }

    setStateValue_('availableVersion', info.version);
    if (getStateValue_('lastNotifiedVersion') === info.version) return;
    setStateValue_('lastNotifiedVersion', info.version);

    appendLog_('お知らせ', '新しいバージョン v' + info.version + ' が公開されています', info.notes || '');

    const me = Session.getEffectiveUser().getEmail();
    if (!me) return;
    MailApp.sendEmail(
      me,
      '【Kindle Life】新しいバージョン v' + info.version + ' が公開されました',
      'お使いのKindle Life（v' + SCRIPT_VERSION + '）より新しいバージョンが公開されました。\n\n' +
        (info.notes ? '更新内容: ' + info.notes + '\n\n' : '') +
        '新しいバージョンへの移行手順:\n' +
        '1. 新しいテンプレートをコピー: ' + (info.copyUrl || GUIDE_URL) + '\n' +
        '2. 赤枠①②③の内容を、今のシートからコピー＆貼り付け\n' +
        '3. 新しいシートで「✅ 初回セットアップ」を実行\n' +
        '4. 今のシートでメニュー「⏸ このシートを停止」を実行\n\n' +
        'そのまま使い続けても問題はありません（このお知らせは1回だけ届きます）。',
      { name: 'Kindle Life' }
    );
  } catch (e) {
    // 更新チェックの失敗は無視（本体動作を妨げない）
  }
}

/** semver比較: a が b より新しければ true。 */
function isNewerVersion_(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}
