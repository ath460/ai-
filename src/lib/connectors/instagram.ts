import type { DispatchResult, SocialPostInput } from "./types.ts";

/**
 * Instagram の実接続（Meta Graph API / Content Publishing）。
 *
 * 公開は2段構えで、1リクエストでは終わらない:
 *   1. POST /{ig-user-id}/media          → コンテナを作る（画像はMeta側が image_url を取りに行く）
 *   2. GET  /{container-id}?fields=status_code → FINISHED になるまで待つ
 *   3. POST /{ig-user-id}/media_publish  → creation_id を渡して公開
 *
 * 注意点:
 * - 画像は「Meta から到達できる公開URL」でなければならない。バイト列の直接アップロードは不可。
 *   ローカルの画像や署名付きの短命URLは使えない。
 * - Instagram はテキストのみの投稿ができない。画像が必ず要る。
 * - API バージョンと1日の投稿上限は Meta 側の都合で変わる。バージョンは環境変数で差し替え可能にし、
 *   投稿上限はハードコードせず content_publishing_limit から読む。
 */

export interface InstagramCredentials {
  /** 長期アクセストークン（60日）。期限が切れる前に更新が要る。 */
  accessToken: string;
  /** Instagram プロアカウントのID（Facebookページに紐づくもの）。 */
  igUserId: string;
  /** 例: "v25.0"。未指定なら既定値を使う。 */
  graphVersion?: string;
}

/**
 * 既定の Graph API バージョン。
 * Meta は概ね四半期ごとに新バージョンを出し、古いものは約2年で廃止される。
 * 本番投入前に現行バージョンを確認し、INSTAGRAM_GRAPH_VERSION で上書きすること。
 */
const DEFAULT_GRAPH_VERSION = "v25.0";

/** 画像コンテナが FINISHED になるまでの待ち上限。動画は時間がかかるため長めに取る。 */
const CONTAINER_TIMEOUT_MS = { image: 60_000, video: 300_000 } as const;
const POLL_INTERVAL_MS = 3_000;

/** Instagram のキャプション上限。超えると API 側で弾かれる。 */
export const CAPTION_MAX_LENGTH = 2200;
export const HASHTAG_MAX_COUNT = 30;
/** カルーセルは2〜10枚。 */
export const CAROUSEL_MAX_ITEMS = 10;

interface MetaError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
  fbtrace_id?: string;
}

/** Meta のエラー本文を、承認画面にそのまま出せる日本語混じりの1行にする。 */
function formatMetaError(status: number, body: unknown): string {
  const err = (body as { error?: MetaError } | undefined)?.error;
  if (!err) return `Instagram API エラー (HTTP ${status})`;

  // error_user_msg はエンドユーザー向けにMetaが用意した説明。あればそれが一番分かりやすい。
  const main = err.error_user_msg ?? err.message ?? "詳細不明";
  const codes = [err.code, err.error_subcode].filter((c) => c !== undefined).join("/");
  return `Instagram API エラー (HTTP ${status}${codes ? `, code ${codes}` : ""}): ${main}`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createInstagramConnector(creds: InstagramCredentials) {
  const version = creds.graphVersion ?? process.env.INSTAGRAM_GRAPH_VERSION ?? DEFAULT_GRAPH_VERSION;
  const base = `https://graph.facebook.com/${version}`;

  /**
   * Graph API 呼び出し。
   * アクセストークンは常に body / POST で送る。クエリ文字列に載せると
   * プロキシやアクセスログに残るため。
   */
  async function call<T>(
    path: string,
    params: Record<string, string>,
    method: "GET" | "POST" = "POST",
  ): Promise<T> {
    const form = new URLSearchParams({ ...params, access_token: creds.accessToken });

    const url = method === "GET" ? `${base}${path}?${form.toString()}` : `${base}${path}`;
    const response = await fetch(url, {
      method,
      body: method === "POST" ? form : undefined,
      headers:
        method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
    });

    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: { message: text.slice(0, 300) } };
    }

    if (!response.ok) throw new Error(formatMetaError(response.status, body));
    return body as T;
  }

  /** 残りの投稿枠を確認する。上限値はアカウント種別で変わるため API から読む。 */
  async function remainingQuota(): Promise<{ used: number; limit: number } | null> {
    try {
      const res = await call<{ data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }> }>(
        `/${creds.igUserId}/content_publishing_limit`,
        { fields: "config,quota_usage" },
        "GET",
      );
      const row = res.data?.[0];
      if (!row) return null;
      return { used: row.quota_usage ?? 0, limit: row.config?.quota_total ?? 0 };
    } catch {
      // 枠の確認に失敗しても投稿自体は試す。ここで止めると本題を落とす。
      return null;
    }
  }

  /** コンテナが公開可能になるまで待つ。ERROR / EXPIRED は待っても直らないので即座に投げる。 */
  async function waitForContainer(containerId: string, isVideo: boolean): Promise<void> {
    const deadline = Date.now() + (isVideo ? CONTAINER_TIMEOUT_MS.video : CONTAINER_TIMEOUT_MS.image);

    while (Date.now() < deadline) {
      const res = await call<{ status_code?: string; status?: string }>(
        `/${containerId}`,
        { fields: "status_code,status" },
        "GET",
      );

      switch (res.status_code) {
        case "FINISHED":
        case "PUBLISHED":
          return;
        case "ERROR":
          throw new Error(
            `Instagram が画像の取り込みに失敗しました: ${res.status ?? "詳細不明"}。` +
              `画像URLが公開されているか、形式（JPEG推奨）とサイズを確認してください。`,
          );
        case "EXPIRED":
          throw new Error("コンテナの有効期限が切れました（作成から24時間）。作り直してください。");
        default:
          await sleep(POLL_INTERVAL_MS);
      }
    }
    throw new Error("Instagram のコンテナ生成がタイムアウトしました。時間をおいて再試行してください。");
  }

  async function createContainer(params: Record<string, string>): Promise<string> {
    const res = await call<{ id?: string }>(`/${creds.igUserId}/media`, params);
    if (!res.id) throw new Error("Instagram がコンテナIDを返しませんでした。");
    return res.id;
  }

  /** 投稿前に弾けるものは弾く。Meta に投げてから怒られるより、承認画面に理由を出すほうが速い。 */
  function validate(input: SocialPostInput): string | null {
    const media = input.mediaUrls ?? [];
    if (media.length === 0) {
      return "Instagram はテキストのみの投稿ができません。画像を1枚以上指定してください。";
    }
    if (media.length > CAROUSEL_MAX_ITEMS) {
      return `Instagram のカルーセルは最大${CAROUSEL_MAX_ITEMS}枚です（指定: ${media.length}枚）。`;
    }
    if (media.some((u) => !/^https:\/\//i.test(u))) {
      return "画像は https の公開URLである必要があります。Meta 側が取得しに行くため、ローカルのファイルは使えません。";
    }
    if (input.body.length > CAPTION_MAX_LENGTH) {
      return `キャプションが${CAPTION_MAX_LENGTH}文字を超えています（現在 ${input.body.length}文字）。`;
    }
    const hashtags = input.body.match(/#[^\s#]+/g)?.length ?? 0;
    if (hashtags > HASHTAG_MAX_COUNT) {
      return `ハッシュタグが${HASHTAG_MAX_COUNT}個を超えています（現在 ${hashtags}個）。`;
    }
    return null;
  }

  return {
    async post(input: SocialPostInput): Promise<DispatchResult> {
      const invalid = validate(input);
      if (invalid) return { ok: false, summary: invalid };

      const media = input.mediaUrls ?? [];

      try {
        const quota = await remainingQuota();
        if (quota && quota.limit > 0 && quota.used >= quota.limit) {
          return {
            ok: false,
            summary: `本日の Instagram 投稿枠を使い切っています（${quota.used}/${quota.limit}）。24時間後に再試行してください。`,
          };
        }

        const isVideo = media.some((u) => /\.(mp4|mov)(\?|$)/i.test(u));
        let containerId: string;

        if (media.length === 1) {
          // 単体投稿。動画は REELS として扱う（Instagram は通常の動画投稿を Reels に統合済み）。
          containerId = await createContainer(
            isVideo
              ? { media_type: "REELS", video_url: media[0], caption: input.body }
              : { image_url: media[0], caption: input.body },
          );
          await waitForContainer(containerId, isVideo);
        } else {
          // カルーセル。子コンテナを先に全部作ってから親を作る。
          const children: string[] = [];
          for (const url of media) {
            const childIsVideo = /\.(mp4|mov)(\?|$)/i.test(url);
            const child = await createContainer({
              is_carousel_item: "true",
              ...(childIsVideo ? { media_type: "VIDEO", video_url: url } : { image_url: url }),
            });
            await waitForContainer(child, childIsVideo);
            children.push(child);
          }
          containerId = await createContainer({
            media_type: "CAROUSEL",
            children: children.join(","),
            caption: input.body,
          });
          await waitForContainer(containerId, isVideo);
        }

        const published = await call<{ id?: string }>(`/${creds.igUserId}/media_publish`, {
          creation_id: containerId,
        });

        const quotaNote = quota ? `（本日 ${quota.used + 1}/${quota.limit} 件目）` : "";
        // 予約投稿は Content Publishing API に無い。承認したこの時点で公開される。
        const scheduleNote = input.scheduledFor
          ? ` なお Instagram API に予約投稿が無いため、${input.scheduledFor} ではなく今すぐ公開しました。`
          : "";

        return {
          ok: true,
          summary:
            `Instagram に${media.length > 1 ? `カルーセル${media.length}枚を` : ""}投稿しました${quotaNote}。` +
            scheduleNote,
          externalId: published.id,
        };
      } catch (err) {
        return { ok: false, summary: err instanceof Error ? err.message : String(err) };
      }
    },

    /** 設定画面から接続確認するために使う。 */
    async verify(): Promise<{ ok: boolean; detail: string }> {
      try {
        const me = await call<{ username?: string; id?: string }>(
          `/${creds.igUserId}`,
          { fields: "id,username" },
          "GET",
        );
        const quota = await remainingQuota();
        return {
          ok: true,
          detail:
            `@${me.username ?? me.id} に接続` +
            (quota ? `（本日の投稿 ${quota.used}/${quota.limit}）` : ""),
        };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

export type InstagramConnector = ReturnType<typeof createInstagramConnector>;
