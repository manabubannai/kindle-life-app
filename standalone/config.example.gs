/**
 * Kindle Life（スタンドアロン版）— 定数・設定
 *
 * スプレッドシートを一切使わない構成。設定はこのファイルの USER_CONFIG だけ。
 * エンジン部（main/gmail/rss/html/digest/mail/state/triggers/update）は
 * シート版と共通のコードをそのまま使い、シート由来の関数
 * （namedValue_ / readConfig_ / ensureLayout_ / writeBlogStatus_）を
 * ここで同名のスタンドアロン実装に差し替えている。
 */

const SCRIPT_VERSION = '0.3.0';

// 新版チェック先
const UPDATE_URL = 'https://raw.githubusercontent.com/manabubannai/kindle-life-app/main/version.json';

// エンドユーザー向けガイドのURL
const GUIDE_URL = 'https://github.com/manabubannai/kindle-life-app';

// ─────────────────────────────────────────────
// 設定はここだけ。書き換えたら clasp push で反映する。
// digestTitle にタイトルを書いた差出人は毎週月曜朝に1冊にまとめて届く。
// 空文字なら届き次第1件ずつ。
// ─────────────────────────────────────────────
const USER_CONFIG = {
  kindleEmail: '○○○@kindle.com', // ← あなたのSend to Kindleアドレス
  newsletters: [
    // 受け取りたいメルマガの差出人アドレス。digestTitle にタイトルを書くと
    // その差出人だけ毎週月曜の朝に1冊にまとめて届く（空文字なら1通ずつ）
    { email: 'newsletter@example.com', digestTitle: '' },
  ],
  blogs: [
    // 読みたいブログのURL（トップページでOK。フィードは自動検出）
    'https://example.com',
  ],
};

// 1回の毎時実行で送る記事数の上限。初回の溜まり分や暴走フィードでの
// 大量送信を防ぐ（残りは次の毎時実行に持ち越されるため取りこぼしはない）
const MAX_SENDS_PER_RUN = 10;

// 画像埋め込みの安全上限（Gmail添付25MBに対する予算）
const IMAGE_LIMITS = {
  maxCount: 30,
  maxTotalBytes: 20 * 1024 * 1024,
  maxSingleBytes: 5 * 1024 * 1024,
};

// 1実行の締切。GASの6分制限より手前で画像埋め込み・全文取得を打ち切り、
// 「途中で死んでメール自体が届かない」を防いで劣化送信を優先する
const EXECUTION_BUDGET_MS = 4.5 * 60 * 1000;

// 1フィードが1回の実行で配信できる記事数の上限（暴走フィード対策）
const MAX_POSTS_PER_FEED = 5;

// 週1まとめ配信の曜日（ISO: 1=月）と時刻
const DIGEST_WEEKDAY = 1;
const DIGEST_HOUR = 6;

// 救済: 最古の未送信記事がこの日数を超えたら曜日を待たずにまとめて送る
const DIGEST_OVERDUE_MS = 9 * 24 * 60 * 60 * 1000;

// 新着メールを探す最大の遡り幅
const MAX_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

// フィード・記事・画像取得時のUser-Agent。
// 一部のブログ（bearblog等）は既定のGAS UAを403でブロックするため、
// ブラウザ相当のUAを名乗る（GAS側が上書きを無視する環境でも無害）
const BROWSER_UA_ = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function timeZone_() {
  return Session.getScriptTimeZone() || 'Asia/Tokyo';
}

/** シート版のnamed range読み取りの代替。KINDLE_EMAILだけ使われる。 */
function namedValue_(name) {
  if (name === 'KINDLE_EMAIL') return USER_CONFIG.kindleEmail;
  return null;
}

/**
 * 全設定を読み取り、不備は issues に日本語で積む。
 * issues が空でなければ実行してはいけない。
 */
function readConfig_() {
  const issues = [];

  const kindleEmail = String(USER_CONFIG.kindleEmail || '').trim();
  if (!/@kindle\.com$/i.test(kindleEmail)) {
    issues.push('USER_CONFIG.kindleEmail に、あなたの @kindle.com アドレスを設定してください（Amazonの「コンテンツと端末の管理」→「設定」で確認できます）');
  }

  const newsletters = readNewsletters_(issues);
  const blogs = readBlogs_(issues);
  if (newsletters.length + blogs.length === 0) {
    issues.push('USER_CONFIG の newsletters（メルマガの差出人アドレス）または blogs（ブログのURL）に、受け取りたいものを1件以上書いてください');
  }

  return {
    kindleEmail: kindleEmail,
    newsletters: newsletters,
    blogs: blogs,
    issues: issues,
  };
}

/** USER_CONFIG.newsletters を読む。 [{email, digestTitle}] */
function readNewsletters_(issues) {
  return (USER_CONFIG.newsletters || [])
    .map(function (n) {
      return {
        email: String((n && n.email) || '').trim(),
        digestTitle: String((n && n.digestTitle) || '').trim(),
      };
    })
    .filter(function (x) {
      if (x.email === '') return false;
      if (x.email.indexOf('@') === -1) {
        if (issues) issues.push('newsletters の「' + x.email + '」はメールアドレスの形式ではありません');
        return false;
      }
      return true;
    });
}

/** USER_CONFIG.blogs を読む。 [{row, feed}]（rowはログ表示に使う通し番号） */
function readBlogs_(issues) {
  return (USER_CONFIG.blogs || [])
    .map(function (u, i) {
      return { row: i + 1, feed: String(u || '').trim() };
    })
    .filter(function (x) {
      if (x.feed === '') return false;
      if (!/^https?:\/\//i.test(x.feed)) {
        if (issues) issues.push('blogs の「' + x.feed + '」はURLの形式ではありません（https:// で始まるブログのURLを入れてください）');
        return false;
      }
      return true;
    });
}

/** シート版のレイアウト自己修復の代替。スタンドアロン版では何もしない。 */
function ensureLayout_() {}

/** シート版の「ブログURL右隣に状態表示」の代替。実行ログに残すだけ。 */
function writeBlogStatus_(row, text) {
  console.log('[Kindle Life] ブログ#' + row + ': ' + text);
}

/** 実行記録。実行ログ（Stackdriver）のみに残す。 */
function appendLog_(result, summary, detail) {
  console.log('[Kindle Life] ' + result + ': ' + summary + (detail ? ' — ' + String(detail).slice(0, 300) : ''));
}

/** 配信タイミングの説明文（案内・診断表示用）。 */
function deliveryLabel_() {
  return '新着が届き次第・1時間以内';
}

/** 「2026年7月20日（月）」形式の日付ラベル。 */
function formatDateLabel_(date) {
  const tz = timeZone_();
  const youbi = ['日', '月', '火', '水', '木', '金', '土'][Number(Utilities.formatDate(date, tz, 'u')) % 7];
  return Utilities.formatDate(date, tz, 'yyyy年M月d日') + '（' + youbi + '）';
}
