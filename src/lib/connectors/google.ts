import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type {
  CalendarConnector,
  CalendarEvent,
  CreateEventInput,
  DispatchResult,
  InboxMessage,
  MailConnector,
  SendEmailInput,
} from "./types.ts";

/**
 * Gmail / Google カレンダーの実接続。
 *
 * 認証は「アプリ共通の OAuth クライアント + テナントごとのリフレッシュトークン」方式。
 * クライアント店舗ごとに Google アカウントが違うので、リフレッシュトークンは
 * connector_accounts テーブルに保存し、ここで受け取る。
 */

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** 'me' か、送信元にしたいメールアドレス。 */
  userId?: string;
  calendarId?: string;
}

function oauthClient(creds: GoogleCredentials): OAuth2Client {
  const client = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
  client.setCredentials({ refresh_token: creds.refreshToken });
  return client;
}

/** RFC 5322 のヘッダ値に日本語を入れるため MIME encoded-word 化する。 */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function buildRawEmail(input: SendEmailInput): string {
  const headers = [
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  if (input.inReplyTo) {
    headers.push(`In-Reply-To: ${input.inReplyTo}`, `References: ${input.inReplyTo}`);
  }
  const body = Buffer.from(input.body, "utf8").toString("base64");
  const message = `${headers.join("\r\n")}\r\n\r\n${body}`;
  // Gmail API は base64url を要求する。
  return Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function header(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  name: string,
): string {
  const found = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value ?? "";
}

export function createGmailConnector(creds: GoogleCredentials): MailConnector {
  const userId = creds.userId ?? "me";
  const gmail = google.gmail({ version: "v1", auth: oauthClient(creds) });

  return {
    kind: "gmail",
    live: true,

    async listInbox({ query, limit = 15 }) {
      const list = await gmail.users.messages.list({
        userId,
        q: query ?? "in:inbox newer_than:2d",
        maxResults: limit,
      });

      const ids = (list.data.messages ?? []).map((m) => m.id).filter((id): id is string => !!id);

      // 件名と差出人だけ欲しいので metadata フォーマットで取る（本文を引かない分速い）。
      const messages = await Promise.all(
        ids.map((id) =>
          gmail.users.messages.get({
            userId,
            id,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"],
          }),
        ),
      );

      return messages.map((res): InboxMessage => {
        const m = res.data;
        const headers = m.payload?.headers ?? undefined;
        return {
          id: m.id ?? "",
          threadId: m.threadId ?? "",
          from: header(headers, "From"),
          subject: header(headers, "Subject"),
          snippet: m.snippet ?? "",
          receivedAt: m.internalDate
            ? new Date(Number(m.internalDate)).toISOString()
            : new Date().toISOString(),
          unread: (m.labelIds ?? []).includes("UNREAD"),
        };
      });
    },

    async fetchMessage(id) {
      const res = await gmail.users.messages.get({ userId, id, format: "full" });
      const payload = res.data.payload;
      if (!payload) return null;

      // マルチパートの場合は text/plain パートを深さ優先で探す。
      const findPlain = (part: typeof payload): string | null => {
        if (part.mimeType === "text/plain" && part.body?.data) {
          return Buffer.from(part.body.data, "base64url").toString("utf8");
        }
        for (const sub of part.parts ?? []) {
          const found = findPlain(sub);
          if (found) return found;
        }
        return null;
      };

      const body = findPlain(payload) ?? res.data.snippet ?? "";
      return { body };
    },

    async send(input): Promise<DispatchResult> {
      const res = await gmail.users.messages.send({
        userId,
        requestBody: { raw: buildRawEmail(input), threadId: input.threadId },
      });
      return {
        ok: true,
        summary: `${input.to} 宛に「${input.subject}」を送信しました。`,
        externalId: res.data.id ?? undefined,
      };
    },
  };
}

export function createCalendarConnector(creds: GoogleCredentials): CalendarConnector {
  const calendarId = creds.calendarId ?? "primary";
  const calendar = google.calendar({ version: "v3", auth: oauthClient(creds) });

  return {
    kind: "google_calendar",
    live: true,

    async listEvents({ from, to }) {
      const res = await calendar.events.list({
        calendarId,
        timeMin: from,
        timeMax: to,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 50,
      });

      return (res.data.items ?? []).map((e): CalendarEvent => {
        const start = e.start?.dateTime ?? e.start?.date ?? "";
        const end = e.end?.dateTime ?? e.end?.date ?? "";
        return {
          id: e.id ?? "",
          title: e.summary ?? "(無題)",
          start,
          end,
          location: e.location ?? null,
          attendees: (e.attendees ?? [])
            .map((a) => a.email)
            .filter((v): v is string => typeof v === "string"),
        };
      });
    },

    async createEvent(input): Promise<DispatchResult> {
      const res = await calendar.events.insert({
        calendarId,
        requestBody: {
          summary: input.title,
          description: input.description,
          location: input.location,
          start: { dateTime: input.start },
          end: { dateTime: input.end },
          attendees: input.attendees?.map((email) => ({ email })),
        },
      });
      return {
        ok: true,
        summary: `「${input.title}」を ${input.start} に登録しました。`,
        externalId: res.data.id ?? undefined,
      };
    },
  };
}
