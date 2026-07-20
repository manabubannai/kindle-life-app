/**
 * Kindle Life — 定数・設定読み取り・シートアクセス
 *
 * UIは1タブ構成。ユーザーが入力するのは赤枠の3箇所だけ
 * （Kindleアドレス / メルマガ差出人リスト / ブログURLリスト）。
 * 入力エリアはnamed range（KINDLE_EMAIL / NEWSLETTER_LIST / BLOG_LIST）経由で
 * 読み書きし、行の挿入や見た目の変更に耐える。
 *
 * 配信時間帯などのオプションは持たない（シンプルさ優先で固定値）。
 */

const SCRIPT_VERSION = '0.1.0';

// 新版チェック先（GitHub公開時に実URLへ差し替える）
const UPDATE_URL = 'https://raw.githubusercontent.com/manabubannai/kindle-life-app/main/version.json';

// エンドユーザー向けガイドのURL（公開時に差し替える）
const GUIDE_URL = 'https://github.com/manabubannai/kindle-life-app';

// UIタブ（1枚だけ）
const SHEET_MAIN = 'Kindle Life';

// 配信時間帯（この時以降の毎時チェックで1日1回送る）。オプション化せず朝5時固定
const DIGEST_HOUR = 5;

// 画像埋め込みの安全上限（Gmail添付25MBに対する予算。既存2ツールから踏襲）
const IMAGE_LIMITS = {
  maxCount: 30,
  maxTotalBytes: 20 * 1024 * 1024,
  maxSingleBytes: 5 * 1024 * 1024,
};

// 1実行の締切。GASの6分制限より手前で画像埋め込み・全文取得を打ち切り、
// 「途中で死んでメール自体が届かない」を防いで劣化送信を優先する
const EXECUTION_BUDGET_MS = 4.5 * 60 * 1000;

// 1フィードが1日に配信できる記事数の上限（暴走フィード対策）
const MAX_POSTS_PER_FEED = 5;

// 新着メールを探す最大の遡り幅（前回実行が失敗した日があっても翌日拾う）
const MAX_WINDOW_MS = 48 * 60 * 60 * 1000;

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function timeZone_() {
  return ss_().getSpreadsheetTimeZone() || 'Asia/Tokyo';
}

function namedValue_(name) {
  const range = ss_().getRangeByName(name);
  return range ? range.getValue() : null;
}

/**
 * 全設定を読み取り、不備は issues に日本語で積む。
 * issues が空でなければ実行してはいけない。
 */
function readConfig_() {
  const issues = [];

  const kindleEmail = String(namedValue_('KINDLE_EMAIL') || '').trim();
  if (!/@kindle\.com$/i.test(kindleEmail)) {
    issues.push('①のセルに、あなたの @kindle.com アドレスを入力してください（Amazonの「コンテンツと端末の管理」→「設定」で確認できます）');
  }

  const newsletters = readNewsletters_(issues);
  const blogs = readBlogs_(issues);
  if (newsletters.length + blogs.length === 0) {
    issues.push('②（メルマガの差出人アドレス）または③（ブログのURL）に、受け取りたいものを1件以上書いてください');
  }

  return {
    kindleEmail: kindleEmail,
    newsletters: newsletters,
    blogs: blogs,
    issues: issues,
  };
}

/** メルマガ入力エリア（NEWSLETTER_LIST）を読む。書いてある行が有効。 [{email}] */
function readNewsletters_(issues) {
  const range = ss_().getRangeByName('NEWSLETTER_LIST');
  if (!range) return [];
  return range
    .getValues()
    .map(function (r) {
      return { email: String(r[0] || '').trim() };
    })
    .filter(function (x) {
      if (x.email === '') return false;
      if (x.email.indexOf('@') === -1) {
        if (issues) issues.push('メルマガ欄の「' + x.email + '」はメールアドレスの形式ではありません');
        return false;
      }
      return true;
    });
}

/** ブログ入力エリア（BLOG_LIST）を読む。書いてある行が有効。 [{row, feed}]（rowは状態表示に使う） */
function readBlogs_(issues) {
  const range = ss_().getRangeByName('BLOG_LIST');
  if (!range) return [];
  const firstRow = range.getRow();
  return range
    .getValues()
    .map(function (r, i) {
      return { row: firstRow + i, feed: String(r[0] || '').trim() };
    })
    .filter(function (x) {
      if (x.feed === '') return false;
      if (!/^https?:\/\//i.test(x.feed)) {
        if (issues) issues.push('ブログ欄の「' + x.feed + '」はURLの形式ではありません（https:// で始まるブログのURLを入れてください）');
        return false;
      }
      return true;
    });
}

/** ブログURLの右隣のセルに取得結果（ブログ名・エラー）を書く。 */
function writeBlogStatus_(row, text) {
  try {
    const range = ss_().getRangeByName('BLOG_LIST');
    if (!range) return;
    range.getSheet().getRange(row, range.getColumn() + 1).setValue(text);
  } catch (e) {
    console.error('ブログ状態の書き込み失敗: ' + e);
  }
}

/** 実行記録。ログタブは持たないので実行ログ（Stackdriver）のみに残す。 */
function appendLog_(result, summary, detail) {
  console.log('[Kindle Life] ' + result + ': ' + summary + (detail ? ' — ' + String(detail).slice(0, 300) : ''));
}

/** 「2026年7月20日（月）」形式の日付ラベル。 */
function formatDateLabel_(date) {
  const tz = timeZone_();
  const youbi = ['日', '月', '火', '水', '木', '金', '土'][Number(Utilities.formatDate(date, tz, 'u')) % 7];
  return Utilities.formatDate(date, tz, 'yyyy年M月d日') + '（' + youbi + '）';
}
