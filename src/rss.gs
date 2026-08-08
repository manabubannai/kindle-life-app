/**
 * Kindle Life — ブログ収集（RSS 2.0 + Atom）
 *
 * フィードの新着を検知し、抜粋フィードでも記事ページ本体から全文を取得する。
 * 送信済みGUIDはフィード別に管理し、後から追加したフィードは
 * 「初回は記録のみ」にして過去記事の一斉配信を防ぐ。
 */

/**
 * 新着ブログ記事を収集する。 [{kind, guid, feedUrl, title, source, link, html}]
 * 初回フィードの登録（記録のみ）はここで state.feedGuids に直接行うが、
 * 新着記事のGUIDは1件ずつの送信成功後にmain側で記録する。
 * state.feedGuids のキーはユーザーが入力したURL（解決後のフィードURLではなく）。
 */
function collectBlogPosts_(config, state, budget) {
  const items = [];
  const today = Utilities.formatDate(new Date(), timeZone_(), 'M/d HH:mm');

  config.blogs.forEach(function (blog) {
    let feedUrl;
    try {
      feedUrl = resolveFeedUrl_(blog.feed);
    } catch (e) {
      console.error('フィード解決失敗: ' + blog.feed + ' — ' + e);
      writeBlogStatus_(blog.row, 'エラー: ' + String(e.message || e).slice(0, 100));
      return;
    }
    let feed;
    try {
      feed = fetchFeed_(feedUrl);
    } catch (e) {
      // 解決済みキャッシュが古い可能性があるので破棄し、次回の実行で再検出させる
      dropFeedCacheEntry_(blog.feed);
      console.error('フィード取得失敗: ' + feedUrl + ' — ' + e);
      writeBlogStatus_(blog.row, 'エラー: ' + String(e.message || e).slice(0, 100));
      return; // このフィードだけスキップ（実行全体は止めない）
    }

    // 初回登録: 既存記事のGUIDを記録するだけで配信しない
    if (isNewFeed_(state, blog.feed)) {
      const known = {};
      feed.items.forEach(function (item) { known[item.guid] = Date.now(); });
      state.feedGuids[blog.feed] = known;
      writeBlogStatus_(blog.row, '登録完了: ' + (feed.title || '(名称不明)') + '（次の新着から届きます） ' + today);
      return;
    }

    const known = state.feedGuids[blog.feed];
    const fresh = feed.items
      .filter(function (item) { return !known[item.guid]; })
      .slice(0, MAX_POSTS_PER_FEED); // 暴走フィード対策。残りは次の実行に持ち越し

    fresh.forEach(function (item) {
      items.push({
        kind: 'blog',
        guid: item.guid,
        feedUrl: blog.feed,
        title: item.title,
        source: feed.title || feedTitleFromUrl_(blog.feed),
        link: item.link,
        html: fetchArticleBody_(item, budget),
      });
    });

    writeBlogStatus_(blog.row, 'OK 最終確認 ' + today + (fresh.length ? '（新着' + fresh.length + '本）' : ''));
  });

  return items;
}

// ブログURLからフィードを推測するときに試す定番パス
// （WordPress: /feed、note等: /rss、Hugo: /index.xml、その他: /atom.xml 等）
const FEED_CANDIDATE_PATHS_ = ['feed', 'rss', 'index.xml', 'atom.xml', 'feed.xml', 'rss.xml'];

/**
 * 入力URL（ブログのトップページ or フィードURL）から実際のフィードURLを解決する。
 * ユーザーは「ブログのURLを貼るだけ」でよく、フィードURLを探す必要がない。
 * 解決結果はキャッシュされ、2回目以降はfetchなしで返る。
 */
function resolveFeedUrl_(inputUrl) {
  const cache = loadFeedCache_();
  if (cache[inputUrl]) return cache[inputUrl];
  const resolved = discoverFeedUrl_(inputUrl);
  cache[inputUrl] = resolved;
  saveFeedCache_(cache);
  return resolved;
}

function discoverFeedUrl_(inputUrl) {
  // 1. 入力URL自体がフィードならそのまま使う
  const first = fetchUrlKind_(inputUrl);
  if (first.kind === 'feed') return inputUrl;
  if (first.blocked) {
    // bot対策でプログラムからのアクセス自体を拒否するサイト（bearblog等）は登録不可
    throw new Error('このブログはプログラムからのアクセスをブロックしているため、登録できません（サイト側のbot対策）');
  }

  // 2. HTMLページなら <link rel="alternate" type="application/rss+xml"> を探す（標準の自動検出）
  if (first.kind === 'html') {
    const linked = findFeedLinkInHtml_(first.text, inputUrl);
    if (linked && fetchUrlKind_(linked).kind === 'feed') return linked;
  }

  // 3. よくあるフィードパスを順に試す
  const base = inputUrl.replace(/[?#].*$/, '').replace(/\/+$/, '');
  for (let i = 0; i < FEED_CANDIDATE_PATHS_.length; i++) {
    const candidate = base + '/' + FEED_CANDIDATE_PATHS_[i];
    if (fetchUrlKind_(candidate).kind === 'feed') return candidate;
  }

  throw new Error('フィードが見つかりません。ブログのトップページのURLを確認してください');
}

/** URLを取得して 'feed' / 'html' / 'error' に分類する。feedの判定はXMLのルート要素で行う。 */
function fetchUrlKind_(url) {
  try {
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': BROWSER_UA_ } });
    if (resp.getResponseCode() === 403) return { kind: 'error', blocked: true };
    if (resp.getResponseCode() !== 200) return { kind: 'error' };
    const text = resp.getContentText();
    try {
      const rootName = XmlService.parse(text.replace(/^\uFEFF/, '')).getRootElement().getName().toLowerCase();
      if (rootName === 'rss' || rootName === 'feed') return { kind: 'feed', text: text };
    } catch (e) {
      // XMLとして解釈できない = HTMLページとして扱う
    }
    return { kind: 'html', text: text };
  } catch (e) {
    return { kind: 'error' };
  }
}

/** HTMLの<head>からフィード自動検出用の<link>を探し、絶対URLで返す。なければnull。 */
function findFeedLinkInHtml_(html, pageUrl) {
  const links = html.match(/<link\b[^>]*>/gi) || [];
  for (let i = 0; i < links.length; i++) {
    const tag = links[i];
    if (!/rel\s*=\s*["']?alternate["']?/i.test(tag)) continue;
    if (!/type\s*=\s*["']?application\/(?:rss|atom)\+xml["']?/i.test(tag)) continue;
    const m = tag.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const raw = m && (m[1] || m[2] || m[3]);
    if (raw) return absolutizeUrl_(raw.replace(/&amp;/g, '&'), pageUrl);
  }
  return null;
}

/** 相対URLをページURL基準の絶対URLにする。 */
function absolutizeUrl_(url, baseUrl) {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf('//') === 0) return 'https:' + url;
  const origin = baseUrl.replace(/^(https?:\/\/[^\/]+).*/, '$1');
  if (url.charAt(0) === '/') return origin + url;
  return baseUrl.replace(/[?#].*$/, '').replace(/\/[^\/]*$/, '/') + url;
}

/**
 * フィードを取得する。RSS 2.0とAtomの両対応。
 * {title, items: [{title, link, guid, description}]}
 * titleはフィード自身が宣言するブログ名で、各記事の出典表示に使う
 * （メモ列を持たないぶん、表示名はフィードから自動で得る）。
 */
function fetchFeed_(feedUrl) {
  const resp = UrlFetchApp.fetch(feedUrl, { muteHttpExceptions: true, headers: { 'User-Agent': BROWSER_UA_ } });
  if (resp.getResponseCode() !== 200) {
    throw new Error('フィードを取得できません（HTTP ' + resp.getResponseCode() + '）');
  }
  const root = XmlService.parse(resp.getContentText()).getRootElement();
  const rootName = root.getName().toLowerCase();

  if (rootName === 'feed') {
    const ns = root.getNamespace();
    return { title: (root.getChildText('title', ns) || '').trim(), items: parseAtom_(root) };
  }

  const channel = root.getChild('channel');
  if (!channel) throw new Error('RSS/Atom形式のフィードではありません');
  return { title: (channel.getChildText('title') || '').trim(), items: parseRss_(channel) };
}

/** RSS 2.0: <channel><item><title/link/guid/description> */
function parseRss_(channel) {
  return channel.getChildren('item')
    .map(function (item) {
      const link = item.getChildText('link') || '';
      return {
        title: item.getChildText('title') || '(無題)',
        link: link,
        guid: item.getChildText('guid') || link,
        description: item.getChildText('description') || '',
      };
    })
    .filter(function (item) { return item.link !== ''; });
}

/** Atom: <feed><entry><title/link[rel=alternate]/id/summary|content> */
function parseAtom_(root) {
  const ns = root.getNamespace();
  return root.getChildren('entry', ns)
    .map(function (entry) {
      let link = '';
      const links = entry.getChildren('link', ns);
      for (let i = 0; i < links.length; i++) {
        const rel = links[i].getAttribute('rel');
        const href = links[i].getAttribute('href');
        if (!href) continue;
        // rel未指定 or alternate が記事本体のURL
        if (!rel || rel.getValue() === 'alternate') {
          link = href.getValue();
          break;
        }
        if (!link) link = href.getValue(); // 保険: 最初のhref
      }
      return {
        title: entry.getChildText('title', ns) || '(無題)',
        link: link,
        guid: entry.getChildText('id', ns) || link,
        description: entry.getChildText('summary', ns) || entry.getChildText('content', ns) || '',
      };
    })
    .filter(function (item) { return item.link !== ''; });
}

/**
 * 記事ページ本体から全文を取得してクリーンアップする。
 * 本文は<article>要素から取る。見つからないサイトはページ全体を
 * クリーンアップにかける（ナビ等のテキストが混ざるが本文は届く）。
 * 取得失敗・時間切れのときはフィードのdescription＋リンクに劣化させ、
 * 記事自体は必ず届ける。
 */
function fetchArticleBody_(item, budget) {
  if (Date.now() > budget.deadline) return fallbackBody_(item);
  try {
    const resp = UrlFetchApp.fetch(item.link, { muteHttpExceptions: true, headers: { 'User-Agent': BROWSER_UA_ } });
    if (resp.getResponseCode() !== 200) return fallbackBody_(item);
    const pageHtml = resp.getContentText();
    const articleMatch = pageHtml.match(/<article[\s>][\s\S]*?<\/article\s*>/i);
    let body = cleanArticleHtml_(articleMatch ? articleMatch[0] : pageHtml);
    return absolutizeImgUrls_(body, item.link);
  } catch (e) {
    console.error('記事ページ取得失敗: ' + item.link + ' — ' + e);
    return fallbackBody_(item);
  }
}

/** 全文が取れないときの劣化本文: フィードの抜粋＋元記事リンク。 */
function fallbackBody_(item) {
  const excerpt = item.description ? cleanEmailHtml_(item.description) : '';
  return excerpt +
    '<p><a href="' + escapeHtml_(item.link) + '">全文を読む: ' + escapeHtml_(item.link) + '</a></p>';
}

/** ブログ名が未記入のときにフィードURLのドメインを表示名にする。 */
function feedTitleFromUrl_(feedUrl) {
  const m = feedUrl.match(/^https?:\/\/([^\/]+)/i);
  return m ? m[1] : feedUrl;
}
