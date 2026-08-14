import { closeDb } from "../src/lib/db/client.ts";
import {
  createJob,
  createStaff,
  createTenant,
  listTenants,
  upsertConnectorAccount,
  upsertNote,
} from "../src/lib/db/repo.ts";

/**
 * デモ用のシード。
 *
 * 大阪の居酒屋を想定した1テナントと、AI社員3名（営業・マーケ・事務）、
 * それぞれの定期ジョブ、店舗の申し送りを投入する。
 * 既にテナントがある場合は何もしない（誤って本番データを増やさないため）。
 */

if (listTenants().length > 0) {
  console.log("テナントが既に存在するためスキップしました。");
  console.log("入れ直す場合は data/onyx.sqlite を削除してから再実行してください。");
  closeDb();
  process.exit(0);
}

const tenant = createTenant({
  name: "炭火焼き 楓（大阪・北新地）",
  industry: "居酒屋・ダイニング",
  timezone: "Asia/Tokyo",
  settings: {
    toneOfVoice: [
      "・丁寧語だが硬すぎない。「〜でございます」より「〜です」を使う。",
      "・一文を短く。1文40字以内を目安にする。",
      "・大阪の店らしい距離の近さは残す。ただし馴れ馴れしくしない。",
      "・絵文字は使わない。感嘆符は1通に1つまで。",
      "・返信の冒頭は必ず相手の要件を一行で復唱してから本題に入る。",
    ].join("\n"),
    ngPhrases: [
      "「必ず」「絶対に」など、確約と受け取られる表現",
      "他店との比較・優劣に触れる表現",
      "在庫や仕入れの確約（「必ずご用意できます」など）",
      "割引の即答（値引きの可否は店長判断）",
    ],
    businessHours: "17:00-24:00（日曜定休）",
    // 空 = 外部発信はすべて承認を通す。ハイブリッド運用の既定値。
    autoApprove: [],
  },
});

console.log(`店舗を作成しました: ${tenant.name}`);

// ---------------------------------------------------------------- AI社員

const sales = createStaff({
  tenantId: tenant.id,
  role: "sales",
  name: "一次対応担当",
  persona: [
    "問い合わせが来てから一次返信までの時間を、営業時間外も含めて最短にすることが仕事です。",
    "予約・宴会・貸切の問い合わせが中心。条件（人数・日時・予算・アレルギー）の読み違いが最大の事故なので、",
    "返信では必ず条件を復唱します。金額の確約はせず、詰めが必要な案件は店長に回します。",
  ].join("\n"),
});

const marketing = createStaff({
  tenantId: tenant.id,
  role: "marketing",
  name: "発信担当",
  persona: [
    "投稿と原稿を途切れさせないことが仕事です。素材が薄い日でも、仕込み・季節のメニュー・店の日常から角度を見つけます。",
    "媒体ごとの文字数と体裁の差を吸収し、同じ内容でも媒体に合わせて整形します。",
    "求人原稿の掲載期限も見ています。",
  ].join("\n"),
});

const backoffice = createStaff({
  tenantId: tenant.id,
  role: "backoffice",
  name: "事務担当",
  persona: [
    "毎日発生して誰もやりたがらない作業を、店長の手元から消すのが仕事です。",
    "掲載情報の更新、日報の集計、予定の整理、定型連絡の処理を担当します。",
    "手順が固まったものは申し送りに書き残し、担当が変わっても質が落ちないようにしています。",
  ].join("\n"),
});

console.log("AI社員を3名作成しました。");

// ------------------------------------------------------------------ ジョブ

createJob({
  tenantId: tenant.id,
  staffId: sales.id,
  name: "問い合わせの一次対応",
  cron: "*/30 * * * *",
  instruction: [
    "受信箱を確認し、まだ返信していない問い合わせに一次返信の下書きを作ってください。",
    "手順:",
    "1. list_inbox で新着を確認する。",
    "2. 返信が要るものは read_email で本文を読む。",
    "3. 申し送り（search_notes）でコース内容・個室条件・定休日を確認する。",
    "4. 日程が絡むものは list_calendar で空きを見る。",
    "5. draft_email で返信の下書きを作る。相手の条件を冒頭で復唱すること。",
    "営業時間外に届いたものも同じ扱いで下書きしてください。返信の遅れが機会損失になります。",
    "金額の確約が必要な案件は、下書きを作らず log_task に blocked で残してください。",
  ].join("\n"),
});

createJob({
  tenantId: tenant.id,
  staffId: sales.id,
  name: "翌日の商談・予約の下準備",
  cron: "0 7 * * *",
  instruction: [
    "本日の予定を確認し、準備が要るものを洗い出してください。",
    "list_calendar で今日1日の予定を取得し、団体予約や商談があれば、",
    "申し送りから関連情報を引いて log_task にまとめてください。",
    "確認の連絡が要る相手がいれば draft_email で下書きを作ってください。",
  ].join("\n"),
});

createJob({
  tenantId: tenant.id,
  staffId: marketing.id,
  name: "朝のSNS投稿づくり",
  cron: "0 9 * * *",
  instruction: [
    "本日分の SNS 投稿を用意してください。",
    "申し送りから季節のメニューや仕込みの情報を引き、Instagram 向けに1本、X 向けに1本、",
    "それぞれ draft_social_post で下書きしてください。同じ文面の使い回しはしないこと。",
    "ハッシュタグは5個まで。1投稿1メッセージに絞ってください。",
  ].join("\n"),
});

createJob({
  tenantId: tenant.id,
  staffId: marketing.id,
  name: "夜の告知と翌日の仕込み",
  cron: "0 20 * * *",
  instruction: [
    "当日の残席や翌日の告知が出せるか確認し、出せるなら draft_social_post で下書きしてください。",
    "あわせて求人原稿の掲載期限が近いものがないか受信箱を確認し、",
    "期限が近ければ log_task に blocked で残してください。",
  ].join("\n"),
});

createJob({
  tenantId: tenant.id,
  staffId: backoffice.id,
  name: "掲載情報の点検",
  cron: "0 6 * * *",
  instruction: [
    "掲載媒体の情報にズレがないか点検してください。",
    "申し送りの営業時間・定休日・コース内容と、掲載中の内容を突き合わせ、",
    "更新が必要なら draft_listing_update で下書きしてください。",
    "ズレがなければ log_task に done で「点検のみ・変更なし」と残してください。",
  ].join("\n"),
});

createJob({
  tenantId: tenant.id,
  staffId: backoffice.id,
  name: "日次の集計と日報",
  cron: "30 23 * * *",
  instruction: [
    "本日の稼働を集計してください。",
    "受信した問い合わせ件数を record_metric に「問い合わせ件数」として記録し、",
    "翌日以降に持ち越す事項があれば log_task に残してください。",
    "手順として固まったものがあれば save_note に書き足してください。",
  ].join("\n"),
});

console.log("定期ジョブを6件作成しました。");

// -------------------------------------------------------------- 申し送り

const notes: Array<{ key: string; body: string }> = [
  {
    key: "基本情報",
    body: [
      "店名: 炭火焼き 楓（かえで）",
      "所在地: 大阪市北区堂島（北新地駅 徒歩4分）",
      "営業時間: 17:00-24:00（L.O. 23:00）",
      "定休日: 日曜日",
      "席数: カウンター8席 / テーブル24席 / 個室2室",
    ].join("\n"),
  },
  {
    key: "個室の利用条件",
    body: [
      "個室Aは6〜12名、個室Bは4〜8名。",
      "個室利用は2名から可能だが、金曜土曜は4名以上から。",
      "個室料は不要。ただしコース利用が条件。",
      "13名以上は個室を繋げて対応（要事前相談）。",
    ].join("\n"),
  },
  {
    key: "コース内容",
    body: [
      "楓コース 4,500円: 前菜3種・お造り・炭火焼き2品・食事・甘味（全7品）",
      "堂島コース 6,000円: 前菜5種・お造り盛り・炭火焼き4品・食事・甘味（全9品）",
      "飲み放題は +1,800円 / 2時間。日本酒の飲み放題は +2,500円。",
      "アレルギー対応は3日前までの連絡で可能。甲殻類・そば・乳は代替あり。",
    ].join("\n"),
  },
  {
    key: "貸切の扱い",
    body: [
      "貸切は20名から。金曜土曜は25名から。",
      "貸切料は不要だが、最低消費額の設定あり（金額は店長判断のため即答しない）。",
      "見積もりを求められたら、条件を確認したうえで店長に回すこと。",
    ].join("\n"),
  },
  {
    key: "返信の型",
    body: [
      "1. 相手の要件を一行で復唱する",
      "2. 答えられることを先に書く",
      "3. 確認が要ることは「確認のうえ改めてご連絡します」と書き、期限を添える",
      "4. 締めは「ご来店をお待ちしております。」",
      "署名: 炭火焼き 楓 / 06-XXXX-XXXX / 大阪市北区堂島",
    ].join("\n"),
  },
  {
    key: "季節のメニュー（現在）",
    body: [
      "秋: 秋刀魚の炭火焼き、松茸の土瓶蒸し（数量限定）、栗の甘露煮",
      "通年の看板: 大山鶏のもも炭火焼き、本日の鮮魚のお造り",
      "仕込みは16時から。仕込み風景は写真素材として使える。",
    ].join("\n"),
  },
];

for (const note of notes) {
  upsertNote({ tenantId: tenant.id, key: note.key, body: note.body });
}
console.log(`申し送りを${notes.length}件登録しました。`);

// --------------------------------------------------------- コネクタ（未接続）

upsertConnectorAccount({
  tenantId: tenant.id,
  provider: "gmail",
  accountRef: "info@kaede-dojima.example.jp",
  status: "mock",
});
upsertConnectorAccount({
  tenantId: tenant.id,
  provider: "google_calendar",
  accountRef: "primary",
  status: "mock",
});

console.log("");
console.log("完了しました。次の手順:");
console.log("  1. npm run dev            — スマホ画面を開く（http://localhost:3000）");
console.log("  2. npm run tick -- --all  — AI社員を1回まとめて動かす");
console.log("  3. npm run worker         — 24時間の自動稼働を開始する");
console.log("");
console.log(`ONYX_TENANT_ID=${tenant.id}`);

closeDb();
