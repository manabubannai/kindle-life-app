/**
 * Kindle Life — カスタムメニューとユーザー操作
 *
 * onOpenはシンプルトリガーなので認証前でもメニューが出る。
 * メニュー項目を選んだ瞬間にGoogleの認証フローが始まる
 * （＝「① 初期セットアップ」が認証の入り口を兼ねる）。
 */

function onOpen() {
  // メニュー表示だけに専念する（開時の自動整備はメニュー表示を遅らせ・
  // 簡易トリガーの制限で失敗もするため廃止。整備は①初期セットアップ等で実行）
  SpreadsheetApp.getUi()
    .createMenu('Kindle Life')
    .addItem('① 初期セットアップ（最初に1回）', 'initialSetup')
    .addSeparator()
    .addItem('✉️ 今すぐ新着を確認して送信', 'runDeliveryNow')
    .addItem('🧪 テスト送信（設定の確認用）', 'sendTestItem')
    .addItem('🩺 診断', 'runDiagnostics')
    .addSeparator()
    .addItem('📱 Macアプリ連携', 'showBridgeInfo')
    .addSeparator()
    .addItem('⏸ このシートを停止（トリガー削除）', 'stopAll')
    .addItem('❓ ヘルプ', 'showHelp')
    .addToUi();
}

/**
 * 初期セットアップ。何度実行しても安全（トリガーは作り直し、
 * 登録済みフィードの記録は上書きしない）。
 */
function initialSetup() {
  const ui = SpreadsheetApp.getUi();

  ensureLayout_(); // シートの見出し位置に入力欄のnamed rangeを合わせる
  const config = readConfig_();
  if (config.issues.length > 0) {
    ui.alert('先にここを直してください', '・' + config.issues.join('\n\n・'), ui.ButtonSet.OK);
    return;
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

  appendLog_('セットアップ', 'メルマガ' + config.newsletters.length + '件・ブログ' + config.blogs.length + '件で開始', '');

  let message =
    '登録したメルマガとブログがKindleに自動送信されます。１時間に１件ずつのペースです。\n\n' +
    'なおAmazon側で「あなたのGmail」が登録されていないと、送信が弾かれます。設定方法は次のとおり。\n\n' +
    '・手順①：Amazonの「コンテンツと端末の管理 → 設定 → 承認済みEメールアドレス」に、あなたのGmailアドレスを追加してください\n' +
    '・手順②：シート上部のメニューにある「🧪 テスト送信」で、実際に届くか確認しましょう';
  if (feedErrors.length > 0) {
    message += '\n\n⚠️ 一部のブログが登録できませんでした（URLの右横の表示を確認してください）:\n' + feedErrors.join('\n');
  }
  ui.alert('セットアップ完了 🎉', message, ui.ButtonSet.OK);
}

/**
 * テスト送信: 固定のサンプル記事1件をKindleへ送る。
 * Kindleアドレスの正しさとAmazonの承認済みリスト設定を確認するためのもの。
 */
function sendTestItem() {
  const ui = SpreadsheetApp.getUi();
  const kindleEmail = String(namedValue_('KINDLE_EMAIL') || '').trim();
  if (!/@kindle\.com$/i.test(kindleEmail)) {
    ui.alert(
      '先に設定が必要です',
      '①のセルに、あなたの @kindle.com アドレスを入力してください。',
      ui.ButtonSet.OK
    );
    return;
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

  try {
    const html = buildItemHtml_(sample, budget);
    sendItemMail_(kindleEmail, sample, html);
    appendLog_('テスト送信', kindleEmail + ' へサンプルを送信', '');
    ui.alert(
      'テストを送信しました',
      '数分〜十数分でKindleのライブラリに「テスト送信: Kindle Lifeへようこそ」が届きます。\n\n' +
        '届かない場合は、Amazonの「コンテンツと端末の管理」→「設定」→「承認済みEメールアドレス」に ' +
        Session.getEffectiveUser().getEmail() + ' が登録されているか確認してください。',
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('テスト送信に失敗しました', String((e && e.message) || e), ui.ButtonSet.OK);
    appendLog_('エラー', 'テスト送信失敗', String((e && e.stack) || e));
  }
}

/** 診断: 設定・トリガー・Gmail検索・フィード疎通を1画面で確認する。 */
function runDiagnostics() {
  const ui = SpreadsheetApp.getUi();
  const lines = [];

  lines.push('■ バージョン: v' + SCRIPT_VERSION);

  const config = readConfig_();
  if (config.issues.length > 0) {
    lines.push('■ 設定: ⚠️ 不備があります');
    config.issues.forEach(function (issue) { lines.push('  ・' + issue); });
  } else {
    lines.push('■ 設定: OK（送信先 ' + config.kindleEmail + ' / ' + deliveryLabel_() + '）');
  }

  lines.push('■ 自動実行トリガー: ' + (hasHourlyTrigger_() ? 'OK（設定済み）' : '⚠️ 未設定 →「① 初期セットアップ」を実行してください'));

  const state = loadState_();
  lines.push('■ 最終確認: ' + (state.lastSuccessTs ? Utilities.formatDate(new Date(state.lastSuccessTs), timeZone_(), 'M/d HH:mm') : 'まだ実行されていません'));

  // 週1まとめの状態（設定中のタイトル＋貯まっている記事数）
  const digestTitleSet = {};
  config.newsletters.forEach(function (n) { if (n.digestTitle) digestTitleSet[n.digestTitle] = true; });
  Object.keys(state.weeklyPending || {}).forEach(function (t) {
    if (state.weeklyPending[t].length > 0) digestTitleSet[t] = true;
  });
  Object.keys(digestTitleSet).forEach(function (title) {
    const count = (state.weeklyPending[title] || []).length;
    lines.push('■ 週1まとめ「' + title + '」: 貯まっている記事 ' + count + '本（毎週月曜の朝にまとめて1冊で届きます）');
  });

  // Gmail検索の疎通（直近2日でのヒット数）
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

  // フィードの疎通（ブログURLからの自動検出込み）
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

  ui.alert('診断結果', lines.join('\n'), ui.ButtonSet.OK);
}

/** 新テンプレへの移行時などに、このシートの自動実行を完全に止める。 */
function stopAll() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert(
    'このシートを停止しますか？',
    '自動実行トリガーを削除します。以後このシートからKindleへの送信は止まります。\n（再開したいときは「① 初期セットアップ」を実行すれば元に戻ります）',
    ui.ButtonSet.OK_CANCEL
  );
  if (answer !== ui.Button.OK) return;
  deleteOwnTriggers_();
  appendLog_('停止', 'トリガーを削除しました', '');
  ui.alert('停止しました', 'このシートからの自動送信は止まりました。', ui.ButtonSet.OK);
}

function showHelp() {
  SpreadsheetApp.getUi().alert(
    'ヘルプ',
    '使い方・よくある質問はこちら:\n' + GUIDE_URL + '\n\n' +
      '困ったときは「🩺 診断」を実行すると原因の見当がつきます。',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
