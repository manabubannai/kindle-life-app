/**
 * Kindle Life — エントリポイント
 *
 * トリガー設計: 毎時トリガー + 設定時刻ゲート方式。
 * 1時間ごとに hourlyTick が起き、配信時刻前・送信済みの日は数百msで抜ける。
 * atHourトリガーの張り替えが不要になるため、ユーザーが配信時刻セルを
 * 変えても次の毎時実行から自動反映される（反映ボタン等は不要）。
 * ゲートを「設定時刻以降」にすることで、一時的な障害があっても
 * その日のうちの後続実行で自動リトライされる。
 */

/** 毎時トリガーから呼ばれる。 */
function hourlyTick() {
  try {
    const tz = timeZone_();
    const now = new Date();
    const hour = Number(Utilities.formatDate(now, tz, 'H'));
    const today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

    if (hour < DIGEST_HOUR) return; // 配信時刻前
    if (getStateValue_('lastRunDate') === today) return; // 今日は処理済み

    runDigest_();
    setStateValue_('lastRunDate', today);
    checkForUpdate_(); // 1日1回だけ動く場所に置く
  } catch (e) {
    notifyError_(e);
  }
}

/** メニュー「今すぐダイジェストを送信」。 */
function runDigestNow() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = runDigest_();
    setStateValue_('lastRunDate', Utilities.formatDate(new Date(), timeZone_(), 'yyyy-MM-dd'));
    if (result.sent) {
      ui.alert(
        '送信しました',
        'メルマガ' + result.newsletters + '通・ブログ記事' + result.posts + '本を1冊にまとめてKindleへ送りました。\n' +
          '数分〜十数分でKindleのライブラリに届きます。',
        ui.ButtonSet.OK
      );
    } else {
      ui.alert(
        '新着はありませんでした',
        '前回の送信以降、登録中のメルマガ・ブログに新着がないため送信をスキップしました。',
        ui.ButtonSet.OK
      );
    }
  } catch (e) {
    ui.alert('送信できませんでした', String((e && e.message) || e), ui.ButtonSet.OK);
    appendLog_('エラー', String((e && e.message) || e), String((e && e.stack) || ''));
  }
}

/**
 * ダイジェスト処理の本体。
 * 収集 → 合本 → 送信 → 送信成功後にのみ処理済みを記録、の順序が重要。
 * 送信に失敗した場合は何も記録されず、翌回の実行で同じ内容が再試行される。
 */
function runDigest_() {
  const config = readConfig_();
  if (config.issues.length > 0) {
    throw new Error('設定に不備があります。\n・' + config.issues.join('\n・'));
  }

  const budget = { count: 0, bytes: 0, deadline: Date.now() + EXECUTION_BUDGET_MS };
  const state = loadState_();
  const now = new Date();
  const dateLabel = formatDateLabel_(now);

  const newsletters = collectNewsletters_(config, state, budget);
  const posts = collectBlogPosts_(config, state, budget);
  const total = newsletters.length + posts.length;

  if (total === 0) {
    // 新着なし: フィード初回登録の記録だけ保存してスキップ
    state.lastSuccessTs = now.getTime();
    saveState_(state);
    appendLog_('スキップ', '新着なし', '');
    return { sent: false, newsletters: 0, posts: 0 };
  }

  const notice = buildUpdateNotice_();
  const html = buildDigestHtml_(newsletters, posts, dateLabel, budget, notice);
  sendDigestMail_(config.kindleEmail, html, dateLabel);

  // ここから下は送信成功後のみ実行される
  newsletters.forEach(function (n) {
    state.processedIds[n.id] = Date.now();
  });
  posts.forEach(function (p) {
    if (!state.feedGuids[p.feedUrl]) state.feedGuids[p.feedUrl] = {};
    state.feedGuids[p.feedUrl][p.guid] = Date.now();
  });
  state.lastSuccessTs = now.getTime();
  saveState_(state);

  const summary = 'メルマガ' + newsletters.length + '通＋ブログ記事' + posts.length + '本';
  appendLog_('送信', dateLabel + ' ' + summary, '画像' + budget.count + '枚を埋め込み');

  return { sent: true, newsletters: newsletters.length, posts: posts.length };
}
