/**
 * Kindle Life — Macアプリ連携ブリッジ（Googleフォーム・チャネル）
 *
 * MacアプリからGASへ指示を渡すのに「連携用Googleフォーム」を使う。
 * - フォームへのPOST（formResponse）はOAuth不要でどのアプリからでも投げられる
 * - 送信と同時に onFormSubmit トリガーが即時発火する（ポーリング不要）
 * - WebアプリのデプロイはGoogleがエディタでの手動操作を要求するため不採用
 *   （API/claspで作ったWebアプリデプロイは404になる制限を2026-08-07に実測確認）
 *
 * 初期セットアップがフォームを自動作成し、「連携コード」（POST先URL・フィールドID・
 * トークンをまとめたもの）をダイアログ表示 → ユーザーはそれをMacアプリに1回貼るだけ。
 */

/** 連携フォームを用意し（無ければ作成）、onFormSubmitトリガーを張り直す。 */
function ensureBridgeForm_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('BRIDGE_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('BRIDGE_TOKEN', token);
  }

  var form = null;
  var formId = props.getProperty('BRIDGE_FORM_ID');
  if (formId) {
    try {
      form = FormApp.openById(formId);
    } catch (e) {
      form = null; // 削除されていたら作り直す
    }
  }
  if (!form) {
    form = FormApp.create('Kindle Life 連携（削除しないでください）');
    form.setDescription(
      'Kindle LifeのMacアプリからの指示（記事をKindleへ送る等）を受け取るための内部フォームです。' +
      '削除するとMacアプリ連携が動かなくなります。'
    );
    form.addTextItem().setTitle('payload');
    props.setProperty('BRIDGE_FORM_ID', form.getId());
  }

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onBridgeSubmit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onBridgeSubmit').forForm(form).onFormSubmit().create();
  return form;
}

/** Macアプリに貼る連携コード。POST先URL・フィールドID・トークンをbase64でまとめる。 */
function bridgeCode_() {
  var props = PropertiesService.getScriptProperties();
  var formId = props.getProperty('BRIDGE_FORM_ID');
  var token = props.getProperty('BRIDGE_TOKEN');
  if (!formId || !token) return null;
  var form;
  try {
    form = FormApp.openById(formId);
  } catch (e) {
    return null;
  }
  var item = form.getItems()[0].asTextItem();
  // prefill URLから formResponse の正確なフィールド名（entry.xxxx）を取り出す
  var prefill = form
    .createResponse()
    .withItemResponse(item.createResponse('x'))
    .toPrefilledUrl();
  var m = prefill.match(/[?&]entry\.(\d+)=/);
  if (!m) return null;
  var postUrl = form.getPublishedUrl().replace(/\/viewform.*$/, '/formResponse');
  var payload = { u: postUrl, e: m[1], t: token };
  return 'KL1.' + Utilities.base64Encode(JSON.stringify(payload));
}

/** 連携フォームへの送信で即時発火。payload = JSON {token, action, ...} */
function onBridgeSubmit(e) {
  var raw = '';
  try {
    var responses = e.response.getItemResponses();
    if (responses.length > 0) raw = String(responses[0].getResponse() || '');
    var body = JSON.parse(raw);
    var stored = PropertiesService.getScriptProperties().getProperty('BRIDGE_TOKEN');
    if (!stored || body.token !== stored) return; // 部外者の投稿は黙って無視

    switch (body.action) {
      case 'sendUrl':
        var result = bridgeSendUrl_(String(body.url || ''), String(body.title || ''));
        if (!result.ok) {
          throw new Error('Macアプリからの記事送信に失敗: ' + result.error + '（URL: ' + body.url + '）');
        }
        break;
      default:
        // 未知のactionは無視（将来の拡張分を旧版が受けても壊れないように）
        break;
    }
  } catch (err) {
    notifyError_(err);
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

/** メニュー「📱 Macアプリ連携」: 連携コードの表示（必要ならフォーム作成から） */
function showBridgeInfo() {
  var ui = SpreadsheetApp.getUi();
  ensureBridgeForm_();
  var code = bridgeCode_();
  if (!code) {
    ui.alert('連携コードを作成できませんでした。「① 初期セットアップ」を実行してからもう一度お試しください。');
    return;
  }
  ui.alert(
    '📱 Macアプリ連携',
    '下の連携コードをコピーして、Macアプリの「配信」タブに貼り付けてください。\n\n' + code,
    ui.ButtonSet.OK
  );
}
