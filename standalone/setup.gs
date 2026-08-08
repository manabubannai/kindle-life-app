/**
 * Kindle Life（スタンドアロン版）— セットアップ・テスト・診断
 *
 * シート版の ui.gs（メニューとダイアログ）の代替。
 * すべてエディタ（または clasp run）から直接実行し、結果は
 * 戻り値と実行ログで確認する。
 */

/**
 * 初期セットアップ。何度実行しても安全（トリガーは作り直し、
 * 登録済みフィードの記録は上書きしない）。
 */
function initialSetup() {
  const config = readConfig_();
  if (config.issues.length > 0) {
    throw new Error('設定に不備があります。\n・' + config.issues.join('\n・'));
  }

  // フィードの初期登録（既存記事は記録のみ。過去記事の一斉配信を防ぐ）
  const state = loadState_();
  const feedErrors = [];
  config.blogs.forEach(function (blog) {
    if (!isNewFeed_(state, blog.feed)) return;
    try {
      const feed = fetchFeed_(resolveFeedUrl_(blog.feed));
      const known = {};
      feed.items.forEach(function (item) { known[item.guid] = Date.now(); });
      state.feedGuids[blog.feed] = known;
      writeBlogStatus_(blog.row, '登録完了: ' + (feed.title || '(名称不明)') + '（次の新着から届きます）');
    } catch (e) {
      feedErrors.push(blog.feed + ' — ' + String((e && e.message) || e));
      writeBlogStatus_(blog.row, 'エラー: ' + String((e && e.message) || e).slice(0, 100));
    }
  });

  // Gmail側の窓を「今」から始める（過去メールの一斉配信を防ぐ）
  state.lastSuccessTs = Date.now();
  saveState_(state);

  ensureHourlyTrigger_();

  const summary =
    'セットアップ完了: メルマガ' + config.newsletters.length + '件・ブログ' + config.blogs.length + '件で開始' +
    (feedErrors.length > 0 ? '\n⚠️ 登録できなかったブログ:\n' + feedErrors.join('\n') : '');
  appendLog_('セットアップ', summary, '');
  return summary;
}

/**
 * テスト送信: 固定のサンプル記事1件をKindleへ送る。
 * Kindleアドレスの正しさとAmazonの承認済みリスト設定を確認するためのもの。
 */
function sendTestItem() {
  const kindleEmail = String(USER_CONFIG.kindleEmail || '').trim();
  if (!/@kindle\.com$/i.test(kindleEmail)) {
    throw new Error('USER_CONFIG.kindleEmail に @kindle.com アドレスを設定してください。');
  }

  const sample = {
    kind: 'newsletter',
    title: 'テスト送信: Kindle Lifeへようこそ（' + formatDateLabel_(new Date()) + '）',
    source: 'Kindle Life',
    dateStr: '',
    html:
      '<p>これはテスト送信です。この記事がKindleで読めていれば、設定はすべて正しく完了しています。</p>' +
      '<p>これからは、登録したメルマガとブログの新着が、' + deliveryLabel_() + 'にこの形で1件ずつ届きます。</p>' +
      '<p>Kindleライブラリでの書名は、メルマガの件名・記事のタイトルがそのまま使われます。</p>',
  };
  const budget = { count: 0, bytes: 0, deadline: Date.now() + EXECUTION_BUDGET_MS };

  const html = buildItemHtml_(sample, budget);
  sendItemMail_(kindleEmail, sample, html);
  appendLog_('テスト送信', kindleEmail + ' へサンプルを送信', '');
  return 'テストを送信しました。数分〜十数分でKindleのライブラリに届きます。\n' +
    '届かない場合は、Amazonの「承認済みEメールアドレス」に ' +
    Session.getEffectiveUser().getEmail() + ' が登録されているか確認してください。';
}

/** 診断: 設定・トリガー・Gmail検索・フィード疎通をまとめて確認する。 */
function runDiagnostics() {
  const lines = [];

  lines.push('■ バージョン: v' + SCRIPT_VERSION + '（スタンドアロン版）');

  const config = readConfig_();
  if (config.issues.length > 0) {
    lines.push('■ 設定: ⚠️ 不備があります');
    config.issues.forEach(function (issue) { lines.push('  ・' + issue); });
  } else {
    lines.push('■ 設定: OK（送信先 ' + config.kindleEmail + ' / ' + deliveryLabel_() + '）');
  }

  lines.push('■ 自動実行トリガー: ' + (hasHourlyTrigger_() ? 'OK（設定済み）' : '⚠️ 未設定 → initialSetup を実行してください'));

  const state = loadState_();
  lines.push('■ 最終確認: ' + (state.lastSuccessTs ? Utilities.formatDate(new Date(state.lastSuccessTs), timeZone_(), 'M/d HH:mm') : 'まだ実行されていません'));

  const digestTitleSet = {};
  config.newsletters.forEach(function (n) { if (n.digestTitle) digestTitleSet[n.digestTitle] = true; });
  Object.keys(state.weeklyPending || {}).forEach(function (t) {
    if (state.weeklyPending[t].length > 0) digestTitleSet[t] = true;
  });
  Object.keys(digestTitleSet).forEach(function (title) {
    const count = (state.weeklyPending[title] || []).length;
    lines.push('■ 週1まとめ「' + title + '」: 貯まっている記事 ' + count + '本');
  });

  if (config.newsletters.length > 0) {
    try {
      const threads = GmailApp.search(buildSearchQuery_(config.newsletters, 2), 0, 20);
      lines.push('■ メルマガ検索: OK（直近2日で' + threads.length + 'スレッドがヒット）');
    } catch (e) {
      lines.push('■ メルマガ検索: ⚠️ エラー — ' + String((e && e.message) || e));
    }
  } else {
    lines.push('■ メルマガ検索: 登録なし');
  }

  config.blogs.forEach(function (blog) {
    try {
      const feedUrl = resolveFeedUrl_(blog.feed);
      const feed = fetchFeed_(feedUrl);
      const detected = feedUrl === blog.feed ? '' : '・フィード自動検出: ' + feedUrl;
      lines.push('■ ブログ ' + (feed.title || blog.feed) + ': OK（' + feed.items.length + '記事' + detected + '）');
    } catch (e) {
      lines.push('■ ブログ ' + blog.feed + ': ⚠️ ' + String((e && e.message) || e));
    }
  });

  const report = lines.join('\n');
  console.log(report);
  return report;
}

/** 自動実行を完全に止める（再開は initialSetup）。 */
function stopAll() {
  deleteOwnTriggers_();
  appendLog_('停止', 'トリガーを削除しました', '');
  return '自動送信を停止しました。再開するには initialSetup を実行してください。';
}
