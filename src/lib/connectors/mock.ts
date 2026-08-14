import type {
  CalendarConnector,
  CalendarEvent,
  DispatchResult,
  InboxMessage,
  ListingConnector,
  MailConnector,
  SocialConnector,
} from "./types.ts";

/**
 * 認証情報が未設定のときに使うモック。
 *
 * 「繋ぎ込みが終わるまで動かせない」を避けるための層。
 * Gmail / カレンダーの資格情報を .env に入れた瞬間に実接続へ切り替わり、
 * AI社員エンジン側のコードは変わらない。
 *
 * データは大阪の飲食・美容・整体（ONYX の想定顧客層）に寄せてある。
 */

function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3600_000).toISOString();
}

const SAMPLE_INBOX: InboxMessage[] = [
  {
    id: "mock-msg-1",
    threadId: "mock-thread-1",
    from: "田中 美咲 <misaki.tanaka@example.com>",
    subject: "金曜夜の宴会について（8名）",
    snippet:
      "はじめまして。今週金曜19時から8名で予約をお願いしたいのですが、コースの内容と飲み放題の有無を教えていただけますか。アレルギー（甲殻類）が1名おります。",
    receivedAt: hoursFromNow(-9),
    unread: true,
  },
  {
    id: "mock-msg-2",
    threadId: "mock-thread-2",
    from: "株式会社ミナミ商事 佐藤 <sato@minami-shoji.example.co.jp>",
    subject: "忘年会の見積もりのお願い",
    snippet:
      "12月中旬に25〜30名규模で忘年会を検討しております。貸切は可能でしょうか。予算は一人5,000円前後を想定しています。",
    receivedAt: hoursFromNow(-14),
    unread: true,
  },
  {
    id: "mock-msg-3",
    threadId: "mock-thread-3",
    from: "求人ナビ事務局 <no-reply@kyujin-navi.example.com>",
    subject: "【自動配信】掲載中の求人原稿の有効期限が近づいています",
    snippet:
      "ご掲載中の「ホールスタッフ（アルバイト）」の原稿は3日後に掲載期限を迎えます。更新はマイページから行えます。",
    receivedAt: hoursFromNow(-20),
    unread: true,
  },
  {
    id: "mock-msg-4",
    threadId: "mock-thread-4",
    from: "山本 健一 <k.yamamoto@example.jp>",
    subject: "先日はありがとうございました",
    snippet:
      "先週伺った山本です。料理もお酒も大変美味しくいただきました。次回は個室を利用したいのですが、何名から利用できますか。",
    receivedAt: hoursFromNow(-26),
    unread: false,
  },
];

const SAMPLE_BODIES: Record<string, string> = {
  "mock-msg-1":
    "はじめまして。田中と申します。\n\n今週金曜19時から8名で予約をお願いしたいのですが、コースの内容と飲み放題の有無を教えていただけますか。\nアレルギー（甲殻類）が1名おります。対応可能でしたら合わせて教えてください。\n\nよろしくお願いいたします。",
  "mock-msg-2":
    "お世話になっております。株式会社ミナミ商事の佐藤です。\n\n12月中旬に25〜30名規模で忘年会を検討しております。\n・貸切は可能でしょうか\n・予算は一人5,000円前後を想定しています\n・日程は12/12(金)または12/19(金)を候補としています\n\nお見積もりをいただけますと幸いです。",
  "mock-msg-3":
    "ご掲載中の「ホールスタッフ（アルバイト）」の原稿は3日後に掲載期限を迎えます。\n更新はマイページから行えます。",
  "mock-msg-4":
    "先週伺った山本です。\n料理もお酒も大変美味しくいただきました。\n次回は個室を利用したいのですが、何名から利用できますか。",
};

export function createMockMailConnector(): MailConnector {
  return {
    kind: "gmail",
    live: false,
    async listInbox({ limit = 15 }) {
      return SAMPLE_INBOX.slice(0, limit);
    },
    async fetchMessage(id) {
      const body = SAMPLE_BODIES[id];
      return body ? { body } : null;
    },
    async send(input): Promise<DispatchResult> {
      return {
        ok: true,
        summary: `[モック] ${input.to} 宛に「${input.subject}」を送信したものとして記録しました。実送信はされていません。`,
        externalId: `mock-sent-${Date.now()}`,
      };
    },
  };
}

export function createMockCalendarConnector(): CalendarConnector {
  return {
    kind: "google_calendar",
    live: false,
    async listEvents(): Promise<CalendarEvent[]> {
      return [
        {
          id: "mock-evt-1",
          title: "食材業者 打ち合わせ",
          start: hoursFromNow(20),
          end: hoursFromNow(21),
          location: "店舗事務所",
          attendees: [],
        },
        {
          id: "mock-evt-2",
          title: "貸切予約（12名・上田様）",
          start: hoursFromNow(30),
          end: hoursFromNow(33),
          location: "個室A",
          attendees: [],
        },
      ];
    },
    async createEvent(input): Promise<DispatchResult> {
      return {
        ok: true,
        summary: `[モック] 「${input.title}」を ${input.start} に登録したものとして記録しました。`,
        externalId: `mock-evt-${Date.now()}`,
      };
    },
  };
}

export function createMockSocialConnector(): SocialConnector {
  return {
    kind: "social",
    live: false,
    async post(input): Promise<DispatchResult> {
      return {
        ok: true,
        summary: `[モック] ${input.platform} への投稿を記録しました（${input.body.length}文字）。実投稿はされていません。`,
        externalId: `mock-post-${Date.now()}`,
      };
    },
  };
}

export function createMockListingConnector(): ListingConnector {
  return {
    kind: "listing",
    live: false,
    async update(input): Promise<DispatchResult> {
      const fields = Object.keys(input.fields).join("・");
      return {
        ok: true,
        summary: `[モック] ${input.platform} の掲載情報（${fields}）を更新したものとして記録しました。`,
        externalId: `mock-listing-${Date.now()}`,
      };
    },
  };
}
