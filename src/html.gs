/**
 * Kindle Life — 共通HTMLエンジン
 *
 * kindle-send-newsletter / kindle-send-blog で重複していた
 * クリーンアップ・画像埋め込み・エスケープ処理の統合版（共通エンジン化）。
 *
 * メルマガHTML（Substack等）は深い入れ子のテーブル・大量のインラインスタイル・
 * 条件付きコメントを含み、Webページはナビゲーション・サイドバーを含む。
 * Amazonの変換エンジンはこれらを誤解釈して本文の大部分を落とすことがあるため、
 * 本文の意味を持つタグだけを白リストで残し、レイアウト用のタグと属性を
 * すべて取り除いたシンプルなHTMLに再構築する。
 */

const KEEP_TAGS_ = /^(?:p|br|hr|h1|h2|h3|h4|h5|h6|a|img|ul|ol|li|blockquote|strong|em|b|i|u|s|small|sub|sup|pre|code)$/;

/** コメント・DOCTYPE・head・style・script の除去（メール/Web共通の前処理）。 */
function stripNonContent_(html) {
  let cleaned = html;
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
  cleaned = cleaned.replace(/<!DOCTYPE[^>]*>/gi, '');
  cleaned = cleaned.replace(/<head(\s[^>]*)?>[\s\S]*?<\/head\s*>/gi, '');
  cleaned = cleaned.replace(/<style(\s[^>]*)?>[\s\S]*?<\/style\s*>/gi, '');
  cleaned = cleaned.replace(/<script(\s[^>]*)?>[\s\S]*?<\/script\s*>/gi, '');
  return cleaned;
}

/**
 * タグを白リスト化: 本文系タグ以外（table/div/span/section等）は取り除き、
 * 中身のテキストだけ残す。残すタグも属性を落とす
 * （<a>のhrefと<img>のsrc/altだけ保持）。
 */
function whitelistRebuild_(html) {
  let cleaned = html.replace(
    /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
    function (match, slash, tag, attrs) {
      tag = tag.toLowerCase();
      if (!KEEP_TAGS_.test(tag)) return ' ';
      if (slash) return '</' + tag + '>';
      if (tag === 'a') {
        const href = (attrs.match(/\shref\s*=\s*("[^"]*"|'[^']*')/i) || [])[1];
        return href ? '<a href=' + href + '>' : '<a>';
      }
      if (tag === 'img') {
        const src = (attrs.match(/\ssrc\s*=\s*("[^"]*"|'[^']*')/i) || [])[1];
        if (!src) return '';
        const alt = (attrs.match(/\salt\s*=\s*("[^"]*"|'[^']*')/i) || [])[1] || '""';
        return '<img src=' + src + ' alt=' + alt + ' style="max-width:100%">';
      }
      return '<' + tag + '>';
    }
  );

  // 白リスト処理で残った空白の連続を1つにまとめる（Kindleでの空白ページ化を防ぐ）
  cleaned = cleaned.replace(/(?:&nbsp;|[ \t]){3,}/g, ' ');
  return cleaned;
}

/** メルマガHTMLのクリーンアップ（Substack対策込み）。 */
function cleanEmailHtml_(html) {
  let cleaned = stripNonContent_(html);

  // SubstackのCDN変換URLを元画像の直接URLに戻す（Amazonが取得できず画像が壊れる対策）
  cleaned = cleaned.replace(
    /https:\/\/substackcdn\.com\/image\/fetch\/[^"'\s>]*\/(https%3A%2F%2F[^"'\s>]+)/gi,
    function (match, encodedUrl) {
      try {
        return decodeURIComponent(encodedUrl);
      } catch (e) {
        return match;
      }
    }
  );

  // 開封トラッキングピクセルを除去（1px画像、Substackの /o/ ビーコン）
  cleaned = cleaned.replace(/<img[^>]*\s(?:width|height)=["']?1["']?[^>]*>/gi, '');
  cleaned = cleaned.replace(/<img[^>]*substack\.com\/o\/[^>]*>/gi, '');

  cleaned = whitelistRebuild_(cleaned);

  // メール冒頭のプレビュー用不可視文字（Substackが大量に入れる）を除去。
  // 生の文字と数値文字参照（&#847; 等）の両方の形で入っているため、両方消す。
  cleaned = cleaned.replace(/[\u034F\u00AD\u200B-\u200D\uFEFF\u2007]/g, '');
  cleaned = cleaned.replace(/&#(?:847|173|8199|820[3-5]|65279);/g, '');
  cleaned = cleaned.replace(/&#x(?:0*34f|0*ad|200[b-d]|feff|2007);/gi, '');

  return cleaned;
}

/** ブログ記事ページHTMLのクリーンアップ（ナビ等の除去込み）。 */
function cleanArticleHtml_(html) {
  let cleaned = stripNonContent_(html);

  // 本文以外の領域を中身ごと除去（<article>が見つからずページ全体を処理する場合の保険）
  cleaned = cleaned.replace(/<(nav|header|footer|aside)(\s[^>]*)?>[\s\S]*?<\/\1\s*>/gi, '');

  return whitelistRebuild_(cleaned);
}

/** 相対パスの画像URLを絶対URLにする（画像埋め込み処理はhttp(s)のみ対象のため）。 */
function absolutizeImgUrls_(html, pageUrl) {
  const origin = pageUrl.replace(/^(https?:\/\/[^\/]+).*/, '$1');
  return html.replace(/<img src=("|')(?!https?:\/\/|data:)([^"']+)\1/gi, function (match, quote, path) {
    const abs = path.indexOf('//') === 0 ? 'https:' + path
      : path.charAt(0) === '/' ? origin + path
      : origin + '/' + path;
    return '<img src=' + quote + abs + quote;
  });
}

/**
 * 画像URLをダウンロードして data:image/...;base64,... 形式の文字列にする。
 * Kindleが扱えない形式（webp/svg等）や取得失敗時はnullを返す。
 */
function fetchImageAsDataUri_(url) {
  const SUPPORTED_TYPES = {
    'image/jpeg': true,
    'image/jpg': true,
    'image/png': true,
    'image/gif': true,
    'image/bmp': true,
  };
  try {
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    const blob = resp.getBlob();
    const type = (blob.getContentType() || '').toLowerCase().split(';')[0];
    if (!SUPPORTED_TYPES[type]) return null;
    const bytes = blob.getBytes();
    if (bytes.length > IMAGE_LIMITS.maxSingleBytes) return null;
    return 'data:' + type + ';base64,' + Utilities.base64Encode(bytes);
  } catch (e) {
    return null;
  }
}

/**
 * HTML内のリモート画像をダウンロードしてbase64データURIで埋め込む。
 * Amazonの変換エンジンはリモート画像を取得しないため必須の処理。
 * budget（枚数・バイト数・締切）は1冊（記事1件）の中で共有し、超過後の画像と
 * 取得できない画像はタグごと取り除く（リンク切れアイコン化を防ぐ）。
 */
function embedImages_(html, budget) {
  return html.replace(/<img src=("|')(https?:\/\/[^"']+)\1([^>]*)>/g, function (match, quote, url, rest) {
    if (budget.count >= IMAGE_LIMITS.maxCount || budget.bytes > IMAGE_LIMITS.maxTotalBytes) return '';
    if (Date.now() > budget.deadline) return ''; // 時間切れ: 劣化送信を優先
    const dataUri = fetchImageAsDataUri_(url);
    if (!dataUri) return '';
    budget.count++;
    budget.bytes += dataUri.length;
    return '<img src="' + dataUri + '"' + rest + '>';
  });
}

/**
 * 本文がHTMLメールかどうかの判定。
 * プレーンテキストのメールでも getBody() は本文を返すため、
 * 実際にHTMLの構造タグが含まれているかで見分ける。
 */
function looksLikeHtml_(body) {
  return /<\s*(html|body|div|p|br|table|tr|td|img|span|a|blockquote|h[1-6])[\s>\/]/i.test(body);
}

/**
 * プレーンテキストをKindle向けHTMLに変換する。
 * 空行 → 段落区切り、行内の改行 → <br> として保持する。
 */
function plainTextToHtml_(text) {
  const escaped = escapeHtml_(text);
  return escaped
    .split(/\r?\n\s*\r?\n+/)
    .map(function (paragraph) {
      return '<p>' + paragraph.replace(/\r?\n/g, '<br>') + '</p>';
    })
    .join('\n');
}

function sanitizeFilename_(name) {
  return name.replace(/[\\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80) || 'kindle-life';
}

function escapeHtml_(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
