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

async function googleCredentials(tenantId: string): Promise<GoogleCredentials | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  // リフレッシュトークンはテナントごと。単一テナント運用のときだけ env で代用できる。
  const account = await getConnectorAccount(tenantId, "gmail");
  const refreshToken =
    (account?.credentials.refreshToken as string | undefined) ?? process.env.GOOGLE_REFRESH_TOKEN;
  if (!refreshToken) return null;

  const calendarAccount = await getConnectorAccount(tenantId, "google_calendar");

  return {
    clientId,
    clientSecret,
    refreshToken,
    userId: (account?.credentials.userId as string | undefined) ?? "me",
    calendarId: (calendarAccount?.credentials.calendarId as string | undefined) ?? "primary",
  };
}

async function instagramCredentials(tenantId: string): Promise<InstagramCredentials | null> {
  const account = await getConnectorAccount(tenantId, "instagram");

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
async function createRoutedSocialConnector(tenantId: string): Promise<SocialConnector> {
  const credentials = await instagramCredentials(tenantId);
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

export async function resolveConnectors(tenantId: string): Promise<ConnectorBundle> {
  const [creds, social] = await Promise.all([
    googleCredentials(tenantId),
    createRoutedSocialConnector(tenantId),
  ]);

  return {
    // Google の認証が通らないときだけモックに落とす。片方だけ落ちることはない。
    mail: creds ? createGmailConnector(creds) : createMockMailConnector(),
    calendar: creds ? createCalendarConnector(creds) : createMockCalendarConnector(),
    social,
    // MEO / 掲載媒体は接続先の仕様確認待ちのため現状スタブ。
    listing: createMockListingConnector(),
  };
}

/** 接続状態の確認（設定画面用）。認証情報があるときだけ実際に Meta へ問い合わせる。 */
export async function verifyInstagram(
  tenantId: string,
): Promise<{ configured: boolean; ok: boolean; detail: string }> {
  const credentials = await instagramCredentials(tenantId);
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
export async function connectorStatus(tenantId: string): Promise<
  Array<{ label: string; live: boolean; note: string }>
> {
  const bundle = await resolveConnectors(tenantId);
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
