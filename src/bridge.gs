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
  // s = シートのURL。Macアプリが「シートを開く」ボタンに使う
  var payload = { u: postUrl, e: m[1], t: token, s: ss_().getUrl() };
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
      case 'addNewsletter':
        var ra = bridgeUpsertRow_('NEWSLETTER_LIST', String(body.email || ''), String(body.digestTitle || ''));
        if (!ra.ok) throw new Error('Macアプリからのメルマガ購読追加に失敗: ' + ra.error);
        break;
      case 'removeNewsletter':
        var rr = bridgeRemoveRow_('NEWSLETTER_LIST', String(body.email || ''));
        if (!rr.ok) throw new Error('Macアプリからのメルマガ購読解除に失敗: ' + rr.error);
        break;
      case 'addFeed':
        var fa = bridgeUpsertRow_('BLOG_LIST', String(body.url || ''), null);
        if (!fa.ok) throw new Error('Macアプリからのブログ購読追加に失敗: ' + fa.error);
        break;
      case 'removeFeed':
        var fr = bridgeRemoveRow_('BLOG_LIST', String(body.url || ''));
        if (!fr.ok) throw new Error('Macアプリからのブログ購読解除に失敗: ' + fr.error);
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

/**
 * 購読入力エリアへの追加・更新（Macアプリから）。
 * 値が既にあれば上書き（メルマガは週1まとめタイトルの更新）、無ければ空き行へ。
 * 空き行が無いときは範囲内に1行挿入してnamed rangeごと広げる。
 */
function bridgeUpsertRow_(rangeName, value, digestTitle) {
  value = String(value || '').trim();
  if (rangeName === 'NEWSLETTER_LIST' && value.indexOf('@') === -1) {
    return { ok: false, error: 'メールアドレスの形式ではありません: ' + value };
  }
  if (rangeName === 'BLOG_LIST' && !/^https?:\/\//i.test(value)) {
    return { ok: false, error: 'URLの形式ではありません: ' + value };
  }
  var range = ss_().getRangeByName(rangeName);
  if (!range) return { ok: false, error: 'シートに入力欄が見つかりません（「① 初期セットアップ」を実行してください）' };

  var values = range.getValues();
  var target = -1;
  var empty = -1;
  for (var i = 0; i < values.length; i++) {
    var v = String(values[i][0] || '').trim();
    if (v.toLowerCase() === value.toLowerCase()) { target = i; break; }
    if (v === '' && empty === -1) empty = i;
  }
  if (target === -1 && empty === -1) {
    range.getSheet().insertRowBefore(range.getLastRow());
    range = ss_().getRangeByName(rangeName);
    values = range.getValues();
    for (var j = 0; j < values.length; j++) {
      if (String(values[j][0] || '').trim() === '') { empty = j; break; }
    }
    if (empty === -1) return { ok: false, error: '入力欄に空き行を作れませんでした' };
  }
  if (target === -1) target = empty;

  range.getCell(target + 1, 1).setValue(value);
  if (rangeName === 'NEWSLETTER_LIST') {
    var titleRange = ss_().getRangeByName('NEWSLETTER_DIGEST_TITLES');
    if (titleRange) titleRange.getCell(target + 1, 1).setValue(String(digestTitle || '').trim());
  }
  return { ok: true };
}

/** 購読入力エリアからの解除（Macアプリから）。行は消さずセルを空にする。 */
function bridgeRemoveRow_(rangeName, value) {
  value = String(value || '').trim();
  var range = ss_().getRangeByName(rangeName);
  if (!range) return { ok: false, error: 'シートに入力欄が見つかりません' };
  var values = range.getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim().toLowerCase() === value.toLowerCase()) {
      range.getCell(i + 1, 1).setValue('');
      if (rangeName === 'NEWSLETTER_LIST') {
        var titleRange = ss_().getRangeByName('NEWSLETTER_DIGEST_TITLES');
        if (titleRange) titleRange.getCell(i + 1, 1).setValue('');
      }
      return { ok: true };
    }
  }
  return { ok: true }; // 既に無ければ成功扱い
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

/** メニュー「📱 Macアプリ連携」: ワンクリック接続ダイアログ（必要ならフォーム作成から） */
function showBridgeInfo() {
  var ui = SpreadsheetApp.getUi();
  ensureBridgeForm_();
  var code = bridgeCode_();
  if (!code) {
    ui.alert('連携コードを作成できませんでした。「① 初期セットアップ」を実行してからもう一度お試しください。');
    return;
  }
  var appLink = 'kindlelife://connect?code=' + encodeURIComponent(code);
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Hiragino Sans\',sans-serif;font-size:13px;line-height:1.7;color:#202124">' +
      '<p style="margin-top:0">下のボタンを押すと、Macアプリ「Kindle Life」が開いて自動で接続されます。</p>' +
      '<p style="text-align:center;margin:18px 0">' +
        '<a href="' + appLink + '" target="_blank" style="display:inline-block;background:#1a73e8;color:#fff;padding:10px 28px;border-radius:6px;text-decoration:none;font-weight:bold">🖥 Macアプリに接続する</a>' +
      '</p>' +
      '<p style="color:#5f6368">うまく開かない場合は、下のボタンでコードをコピーし、Macアプリの「配信」タブで「クリップボードから接続」を押してください。</p>' +
      '<p style="text-align:center;margin:10px 0">' +
        '<button onclick="copyCode()" style="padding:6px 16px;border-radius:6px;border:1px solid #dadce0;background:#fff;cursor:pointer">連携コードをコピー</button> ' +
        '<span id="done" style="color:#188038"></span>' +
      '</p>' +
      '<textarea id="code" readonly style="width:100%;height:56px;font-size:11px;color:#5f6368;border:1px solid #dadce0;border-radius:6px;box-sizing:border-box">' + code + '</textarea>' +
      '<script>' +
        'function copyCode(){' +
          'var ta=document.getElementById("code");ta.select();' +
          'try{document.execCommand("copy")}catch(e){}' +
          'if(navigator.clipboard){navigator.clipboard.writeText(ta.value).catch(function(){})}' +
          'document.getElementById("done").textContent="コピーしました";' +
        '}' +
      '<\/script>' +
    '</div>'
  ).setWidth(440).setHeight(320);
  ui.showModalDialog(html, '📱 Macアプリ連携');
}
