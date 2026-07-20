/**
 * Kindle Life — トリガー管理
 *
 * トリガーは毎時1本だけ（hourlyTick）。配信時刻の判定はhourlyTick内の
 * ゲートで行うため、設定変更時の張り替えは不要。
 * 既存の同名ハンドラを全削除してから作り直すので、何度実行しても安全。
 */

function ensureHourlyTrigger_() {
  deleteOwnTriggers_();
  ScriptApp.newTrigger('hourlyTick').timeBased().everyHours(1).create();
}

function deleteOwnTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'hourlyTick') ScriptApp.deleteTrigger(t);
  });
}

function hasHourlyTrigger_() {
  return ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'hourlyTick';
  });
}
