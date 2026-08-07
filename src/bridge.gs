/**
 * Kindle Life — Macアプリ連携ブリッジ（Webアプリ）
 *
 * Macアプリからの要求を受けて、任意の記事URLをKindleへ送る。
 * - デプロイ: 「ウェブアプリ / 自分として実行 / 全員」。URLは推測不能なIDを含む
 * - 認証: 初回に Macアプリが生成したトークンを init で登録（TOFU）。以後は毎回照合
 * - トークンはURLに載せず、常にPOST bodyで受ける（GAS WebアプリはHTTPS固定）
 * - Google OAuthをアプリ側に一切持たせないための設計（DESIGN §mac-app 参照）
 */

function doPost(e) {
  var out;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = bridgeHandle_(body);
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function bridgeHandle_(body) {
  var props = PropertiesService.getScriptProperties();
  var stored = props.getProperty('BRIDGE_TOKEN');
  var token = String(body.token || '');

  // 初回接続: トークン未登録なら、このトークンを登録して以後の合言葉にする
  if (body.action === 'init') {
    if (stored) {
      if (stored === token) return { ok: true, initialized: false };
      return { ok: false, error: 'すでに別の端末と連携済みです。再連携するにはシートのメニュー「📱 Macアプリ連携」からリセットしてください' };
    }
    if (token.length < 16) return { ok: false, error: 'トークンが短すぎます' };
    props.setProperty('BRIDGE_TOKEN', token);
    return { ok: true, initialized: true };
  }

  if (!stored || token !== stored) {
    return { ok: false, error: 'unauthorized' };
  }

  switch (body.action) {
    case 'ping':
      return { ok: true, version: SCRIPT_VERSION };
    case 'sendUrl':
      return bridgeSendUrl_(String(body.url || ''), String(body.title || ''));
    default:
      return { ok: false, error: '不明なaction: ' + body.action };
  }
}

/**
 * 記事URLを取得→クリーンHTML化→1冊としてKindleへ送信。
 * 既存の配信エンジン（cleanArticleHtml_ / buildItemHtml_ / sendItemMail_）をそのまま使う。
 */
function bridgeSendUrl_(url, titleHint) {
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'URLが不正です: ' + url };
  }
  var kindleEmail = String(namedValue_('KINDLE_EMAIL') || '').trim();
  if (!/@kindle\.com$/i.test(kindleEmail)) {
    return { ok: false, error: 'シートの赤枠①にKindleアドレスが設定されていません' };
  }

  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    return { ok: false, error: '記事を取得できませんでした（HTTP ' + resp.getResponseCode() + '）' };
  }
  var pageHtml = resp.getContentText();

  var title = titleHint;
  if (!title) {
    var tm = pageHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    title = tm ? bridgeDecodeTitle_(tm[1]) : url;
  }

  var articleMatch = pageHtml.match(/<article[\s>][\s\S]*?<\/article\s*>/i);
  var bodyHtml = absolutizeImgUrls_(
    cleanArticleHtml_(articleMatch ? articleMatch[0] : pageHtml),
    url
  );

  var item = {
    title: title,
    link: url,
    source: 'Kindle Life（Macアプリから送信）',
    dateStr: formatDateLabel_(new Date()),
    html: bodyHtml,
  };
  var budget = { count: 0, bytes: 0, deadline: Date.now() + 4.5 * 60 * 1000 };
  var html = buildItemHtml_(item, budget);
  sendItemMail_(kindleEmail, item, html);
  return { ok: true, title: title };
}

/** <title>の中身を表示用テキストに（タグ除去・主要エンティティのみ復元） */
function bridgeDecodeTitle_(raw) {
  return String(raw)
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** メニュー「📱 Macアプリ連携」: WebアプリURLと連携状態を表示する */
function showBridgeInfo() {
  var ui = SpreadsheetApp.getUi();
  var url = '';
  try {
    url = ScriptApp.getService().getUrl() || '';
  } catch (e) {}
  var stored = PropertiesService.getScriptProperties().getProperty('BRIDGE_TOKEN');
  var lines = [];
  if (url) {
    lines.push('WebアプリURL（Macアプリの「配信」タブに貼り付け）:');
    lines.push(url);
  } else {
    lines.push('まだWebアプリとしてデプロイされていません。');
    lines.push('拡張機能 → Apps Script → デプロイ → 新しいデプロイ → 種類「ウェブアプリ」');
    lines.push('（自分として実行 / 全員がアクセス可能）でデプロイしてください。');
  }
  lines.push('');
  lines.push('連携状態: ' + (stored ? '連携済み' : '未連携（Macアプリ側でURLを保存すると自動で連携されます）'));
  var res = ui.alert(
    '📱 Macアプリ連携',
    lines.join('\n') + (stored ? '\n\n「OK」で連携を維持 / 「キャンセル」で連携をリセット（再連携できるようになります）' : ''),
    stored ? ui.ButtonSet.OK_CANCEL : ui.ButtonSet.OK
  );
  if (stored && res === ui.Button.CANCEL) {
    PropertiesService.getScriptProperties().deleteProperty('BRIDGE_TOKEN');
    ui.alert('連携をリセットしました。Macアプリ側でURLを保存し直すと再連携されます。');
  }
}
