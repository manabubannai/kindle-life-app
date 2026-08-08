/**
 * Kindle Life — エントリポイント
 *
 * トリガー設計: 毎時トリガー1本（hourlyTick）。
 * 毎時、新着のメルマガ・ブログ記事を集め、1件 = 1通（Kindleの1冊）として
 * その都度個別に送信する。新着がない時間は数百msで抜ける。
 * 送信に成功した記事だけを処理済みに記録するため、一時的な障害があっても
 * 未送信分は次の毎時実行で自動的に再試行される。
 */

/** 毎時トリガーから呼ばれる。 */
function hourlyTick() {
  try {
    ensureLayout_(); // シートのデザイン変更に入力欄の位置を追従させる
    runDelivery_();
    dailyUpdateCheck_(); // 1日1回だけ新版を照会
  } catch (e) {
    notifyError_(e);
  }
}

/** メニュー「今すぐ新着を確認して送信」。 */
function runDeliveryNow() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = runDelivery_();
    if (result.sent > 0 || result.digestBooks > 0) {
      const parts = [];
      if (result.sent > 0) parts.push('メルマガ' + result.newsletters + '通・ブログ記事' + result.posts + '本を1件ずつ');
      if (result.digestBooks > 0) parts.push('週1まとめ' + result.digestBooks + '冊を');
      ui.alert(
        '送信しました',
        parts.join('、') + 'Kindleへ送りました。\n数分〜十数分でKindleのライブラリに届きます。' +
          (result.pooled > 0 ? '\n（ほかに' + result.pooled + '通を週1まとめ用に受け取りました）' : '') +
          (result.remaining > 0 ? '\n（残り' + result.remaining + '件は次の自動実行で順に届きます）' : ''),
        ui.ButtonSet.OK
      );
    } else if (result.pooled > 0) {
      ui.alert(
        '週1まとめ用に受け取りました',
        '新着' + result.pooled + '通を受け取りました。週1まとめの指定があるため、今は送らず毎週月曜の朝にまとめて1冊で届きます。',
        ui.ButtonSet.OK
      );
    } else {
      ui.alert(
        '新着はありませんでした',
        '前回の確認以降、登録中のメルマガ・ブログに新着がないため何も送信していません。',
        ui.ButtonSet.OK
      );
    }
  } catch (e) {
    ui.alert('送信できませんでした', String((e && e.message) || e), ui.ButtonSet.OK);
    appendLog_('エラー', String((e && e.message) || e), String((e && e.stack) || ''));
  }
}

/**
 * 個別配信の本体。
 * 収集 → 1件ずつ「HTML化 → 送信 → 成功後にのみ処理済みを記録」の順序が重要。
 * 途中で送信に失敗した場合、失敗した記事から後は記録されず、
 * 次の毎時実行で同じ内容が再試行される。
 */
function runDelivery_() {
  const config = readConfig_();
  if (config.issues.length > 0) {
    throw new Error('設定に不備があります。\n・' + config.issues.join('\n・'));
  }

  const budget = { count: 0, bytes: 0, deadline: Date.now() + EXECUTION_BUDGET_MS };
  const state = loadState_();
  const now = new Date();

  const newsletters = collectNewsletters_(config, state, budget);
  const posts = collectBlogPosts_(config, state, budget);

  // 週1まとめ指定の差出人分は今は送らず、メールIDだけ貯めて受け取りを記録する
  // （本文は貯めない。まとめ送信時にIDからメールを引き直す）
  let pooled = 0;
  const immediate = [];
  newsletters.forEach(function (item) {
    if (item.digestTitle) {
      if (!state.weeklyPending[item.digestTitle]) state.weeklyPending[item.digestTitle] = [];
      state.weeklyPending[item.digestTitle].push({ id: item.id, dateMs: item.dateMs });
      state.processedIds[item.id] = Date.now();
      pooled++;
    } else {
      immediate.push(item);
    }
  });
  const items = immediate.concat(posts);

  // 1回の実行で送る上限（初回の溜まり分などでの大量送信を防ぐ。残りは次の毎時実行へ）
  const toSend = items.slice(0, MAX_SENDS_PER_RUN);
  let sentNewsletters = 0;
  let sentPosts = 0;
  let sendError = null;

  for (let i = 0; i < toSend.length; i++) {
    const item = toSend[i];
    try {
      // 画像埋め込みの上限（30枚/20MB）はメール1通あたりの安全枠なので、1冊ごとにリセットする
      const imageBudget = { count: 0, bytes: 0, deadline: budget.deadline };
      const html = buildItemHtml_(item, imageBudget);
      sendItemMail_(config.kindleEmail, item, html);
    } catch (e) {
      sendError = e;
      break; // ここから後の記事は未記録のまま残り、次の実行で再試行される
    }
    if (item.kind === 'newsletter') {
      state.processedIds[item.id] = Date.now();
      sentNewsletters++;
    } else {
      if (!state.feedGuids[item.feedUrl]) state.feedGuids[item.feedUrl] = {};
      state.feedGuids[item.feedUrl][item.guid] = Date.now();
      sentPosts++;
    }
  }

  // Gmail検索窓の起点は「全件送り切れた実行」でのみ前進させる
  // （上限あふれ・送信失敗で残った分が、窓の外にこぼれて消えるのを防ぐ）
  if (!sendError && items.length === toSend.length) {
    state.lastSuccessTs = now.getTime();
  }

  // 週1まとめの送信判定（月曜朝、または滞留の救済）。
  // 個別送信が失敗した実行では試みない（同じ原因で二重に失敗させない）
  let digestBooks = 0;
  let digestError = null;
  if (!sendError) {
    try {
      digestBooks = sendDueDigests_(config.kindleEmail, state, budget, now);
    } catch (e) {
      digestError = e; // 送信済みのまとめ分のpending削除は state に反映済み。未送信分は残り再試行される
    }
  }

  saveState_(state);

  const remaining = items.length - (sentNewsletters + sentPosts);
  if (sentNewsletters + sentPosts + pooled + digestBooks > 0) {
    appendLog_(
      '送信',
      'メルマガ' + sentNewsletters + '通＋ブログ記事' + sentPosts + '本を個別に送信' +
        (pooled > 0 ? '、週1まとめ用に' + pooled + '通を貯留' : '') +
        (digestBooks > 0 ? '、週1まとめ' + digestBooks + '冊を送信' : ''),
      remaining > 0 ? '残り' + remaining + '件は次の実行で送信' : ''
    );
  }
  if (sendError) throw sendError;
  if (digestError) throw digestError;

  return {
    sent: sentNewsletters + sentPosts,
    newsletters: sentNewsletters,
    posts: sentPosts,
    remaining: remaining,
    pooled: pooled,
    digestBooks: digestBooks,
  };
}
