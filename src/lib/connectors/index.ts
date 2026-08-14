import { getConnectorAccount } from "../db/repo.ts";
import { createCalendarConnector, createGmailConnector, type GoogleCredentials } from "./google.ts";
import { createInstagramConnector, type InstagramCredentials } from "./instagram.ts";
import {
  createMockCalendarConnector,
  createMockListingConnector,
  createMockMailConnector,
  createMockSocialConnector,
} from "./mock.ts";
import type { ConnectorBundle, SocialConnector, SocialPlatform } from "./types.ts";

export * from "./types.ts";

/**
 * テナントに対して使えるコネクタ一式を解決する。
 *
 * 判定は「認証情報が揃っているか」だけ。揃っていなければモックに落ちる。
 * 落ちたことは live / livePlatforms で分かるので、UI は「未接続」を出して
 * 人間に繋ぎ込みを促せる。
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

function instagramCredentials(tenantId: string): InstagramCredentials | null {
  const account = getConnectorAccount(tenantId, "instagram");

  const accessToken =
    (account?.credentials.accessToken as string | undefined) ??
    process.env.INSTAGRAM_ACCESS_TOKEN;
  const igUserId =
    (account?.credentials.igUserId as string | undefined) ?? process.env.INSTAGRAM_IG_USER_ID;

  if (!accessToken || !igUserId) return null;

  return {
    accessToken,
    igUserId,
    graphVersion: account?.credentials.graphVersion as string | undefined,
  };
}

/**
 * プラットフォームごとに接続先を振り分ける SNS コネクタ。
 *
 * 現状 Instagram だけが実接続で、X と Google ビジネスプロフィールはモックのまま。
 * 混在していることを live 1つの真偽値で潰さず、livePlatforms で個別に持つ。
 */
function createRoutedSocialConnector(tenantId: string): SocialConnector {
  const credentials = instagramCredentials(tenantId);
  const instagram = credentials ? createInstagramConnector(credentials) : null;
  const fallback = createMockSocialConnector();

  const livePlatforms: SocialPlatform[] = instagram ? ["instagram"] : [];

  return {
    kind: "social",
    live: livePlatforms.length > 0,
    livePlatforms,
    async post(input) {
      if (input.platform === "instagram" && instagram) return instagram.post(input);
      return fallback.post(input);
    },
  };
}

export function resolveConnectors(tenantId: string): ConnectorBundle {
  const creds = googleCredentials(tenantId);

  return {
    // Google の認証が通らないときだけモックに落とす。片方だけ落ちることはない。
    mail: creds ? createGmailConnector(creds) : createMockMailConnector(),
    calendar: creds ? createCalendarConnector(creds) : createMockCalendarConnector(),
    social: createRoutedSocialConnector(tenantId),
    // MEO / 掲載媒体は接続先の仕様確認待ちのため現状スタブ。
    listing: createMockListingConnector(),
  };
}

/** 接続状態の確認（設定画面用）。認証情報があるときだけ実際に Meta へ問い合わせる。 */
export async function verifyInstagram(
  tenantId: string,
): Promise<{ configured: boolean; ok: boolean; detail: string }> {
  const credentials = instagramCredentials(tenantId);
  if (!credentials) {
    return {
      configured: false,
      ok: false,
      detail: "INSTAGRAM_ACCESS_TOKEN と INSTAGRAM_IG_USER_ID が未設定です。",
    };
  }
  const result = await createInstagramConnector(credentials).verify();
  return { configured: true, ...result };
}

/** UI の「接続状況」表示用。 */
export function connectorStatus(tenantId: string): Array<{
  label: string;
  live: boolean;
  note: string;
}> {
  const bundle = resolveConnectors(tenantId);
  const igLive = bundle.social.livePlatforms.includes("instagram");

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
    {
      label: "Instagram",
      live: igLive,
      note: igLive ? "Graph API で実投稿" : "モック稼働中（認証情報が未設定）",
    },
    { label: "X", live: false, note: "アダプタのみ実装済み（実装は後日）" },
    { label: "MEO / 掲載", live: false, note: "アダプタのみ実装済み（実装は後日）" },
  ];
}
