import { getConnectorAccount } from "../db/repo.ts";
import { createCalendarConnector, createGmailConnector, type GoogleCredentials } from "./google.ts";
import {
  createMockCalendarConnector,
  createMockListingConnector,
  createMockMailConnector,
  createMockSocialConnector,
} from "./mock.ts";
import type { ConnectorBundle } from "./types.ts";

export * from "./types.ts";

/**
 * テナントに対して使えるコネクタ一式を解決する。
 *
 * 判定は「認証情報が揃っているか」だけ。揃っていなければモックに落ちる。
 * 落ちたことは connector.live === false で分かるので、UI は
 * 「未接続」バッジを出して人間に繋ぎ込みを促せる。
 */

function googleCredentials(tenantId: string): GoogleCredentials | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  // リフレッシュトークンはテナントごと。単一テナント運用のときだけ env で代用できる。
  const account = getConnectorAccount(tenantId, "gmail");
  const refreshToken =
    (account?.credentials.refreshToken as string | undefined) ?? process.env.GOOGLE_REFRESH_TOKEN;
  if (!refreshToken) return null;

  return {
    clientId,
    clientSecret,
    refreshToken,
    userId: (account?.credentials.userId as string | undefined) ?? "me",
    calendarId:
      (getConnectorAccount(tenantId, "google_calendar")?.credentials.calendarId as
        | string
        | undefined) ?? "primary",
  };
}

export function resolveConnectors(tenantId: string): ConnectorBundle {
  const creds = googleCredentials(tenantId);

  return {
    // Google の認証が通らないときだけモックに落とす。片方だけ落ちることはない。
    mail: creds ? createGmailConnector(creds) : createMockMailConnector(),
    calendar: creds ? createCalendarConnector(creds) : createMockCalendarConnector(),
    // SNS・MEO は接続先の仕様確認待ちのため現状スタブ。
    // 実装を差し込む場所はここ1箇所で、呼び出し側は変更不要。
    social: createMockSocialConnector(),
    listing: createMockListingConnector(),
  };
}

/** UI の「接続状況」表示用。 */
export function connectorStatus(tenantId: string): Array<{
  label: string;
  live: boolean;
  note: string;
}> {
  const bundle = resolveConnectors(tenantId);
  return [
    {
      label: "Gmail",
      live: bundle.mail.live,
      note: bundle.mail.live ? "受信・送信ともに実接続" : "モック稼働中（認証情報が未設定）",
    },
    {
      label: "Googleカレンダー",
      live: bundle.calendar.live,
      note: bundle.calendar.live ? "予定の取得・登録が実接続" : "モック稼働中（認証情報が未設定）",
    },
    { label: "SNS", live: bundle.social.live, note: "アダプタのみ実装済み（実装は後日）" },
    { label: "MEO / 掲載", live: bundle.listing.live, note: "アダプタのみ実装済み（実装は後日）" },
  ];
}
