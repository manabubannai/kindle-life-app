/**
 * Kindle Life — メルマガ収集（Gmail）
 *
 * 登録差出人のメールを1クエリで検索し、前回成功実行以降（最大48h）の
 * 未処理メールをクリーンアップ済みHTMLとして収集する。
 * 読み取りのみ（送信はMailApp経由。gmail.readonlyスコープで動かす）。
 */

/**
 * 新着メルマガを収集する。 [{kind, id, title, source, dateMs, dateStr, html}]
 * ここでは処理済みに「しない」。ダイジェスト送信の成功後にmain側で記録する
 * （失敗した日の分は翌日のダイジェストで自然に拾われる）。
 */
function collectNewsletters_(config, state, budget) {
  const senders = config.newsletters;
  if (senders.length === 0) return [];

  const windowStart = Math.max(
    state.lastSuccessTs || Date.now() - 24 * 60 * 60 * 1000,
    Date.now() - MAX_WINDOW_MS
  );
  const days = Math.min(4, Math.max(2, Math.ceil((Date.now() - windowStart) / (24 * 60 * 60 * 1000)) + 1));

  const query = buildSearchQuery_(senders, days);
  const threads = GmailApp.search(query, 0, 100);
  const items = [];

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      const id = message.getId();
      if (state.processedIds[id]) return; // 送信済み
      if (message.getDate().getTime() < windowStart) return; // 窓の外
      if (!isTargetSender_(message.getFrom(), senders)) return; // スレッド内の無関係なメールを除外
      if (Date.now() > budget.deadline) return; // 時間切れ: 今回は見送り（翌回で拾われる）

      let body = message.getBody();
      if (!body || !looksLikeHtml_(body)) {
        body = plainTextToHtml_(message.getPlainBody() || '');
      } else {
        body = cleanEmailHtml_(body);
      }

      items.push({
        kind: 'newsletter',
        id: id,
        title: message.getSubject() || '(無題)',
        source: senderDisplayName_(message.getFrom()),
        dateMs: message.getDate().getTime(),
        dateStr: Utilities.formatDate(message.getDate(), timeZone_(), 'M/d HH:mm'),
        html: body,
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

/** Fromヘッダー（例: "Foo News <news@example.com>"）が差出人リストに合致するか。 */
function isTargetSender_(fromHeader, senders) {
  const lower = fromHeader.toLowerCase();
  return senders.some(function (s) {
    return lower.indexOf(s.email.toLowerCase()) !== -1;
  });
}

/** Fromヘッダーから表示名（なければアドレス）を取り出す。 */
function senderDisplayName_(fromHeader) {
  const m = String(fromHeader).match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return (m ? m[1] : String(fromHeader)).trim();
}
