/**
 * Kindle Life — 1冊ぶんHTML生成（個別配信・週1まとめ）
 *
 * クリーンアップ済みの記事を、自己完結した1冊ぶんのHTMLに包む。
 * クリーンアップは収集時に完了しているため、ここで付与するタグは
 * 白リスト処理を通らない（順序が重要）。
 * 見出しを<h1>にすることで、Send to Kindle変換後の表示とも整合する
 * （まとめでは各記事の<h1>がそのまま章になる）。
 */

/**
 * 記事1件の自己完結HTMLを組み立てる。
 * item: collectNewsletters_ / collectBlogPosts_ の結果1件
 * budget: 画像埋め込み予算（1冊ごとに新しく作って渡す）
 */
function buildItemHtml_(item, budget) {
  let meta = escapeHtml_(item.source);
  if (item.dateStr) meta += '・' + item.dateStr;
  if (item.link) {
    meta += '<br><a href="' + escapeHtml_(item.link) + '">' + escapeHtml_(item.link) + '</a>';
  }
  const body = embedImages_(item.html, budget);
  return (
    '<!DOCTYPE html>' +
    '<html lang="ja">' +
    '<head><meta charset="UTF-8"><title>' + escapeHtml_(item.title) + '</title></head>' +
    '<body>' +
    '<h1>' + escapeHtml_(item.title) + '</h1>' +
    '<p style="color:#666;font-size:0.85em;">' + meta + '</p>' +
    body +
    '</body></html>'
  );
}

/**
 * 貯まっている週1まとめを、送りどきなら1タイトル = 1冊で送信する。送った冊数を返す。
 * 送りどき = 月曜のDIGEST_HOUR以降で今日まだ送っていない、または最古の記事がDIGEST_OVERDUE_MSを超過。
 * pendingの削除は1冊送信できるたびにstateへ反映する（呼び出し側が失敗時もsaveState_する前提）。
 * 現在のシート設定は参照しない（差出人を消した後でも、貯まった分は送り切る）。
 */
function sendDueDigests_(kindleEmail, state, budget, now) {
  const pending = state.weeklyPending;
  const titles = Object.keys(pending).filter(function (t) { return pending[t].length > 0; });
  if (titles.length === 0) return 0;

  const tz = timeZone_();
  const today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const weekday = Number(Utilities.formatDate(now, tz, 'u')); // 1=月
  const hour = Number(Utilities.formatDate(now, tz, 'H'));
  const oldestMs = titles.reduce(function (min, t) {
    return pending[t].reduce(function (m, e) { return Math.min(m, e.dateMs); }, min);
  }, Infinity);

  const isWeeklyTime =
    weekday === DIGEST_WEEKDAY && hour >= DIGEST_HOUR && getStateValue_('lastDigestDate') !== today;
  const isOverdue = now.getTime() - oldestMs > DIGEST_OVERDUE_MS;
  if (!isWeeklyTime && !isOverdue) return 0;

  let books = 0;
  titles.forEach(function (title) {
    const entries = pending[title].slice().sort(function (a, b) { return a.dateMs - b.dateMs; });
    const articles = [];
    entries.forEach(function (entry) {
      try {
        const message = GmailApp.getMessageById(entry.id);
        articles.push({
          title: message.getSubject() || '(無題)',
          source: senderDisplayName_(message.getFrom()),
          dateMs: entry.dateMs,
          dateStr: Utilities.formatDate(message.getDate(), tz, 'M/d'),
          html: newsletterBodyHtml_(message),
        });
      } catch (e) {
        // ユーザーが削除したメールなどは1冊から除外する（まとめ全体は止めない）
        appendLog_('週1まとめ', 'メールを読めず1冊から除外: ' + entry.id, String((e && e.message) || e));
      }
    });

    if (articles.length > 0) {
      const bookTitle = title + ' ' + digestRangeLabel_(articles);
      // 画像埋め込みの上限はメール1通あたりの安全枠なので、1冊ごとにリセットする
      const imageBudget = { count: 0, bytes: 0, deadline: budget.deadline };
      const html = buildDigestHtml_(bookTitle, articles, imageBudget);
      sendItemMail_(kindleEmail, { title: bookTitle }, html); // 失敗時はthrow → このタイトルは残り、次の実行で再試行
    }
    delete state.weeklyPending[title];
    books++;
  });

  setStateValue_('lastDigestDate', today);
  return books;
}

/** 「7/27〜8/2」形式の収録期間ラベル。1記事だけなら日付1つ。 */
function digestRangeLabel_(articles) {
  const first = articles[0].dateStr;
  const last = articles[articles.length - 1].dateStr;
  return first === last ? first : first + '〜' + last;
}

/** 週1まとめ1冊ぶんの自己完結HTML（目次＋記事を<h1>章で連結）。 */
function buildDigestHtml_(bookTitle, articles, budget) {
  const toc =
    '<ol>' +
    articles.map(function (a) { return '<li>' + escapeHtml_(a.title) + '（' + a.dateStr + '）</li>'; }).join('') +
    '</ol>';
  const sections = articles
    .map(function (a) {
      return (
        '<h1>' + escapeHtml_(a.title) + '</h1>' +
        '<p style="color:#666;font-size:0.85em;">' + escapeHtml_(a.source) + '・' + a.dateStr + '</p>' +
        embedImages_(a.html, budget)
      );
    })
    .join('<hr>');
  return (
    '<!DOCTYPE html>' +
    '<html lang="ja">' +
    '<head><meta charset="UTF-8"><title>' + escapeHtml_(bookTitle) + '</title></head>' +
    '<body>' +
    '<h1>' + escapeHtml_(bookTitle) + '</h1>' +
    '<p>収録 ' + articles.length + '本</p>' +
    toc +
    '<hr>' +
    sections +
    '</body></html>'
  );
}
