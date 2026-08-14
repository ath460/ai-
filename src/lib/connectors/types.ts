/**
 * コネクタの共通インターフェース。
 *
 * AI社員エンジンはこの型にしか依存しない。実接続（Gmail / Google カレンダー）と
 * モックを差し替えても、エンジン側のコードは1行も変わらない。
 * SNS と MEO は現状スタブだが、同じ形なので実装を差し込むだけで本番稼働に切り替わる。
 */

export interface InboxMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  /** 本文の冒頭。全文が必要な場合は fetchMessage を使う。 */
  snippet: string;
  receivedAt: string;
  unread: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string | null;
  attendees: string[];
}

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
  /** 返信の場合に元スレッドへぶら下げる。 */
  threadId?: string;
  inReplyTo?: string;
}

export interface CreateEventInput {
  title: string;
  start: string;
  end: string;
  location?: string;
  attendees?: string[];
  description?: string;
}

export type SocialPlatform = "x" | "instagram" | "google_business";

export interface SocialPostInput {
  platform: SocialPlatform;
  body: string;
  /**
   * 画像URL。media_assets に登録済みの公開URLのみ。
   * Instagram は Meta 側が取得しに行くため、到達可能な https URL でなければならない。
   */
  mediaUrls?: string[];
  /**
   * 掲載したい日時。Instagram の Content Publishing API に予約投稿は無いため、
   * Instagram では承認された時点で公開される（この値は記録と表示にのみ使う）。
   */
  scheduledFor?: string;
}

export interface ListingUpdateInput {
  /** 食べログ・ホットペッパー・Googleビジネスプロフィールなどの識別子。 */
  platform: string;
  fields: Record<string, string>;
}

/** 外部発信の実行結果。承認画面に結果を戻すために使う。 */
export interface DispatchResult {
  ok: boolean;
  summary: string;
  externalId?: string;
}

export interface MailConnector {
  readonly kind: "gmail";
  readonly live: boolean;
  listInbox(opts: { query?: string; limit?: number }): Promise<InboxMessage[]>;
  fetchMessage(id: string): Promise<{ body: string } | null>;
  send(input: SendEmailInput): Promise<DispatchResult>;
}

export interface CalendarConnector {
  readonly kind: "google_calendar";
  readonly live: boolean;
  listEvents(opts: { from: string; to: string }): Promise<CalendarEvent[]>;
  createEvent(input: CreateEventInput): Promise<DispatchResult>;
}

export interface SocialConnector {
  readonly kind: "social";
  /** いずれか1つでも実接続なら true。 */
  readonly live: boolean;
  /** 実接続になっているプラットフォーム。UI の接続状況表示に使う。 */
  readonly livePlatforms: SocialPlatform[];
  post(input: SocialPostInput): Promise<DispatchResult>;
}

export interface ListingConnector {
  readonly kind: "listing";
  readonly live: boolean;
  update(input: ListingUpdateInput): Promise<DispatchResult>;
}

export interface ConnectorBundle {
  mail: MailConnector;
  calendar: CalendarConnector;
  social: SocialConnector;
  listing: ListingConnector;
}
