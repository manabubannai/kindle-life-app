/**
 * Kindle Life — 実行状態の永続化（ScriptProperties）
 *
 * シートのコピー時にScriptPropertiesは引き継がれないため、
 * コピーした新ユーザーは常にクリーンな状態から始まる（設計上の前提）。
 *
 * - processedIds: 送信済みメールID {id: 送信時刻ms}（7日で自動prune）
 * - feedGuids: フィード別の送信済み記事GUID {feedUrl: {guid: 時刻ms}}
 *   フィード単位で管理することで「後からフィードを追加したら、そのフィードだけ
 *   初回は記録のみ」が実現し、追加時の過去記事一斉配信を防ぐ
 * - lastSuccessTs: 最後にダイジェスト処理が成功した時刻（Gmail検索窓の起点）
 */

const PROCESSED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const GUIDS_PER_FEED = 300;

function loadState_() {
  const p = PropertiesService.getScriptProperties();
  let processedIds = {};
  let feedGuids = {};
  try { processedIds = JSON.parse(p.getProperty('processedIds') || '{}'); } catch (e) {}
  try { feedGuids = JSON.parse(p.getProperty('feedGuids') || '{}'); } catch (e) {}
  return {
    processedIds: processedIds,
    feedGuids: feedGuids,
    lastSuccessTs: Number(p.getProperty('lastSuccessTs')) || 0,
  };
}

function saveState_(state) {
  const p = PropertiesService.getScriptProperties();

  // メールIDは保持期間で prune
  const cutoff = Date.now() - PROCESSED_RETENTION_MS;
  const prunedIds = {};
  Object.keys(state.processedIds).forEach(function (id) {
    if (state.processedIds[id] >= cutoff) prunedIds[id] = state.processedIds[id];
  });

  // フィードGUIDは各フィード新しい順にGUIDS_PER_FEED件だけ保持
  const prunedGuids = {};
  Object.keys(state.feedGuids).forEach(function (feedUrl) {
    const guids = state.feedGuids[feedUrl];
    const keys = Object.keys(guids);
    if (keys.length > GUIDS_PER_FEED) {
      keys.sort(function (a, b) { return guids[b] - guids[a]; });
      const kept = {};
      keys.slice(0, GUIDS_PER_FEED).forEach(function (k) { kept[k] = guids[k]; });
      prunedGuids[feedUrl] = kept;
    } else {
      prunedGuids[feedUrl] = guids;
    }
  });

  p.setProperty('processedIds', JSON.stringify(prunedIds));
  p.setProperty('feedGuids', JSON.stringify(prunedGuids));
  p.setProperty('lastSuccessTs', String(state.lastSuccessTs));
}

/** 単純な文字列状態（lastRunDate / lastErrorMailDate / lastNotifiedVersion）。 */
function getStateValue_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function setStateValue_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
}

/** 登録済みでないフィード（=初回）の判定。 */
function isNewFeed_(state, feedUrl) {
  return !state.feedGuids[feedUrl];
}

/**
 * フィードURL解決キャッシュ {入力URL: 解決済みフィードURL}。
 * ブログURL→フィードURLの自動検出結果を保存し、毎回の探索fetchを省く。
 */
function loadFeedCache_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('feedUrlCache') || '{}');
  } catch (e) {
    return {};
  }
}

function saveFeedCache_(cache) {
  PropertiesService.getScriptProperties().setProperty('feedUrlCache', JSON.stringify(cache));
}

/** 取得に失敗したフィードのキャッシュを破棄する（次回の実行で再検出される）。 */
function dropFeedCacheEntry_(inputUrl) {
  const cache = loadFeedCache_();
  if (cache[inputUrl]) {
    delete cache[inputUrl];
    saveFeedCache_(cache);
  }
}
