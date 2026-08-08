/**
 * Kindle Life — メルマガ収集（Gmail）
 *
 * 登録差出人のメールを1クエリで検索し、前回成功実行以降（最大 MAX_WINDOW_MS）の
 * 未処理メールをクリーンアップ済みHTMLとして収集する。
 * 読み取りのみ（送信はMailApp経由。gmail.readonlyスコープで動かす）。
 */

/**
 * 新着メルマガを収集する。 [{kind, id, title, source, dateMs, dateStr, html}]
 * ここでは処理済みに「しない」。1件ずつの送信成功後にmain側で記録する
 * （失敗した分は次の毎時実行で自然に拾われる）。
 */
function collectNewsletters_(config, state, budget) {
  const senders = config.newsletters;
  if (senders.length === 0) return [];

  const windowStart = Math.max(
    state.lastSuccessTs || Date.now() - MAX_WINDOW_MS,
    Date.now() - MAX_WINDOW_MS
  );
  // Gmailの newer_than は日単位。窓の上限（MAX_WINDOW_MS）＋1日までしか遡らない
  const maxDays = Math.ceil(MAX_WINDOW_MS / (24 * 60 * 60 * 1000)) + 1;
  const days = Math.min(maxDays, Math.max(2, Math.ceil((Date.now() - windowStart) / (24 * 60 * 60 * 1000)) + 1));

  const query = buildSearchQuery_(senders, days);
  const threads = GmailApp.search(query, 0, 100);
  const items = [];

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      const id = message.getId();
      if (state.processedIds[id]) return; // 送信済み
      if (message.getDate().getTime() < windowStart) return; // 窓の外
      const sender = findSender_(message.getFrom(), senders); // スレッド内の無関係なメールを除外
      if (!sender) return;
      if (Date.now() > budget.deadline) return; // 時間切れ: 今回は見送り（翌回で拾われる）

      items.push({
        kind: 'newsletter',
        id: id,
        // 転送メールの「Fwd:」等はKindleの書名から外す
        title: String(message.getSubject() || '(無題)').replace(/^(?:\s*(?:fwd?|re|転送)\s*:\s*)+/i, '') || '(無題)',
        source: senderDisplayName_(message.getFrom()),
        dateMs: message.getDate().getTime(),
        dateStr: Utilities.formatDate(message.getDate(), timeZone_(), 'M/d HH:mm'),
        html: newsletterBodyHtml_(message),
        digestTitle: sender.digestTitle || '',
      });
    });
  });

  // 届いた順に並べる
  items.sort(function (a, b) { return a.dateMs - b.dateMs; });
  return items;
}

/** 差出人リストからGmail検索クエリを組み立てる。 */
function buildSearchQuery_(senders, days) {
  const fromClause = senders
    .map(function (s) { return '"' + s.email + '"'; })
    .join(' OR ');
  return 'from:(' + fromClause + ') newer_than:' + days + 'd';
}

/** Fromヘッダー（例: "Foo News <news@example.com>"）に合致する差出人設定を返す。なければnull。 */
function findSender_(fromHeader, senders) {
  const lower = String(fromHeader).toLowerCase();
  for (let i = 0; i < senders.length; i++) {
    if (lower.indexOf(senders[i].email.toLowerCase()) !== -1) return senders[i];
  }
  return null;
}

/** メール1通をクリーンアップ済み本文HTMLにする（個別配信・週1まとめ共通）。 */
function newsletterBodyHtml_(message) {
  const body = message.getBody();
  if (!body || !looksLikeHtml_(body)) {
    return plainTextToHtml_(message.getPlainBody() || '');
  }
  return cleanEmailHtml_(body);
}

/** Fromヘッダーから表示名（なければアドレス）を取り出す。 */
function senderDisplayName_(fromHeader) {
  const m = String(fromHeader).match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return (m ? m[1] : String(fromHeader)).trim();
}
