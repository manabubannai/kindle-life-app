/**
 * Kindle Life — 1記事HTML生成（個別配信）
 *
 * クリーンアップ済みの記事1件を、自己完結した1冊ぶんのHTMLに包む。
 * クリーンアップは収集時に完了しているため、ここで付与するタグは
 * 白リスト処理を通らない（順序が重要）。
 * 見出しを<h1>にすることで、Send to Kindle変換後の表示とも整合する。
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
