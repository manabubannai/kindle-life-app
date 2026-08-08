/**
 * Kindle Life — 定数・設定読み取り・シートアクセス
 *
 * UIは1タブ構成。ユーザーが入力するのは赤枠の3箇所だけ
 * （Kindleアドレス / メルマガ差出人リスト / ブログURLリスト）。
 * 入力エリアはnamed range（KINDLE_EMAIL / NEWSLETTER_LIST / BLOG_LIST）経由で
 * 読み書きし、行の挿入や見た目の変更に耐える。
 *
 * 配信タイミングなどのオプションは持たない（シンプルさ優先で固定値）。
 */

const SCRIPT_VERSION = '0.3.0';

// 新版チェック先（GitHub公開時に実URLへ差し替える）
const UPDATE_URL = 'https://raw.githubusercontent.com/manabubannai/kindle-life-app/main/version.json';

// エンドユーザー向けガイドのURL（公開時に差し替える）
const GUIDE_URL = 'https://github.com/manabubannai/kindle-life-app';

// UIタブ（1枚だけ）
const SHEET_MAIN = 'Kindle Life';

// シート上部のキャッチコピー（B3）。dev.gsの構築で使う
// （説明文はシート上のデザインが正。コードからは書き換えない）
const SHEET_TAGLINE = 'メルマガとブログを、届いた順に1件ずつKindleへ。';

// 1回の毎時実行で送る記事数の上限。初回の溜まり分や暴走フィードでの
// 大量送信を防ぐ（残りは次の毎時実行に持ち越されるため取りこぼしはない）
const MAX_SENDS_PER_RUN = 10;

// 画像埋め込みの安全上限（Gmail添付25MBに対する予算。既存2ツールから踏襲）
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

// 週1まとめ配信: シートでまとめタイトルを指定した差出人は、
// 毎週この曜日（ISO: 1=月）のこの時刻以降の最初の実行で、1冊にまとめて届く
const DIGEST_WEEKDAY = 1;
const DIGEST_HOUR = 6;

// 救済: 実行停止などで月曜に送れなかった場合、最古の未送信記事が
// この日数を超えたら曜日を待たずにまとめて送る（貯めっぱなし防止）
const DIGEST_OVERDUE_MS = 9 * 24 * 60 * 60 * 1000;

// 新着メールを探す最大の遡り幅。実行が数日止まっていた場合でも、
// 再開時にここまでの新着は拾う（それ以前の分は大量送信を防ぐため見送る）
const MAX_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

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

/**
 * メルマガ入力エリア（NEWSLETTER_LIST）を読む。書いてある行が有効。 [{email, digestTitle}]
 * 右隣の列（NEWSLETTER_DIGEST_TITLES）にタイトルが書いてある差出人は
 * 週1まとめ配信（digestTitleがそのまま1冊の書名の元になる）。空欄なら届き次第個別。
 */
function readNewsletters_(issues) {
  const range = ss_().getRangeByName('NEWSLETTER_LIST');
  if (!range) return [];
  const titleRange = ss_().getRangeByName('NEWSLETTER_DIGEST_TITLES');
  const titleValues = titleRange ? titleRange.getValues() : [];
  return range
    .getValues()
    .map(function (r, i) {
      // セル内画像などの非文字列は空扱い（説明画像が範囲に入っても壊れない）
      const raw = r[0] !== null && typeof r[0] === 'object' ? '' : r[0];
      return {
        email: String(raw || '').trim(),
        digestTitle: String((titleValues[i] && titleValues[i][0]) || '').trim(),
      };
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
      const raw = r[0] !== null && typeof r[0] === 'object' ? '' : r[0];
      return { row: firstRow + i, feed: String(raw || '').trim() };
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
/**
 * 入力用named rangeの自己修復。
 * シートの「①」「②」「③」で始まる見出しセルを探し、その位置を基準に
 * KINDLE_EMAIL / NEWSLETTER_LIST / BLOG_LIST / NEWSLETTER_DIGEST_TITLES を張り直す。
 * デザイン変更（行・列の移動、テンプレの作り直し）をしてもコードが追従できる。
 * - ① の直下1セル = Kindleアドレス
 * - ② の直下〜40行 = メルマガ差出人
 * - ③ の直下〜40行 = ブログURL（状態表示はその右隣）
 * - 週1まとめタイトルは②の右隣。ただしそこが③の列なら隠しH列に置く
 * 見出しが見つからない・すでに正しい位置なら何もしない。
 */
function ensureLayout_() {
  const ss = ss_();
  const sheet = ss.getSheetByName(SHEET_MAIN);
  if (!sheet) return;
  const ROWS = 40;

  const scan = sheet.getRange(1, 1, Math.min(sheet.getMaxRows(), 30), Math.min(sheet.getMaxColumns(), 10)).getValues();
  let h1 = null, h2 = null, h3 = null;
  for (let r = 0; r < scan.length; r++) {
    for (let c = 0; c < scan[r].length; c++) {
      const v = String(scan[r][c] || '').trim();
      if (!h1 && v.lastIndexOf('①', 0) === 0) h1 = { row: r + 2, col: c + 1 };
      if (!h2 && v.lastIndexOf('②', 0) === 0) h2 = { row: r + 2, col: c + 1 };
      if (!h3 && v.lastIndexOf('③', 0) === 0) h3 = { row: r + 2, col: c + 1 };
    }
  }
  if (!h1 || !h2 || !h3) return;
  const digestCol = h2.col + 1 === h3.col ? 8 : h2.col + 1;

  // シートの行数・列数が足りない場合は範囲をはみ出させない（例外→サイレント失敗を防ぐ）
  // さらに見出しの下に説明画像などの「文字列でないセル」があれば、入力範囲はその手前まで
  const usableRows = function (row, col) {
    const cap = Math.max(1, Math.min(ROWS, sheet.getMaxRows() - row + 1));
    const vals = sheet.getRange(row, col, cap, 1).getValues();
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i][0];
      if (v !== '' && v !== null && typeof v === 'object') return Math.max(1, i);
    }
    return cap;
  };
  const nlRows = usableRows(h2.row, h2.col);
  const blRows = usableRows(h3.row, h3.col);
  if (digestCol > sheet.getMaxColumns()) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), digestCol - sheet.getMaxColumns());
  }

  // 張り替え前に週1まとめタイトルを退避（差出人アドレス→タイトル）
  const titles = {};
  try {
    const oldList = ss.getRangeByName('NEWSLETTER_LIST');
    const oldTitles = ss.getRangeByName('NEWSLETTER_DIGEST_TITLES');
    if (oldList && oldTitles) {
      const es = oldList.getValues();
      const ts = oldTitles.getValues();
      for (let i = 0; i < Math.min(es.length, ts.length); i++) {
        const e = String(es[i][0] || '').trim();
        const t = String(ts[i][0] || '').trim();
        if (e && t) titles[e.toLowerCase()] = t;
      }
    }
  } catch (e) { /* 退避失敗は無視（初回構築時など） */ }

  ss.setNamedRange('KINDLE_EMAIL', sheet.getRange(h1.row, h1.col));
  ss.setNamedRange('NEWSLETTER_LIST', sheet.getRange(h2.row, h2.col, nlRows, 1));
  ss.setNamedRange('BLOG_LIST', sheet.getRange(h3.row, h3.col, blRows, 1));
  ss.setNamedRange('NEWSLETTER_DIGEST_TITLES', sheet.getRange(h2.row, digestCol, nlRows, 1));
  if (digestCol === 8) sheet.hideColumns(digestCol);

  // 旧位置に残った入力規則の赤マークとセルメモを消し、新しい入力欄に張り直す
  sheet.getDataRange().clearDataValidations();
  sheet.getDataRange().clearNote();
  const kindleA1 = sheet.getRange(h1.row, h1.col).getA1Notation();
  sheet.getRange(h1.row, h1.col).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireFormulaSatisfied('=OR(ISBLANK(' + kindleA1 + '),REGEXMATCH(TO_TEXT(' + kindleA1 + '),"@kindle\\.com$"))')
      .setAllowInvalid(true)
      .setHelpText('@kindle.com で終わるアドレスを入力してください')
      .build()
  );
  const nlA1 = sheet.getRange(h2.row, h2.col).getA1Notation();
  sheet.getRange(h2.row, h2.col, nlRows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireFormulaSatisfied('=OR(ISBLANK(' + nlA1 + '),ISEMAIL(' + nlA1 + '))')
      .setAllowInvalid(true)
      .setHelpText('メルマガの「差出人」のメールアドレスを貼り付けてください')
      .build()
  );
  const blA1 = sheet.getRange(h3.row, h3.col).getA1Notation();
  sheet.getRange(h3.row, h3.col, blRows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireFormulaSatisfied('=OR(ISBLANK(' + blA1 + '),REGEXMATCH(TO_TEXT(' + blA1 + '),"^https?://"))')
      .setAllowInvalid(true)
      .setHelpText('https:// で始まるブログのURLを入れてください')
      .build()
  );

  // 退避したタイトルを新しい位置へ書き戻す
  if (Object.keys(titles).length > 0) {
    const emails = sheet.getRange(h2.row, h2.col, nlRows, 1).getValues();
    const out = emails.map(function (r) {
      return [titles[String(r[0] || '').trim().toLowerCase()] || ''];
    });
    sheet.getRange(h2.row, digestCol, nlRows, 1).setValues(out);
  }
  // メインタブ以外（説明用など）は誤編集防止の保護をかける（編集しようとすると警告）
  ss.getSheets().forEach(function (sh) {
    if (sh.getName() === SHEET_MAIN) return;
    if (sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length > 0) return;
    sh.protect().setWarningOnly(true).setDescription('Kindle Life: このタブは編集不要です');
  });

  appendLog_('レイアウト', '入力欄の位置をシートの見出しに合わせて更新', '');
}

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
