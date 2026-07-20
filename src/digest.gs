/**
 * Kindle Life — ダイジェスト（合本）生成
 *
 * クリーンアップ済みの各記事を、目次（アンカーリンク）付きの
 * 1つの自己完結HTMLに組み立てる。
 * クリーンアップは記事単位で収集時に完了しているため、ここで付与する
 * 目次・アンカー・改ページのタグは白リスト処理を通らない（順序が重要）。
 *
 * 各記事の見出しを<h1>にすることで、Send to Kindle変換後の
 * 見出しベース生成目次とも整合する。
 */

/**
 * 合本HTMLを組み立てる。
 * items: collectNewsletters_ / collectBlogPosts_ の結果を連結した配列
 * budget: 画像埋め込み予算（合本全体で共有。前方の記事が優先）
 */
function buildDigestHtml_(newsletters, posts, dateLabel, budget, notice) {
  const items = newsletters.concat(posts);

  const toc = items
    .map(function (it, i) {
      const label = it.kind === 'newsletter' ? '〔メルマガ〕' : '〔ブログ〕';
      return '<li><a href="#s' + (i + 1) + '">' + label + escapeHtml_(it.title) +
        ' — ' + escapeHtml_(it.source) + '</a></li>';
    })
    .join('');

  const sections = items
    .map(function (it, i) {
      let meta = escapeHtml_(it.source);
      if (it.dateStr) meta += '・' + it.dateStr;
      if (it.link) {
        meta += '<br><a href="' + escapeHtml_(it.link) + '">' + escapeHtml_(it.link) + '</a>';
      }
      const body = embedImages_(it.html, budget);
      return (
        '<h1 id="s' + (i + 1) + '">' + escapeHtml_(it.title) + '</h1>' +
        '<p style="color:#666;font-size:0.85em;">' + meta + '</p>' +
        body +
        (i < items.length - 1 ? '<div style="page-break-before:always"></div>' : '')
      );
    })
    .join('');

  return (
    '<!DOCTYPE html>' +
    '<html lang="ja">' +
    '<head><meta charset="UTF-8"><title>Kindle Life ' + escapeHtml_(dateLabel) + '</title></head>' +
    '<body>' +
    '<h1>Kindle Life ダイジェスト</h1>' +
    '<p>' + escapeHtml_(dateLabel) + '・メルマガ' + newsletters.length + '通・ブログ記事' + posts.length + '本</p>' +
    (notice ? '<p style="color:#666;font-size:0.85em;">' + escapeHtml_(notice) + '</p>' : '') +
    (items.length ? '<h2>目次</h2><ol>' + toc + '</ol>' : '<p>今日の新着はありませんでした。</p>') +
    '<hr>' +
    sections +
    '</body></html>'
  );
}
