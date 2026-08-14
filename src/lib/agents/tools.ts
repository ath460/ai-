import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import type { ConnectorBundle } from "../connectors/types.ts";
import {
  createApproval,
  createTask,
  listMediaAssets,
  mediaUrlsAreRegistered,
  recordMetric,
  searchMediaAssets,
  searchNotes,
  upsertNote,
} from "../db/repo.ts";
import { CAPTION_MAX_LENGTH, CAROUSEL_MAX_ITEMS } from "../connectors/instagram.ts";
import type { Approval, ExternalAction, RiskLevel, Staff, Task, Tenant } from "../types.ts";
import { executeAndRecord } from "./dispatch.ts";

/**
 * AI社員が使えるツール。
 *
 * 2種類しかない:
 *   1. 社内ツール  — その場で実行される（読む・書く・記録する）
 *   2. draft_* ツール — 実行されず、承認キューに積まれるだけ
 *
 * 外部に出る手段は draft_* しかない。プロンプトで「勝手に送るな」と書くのではなく、
 * 送信できるツールを渡さないことで担保している。
 */

export interface AgentRunContext {
  tenant: Tenant;
  staff: Staff;
  runId: string;
  connectors: ConnectorBundle;
  /** 実行中に積み上がった副作用。runner がラン終了時に集計する。 */
  tasks: Task[];
  approvals: Approval[];
}

/**
 * 外部発信を承認キューへ積む。
 *
 * テナント設定で autoApprove に入っているアクションだけ、その場で実行する。
 * 既定は空配列 = 全て人の承認を通す。
 */
async function enqueueExternal(
  ctx: AgentRunContext,
  input: {
    action: ExternalAction;
    preview: string;
    payload: Record<string, unknown>;
    risk: RiskLevel;
    taskTitle: string;
  },
): Promise<string> {
  const autoApproved = (ctx.tenant.settings.autoApprove ?? []).includes(input.action);

  const approval = createApproval({
    tenantId: ctx.tenant.id,
    runId: ctx.runId,
    staffId: ctx.staff.id,
    action: input.action,
    preview: input.preview,
    payload: input.payload,
    risk: input.risk,
  });
  ctx.approvals.push(approval);

  if (!autoApproved) {
    const task = createTask({
      tenantId: ctx.tenant.id,
      runId: ctx.runId,
      staffId: ctx.staff.id,
      title: input.taskTitle,
      detail: input.preview,
      status: "waiting_approval",
      approvalId: approval.id,
    });
    ctx.tasks.push(task);
    return `承認キューに登録しました（承認ID: ${approval.id}）。店長が承認するまで送信されません。`;
  }

  const result = await executeAndRecord(approval);
  const task = createTask({
    tenantId: ctx.tenant.id,
    runId: ctx.runId,
    staffId: ctx.staff.id,
    title: input.taskTitle,
    detail: result.summary,
    status: result.ok ? "done" : "blocked",
    approvalId: approval.id,
  });
  ctx.tasks.push(task);
  return result.ok
    ? `自動承認設定のため実行しました。${result.summary}`
    : `実行に失敗しました: ${result.summary}`;
}

export function buildTools(ctx: AgentRunContext) {
  // ------------------------------------------------------ 社内ツール（即実行）

  const listInbox = betaTool({
    name: "list_inbox",
    description:
      "担当店舗の受信メールを新しい順に取得する。件名・差出人・冒頭のみが返る。本文が必要なら read_email を使う。",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Gmail の検索クエリ。省略時は直近2日の受信トレイ。例: 'is:unread newer_than:1d'",
        },
        limit: { type: "number", description: "取得件数。既定15、最大30。" },
      },
      required: [],
      additionalProperties: false,
    },
    run: async ({ query, limit }) => {
      const messages = await ctx.connectors.mail.listInbox({
        query,
        limit: Math.min(limit ?? 15, 30),
      });
      if (messages.length === 0) return "受信メールはありません。";
      return JSON.stringify(messages, null, 2);
    },
  });

  const readEmail = betaTool({
    name: "read_email",
    description: "メール1件の本文を取得する。返信の下書きを作る前に必ず本文を読むこと。",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string", description: "list_inbox が返した id。" },
      },
      required: ["messageId"],
      additionalProperties: false,
    },
    run: async ({ messageId }) => {
      const message = await ctx.connectors.mail.fetchMessage(messageId);
      return message ? message.body : `メール ${messageId} が見つかりません。`;
    },
  });

  const listCalendar = betaTool({
    name: "list_calendar",
    description: "指定期間の予定を取得する。日程を提案する前に空きを確認するために使う。",
    inputSchema: {
      type: "object",
      properties: {
        fromIso: { type: "string", description: "開始日時（ISO 8601）。" },
        toIso: { type: "string", description: "終了日時（ISO 8601）。" },
      },
      required: ["fromIso", "toIso"],
      additionalProperties: false,
    },
    run: async ({ fromIso, toIso }) => {
      const events = await ctx.connectors.calendar.listEvents({ from: fromIso, to: toIso });
      if (events.length === 0) return "この期間に予定はありません。";
      return JSON.stringify(events, null, 2);
    },
  });

  const searchNotesTool = betaTool({
    name: "search_notes",
    description:
      "店舗の申し送り（メニュー、価格帯、過去の対応方針、常連客の情報、決まった手順）を検索する。判断の前にまずここを引く。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "検索語。キーと本文の部分一致で探す。" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    run: async ({ query }) => {
      const notes = searchNotes(ctx.tenant.id, query);
      if (notes.length === 0) return `「${query}」に一致する申し送りはありません。`;
      return notes.map((n) => `## ${n.key}\n${n.body}`).join("\n\n");
    },
  });

  const saveNote = betaTool({
    name: "save_note",
    description:
      "申し送りを保存・更新する。同じキーがあれば上書き。次回以降の自分と、他のAI社員が読む。",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "短い見出し。例: '個室の利用条件'" },
        body: { type: "string", description: "本文。" },
      },
      required: ["key", "body"],
      additionalProperties: false,
    },
    run: async ({ key, body }) => {
      upsertNote({ tenantId: ctx.tenant.id, staffId: ctx.staff.id, key, body });
      return `申し送り「${key}」を保存しました。`;
    },
  });

  const recordMetricTool = betaTool({
    name: "record_metric",
    description: "日次の数値を記録する。同じ日・同じキーは上書きされる。",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD 形式。" },
        key: { type: "string", description: "指標名。例: '問い合わせ件数'" },
        value: { type: "number", description: "数値。" },
        unit: { type: "string", description: "単位。例: '件', '円', '分'" },
      },
      required: ["date", "key", "value"],
      additionalProperties: false,
    },
    run: async ({ date, key, value, unit }) => {
      recordMetric({ tenantId: ctx.tenant.id, date, key, value, unit });
      return `${date} の「${key}」を ${value}${unit ?? ""} として記録しました。`;
    },
  });

  const logTask = betaTool({
    name: "log_task",
    description:
      "実際に進めた仕事を1件記録する。これが店長のスマホに出る稼働ログになる。調べただけのことは記録しない。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "何をしたか。20〜40文字程度。" },
        detail: { type: "string", description: "補足。店長が判断に使う情報だけ書く。" },
        status: {
          type: "string",
          enum: ["done", "blocked"],
          description: "完了なら done。店長の判断が要って進められないなら blocked。",
        },
      },
      required: ["title", "status"],
      additionalProperties: false,
    },
    run: async ({ title, detail, status }) => {
      const task = createTask({
        tenantId: ctx.tenant.id,
        runId: ctx.runId,
        staffId: ctx.staff.id,
        title,
        detail: detail ?? null,
        status,
      });
      ctx.tasks.push(task);
      return `稼働ログに記録しました（${status === "done" ? "完了" : "要判断"}）。`;
    },
  });

  const listMedia = betaTool({
    name: "list_media",
    description:
      "店舗に登録済みの写真を一覧・検索する。Instagram の投稿には画像が必須で、ここに載っている写真しか使えない。URLを自分で考えて書いてはいけない。",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "説明やタグに対する部分一致。省略すると新しい順に一覧を返す。",
        },
      },
      required: [],
      additionalProperties: false,
    },
    run: async ({ query }) => {
      const assets = query ? searchMediaAssets(ctx.tenant.id, query) : listMediaAssets(ctx.tenant.id);
      if (assets.length === 0) {
        return query
          ? `「${query}」に一致する写真はありません。query を省略して一覧を確認してください。`
          : "登録済みの写真がありません。画像が必要な投稿は作れないため、log_task に blocked で残してください。";
      }
      return assets
        .map((a) => `- url: ${a.url}\n  説明: ${a.description}${a.tags.length ? `\n  タグ: ${a.tags.join(", ")}` : ""}`)
        .join("\n");
    },
  });

  // ------------------------------------------- 外部発信ツール（承認キュー行き）

  const draftEmail = betaTool({
    name: "draft_email",
    description:
      "メールの下書きを作り、承認キューに積む。この時点では送信されない。店長が承認ボタンを押した瞬間に送信される前提で、完成した文面を書くこと。",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "宛先メールアドレス。" },
        subject: { type: "string", description: "件名。" },
        body: { type: "string", description: "本文。署名まで含めた完成形。" },
        threadId: { type: "string", description: "返信の場合、元スレッドのID。" },
        inReplyTo: { type: "string", description: "返信の場合、元メッセージのID。" },
        reason: { type: "string", description: "なぜこの下書きを出すのか。店長への一言。" },
      },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
    run: async ({ to, subject, body, threadId, inReplyTo, reason }) => {
      const isReply = Boolean(threadId || inReplyTo);
      return enqueueExternal(ctx, {
        action: isReply ? "reply_email" : "send_email",
        preview: `宛先: ${to}\n件名: ${subject}\n\n${body}${reason ? `\n\n— ${reason}` : ""}`,
        payload: { to, subject, body, threadId, inReplyTo },
        // 外部に出る文面は、宛先を間違えると取り返しがつかない。
        risk: "high",
        taskTitle: `${isReply ? "返信" : "メール"}下書き: ${subject}`,
      });
    },
  });

  const draftCalendarEvent = betaTool({
    name: "draft_calendar_event",
    description: "予定の登録を承認キューに積む。承認されるまでカレンダーには入らない。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "予定のタイトル。" },
        startIso: { type: "string", description: "開始日時（ISO 8601）。" },
        endIso: { type: "string", description: "終了日時（ISO 8601）。" },
        location: { type: "string", description: "場所。" },
        description: { type: "string", description: "詳細メモ。" },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "参加者のメールアドレス。",
        },
      },
      required: ["title", "startIso", "endIso"],
      additionalProperties: false,
    },
    run: async ({ title, startIso, endIso, location, description, attendees }) => {
      return enqueueExternal(ctx, {
        action: "create_calendar_event",
        preview: `${title}\n${startIso} 〜 ${endIso}${location ? `\n場所: ${location}` : ""}${
          description ? `\n\n${description}` : ""
        }`,
        payload: {
          title,
          start: startIso,
          end: endIso,
          location,
          description,
          attendees: attendees ?? [],
        },
        risk: "medium",
        taskTitle: `予定の登録: ${title}`,
      });
    },
  });

  const draftSocialPost = betaTool({
    name: "draft_social_post",
    description:
      "SNS 投稿の下書きを承認キューに積む。承認されるまで投稿されない。Instagram は画像が必須で、list_media に載っているURLしか使えない。",
    inputSchema: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          enum: ["x", "instagram", "google_business"],
          description: "投稿先。",
        },
        body: { type: "string", description: "投稿本文。ハッシュタグ込みの完成形。" },
        mediaUrls: {
          type: "array",
          items: { type: "string" },
          description:
            "添付画像のURL。list_media が返したものをそのまま使う。Instagram では1〜10枚必須。",
        },
        scheduledForIso: {
          type: "string",
          description:
            "掲載したい日時（ISO 8601）。Instagram には予約投稿の仕組みが無いため、承認された時点で公開される。",
        },
      },
      required: ["platform", "body"],
      additionalProperties: false,
    },
    run: async ({ platform, body, mediaUrls, scheduledForIso }) => {
      const media = mediaUrls ?? [];

      // Instagram だけは Meta 側の制約が厳しく、下書きの時点で弾かないと
      // 承認ボタンを押した瞬間に失敗する。店長の1タップを無駄にしない。
      if (platform === "instagram") {
        if (media.length === 0) {
          return "Instagram はテキストのみの投稿ができません。先に list_media で写真を確認し、使うURLを mediaUrls に入れてください。使える写真が無ければ、この投稿は作らず log_task に blocked で残してください。";
        }
        if (media.length > CAROUSEL_MAX_ITEMS) {
          return `Instagram のカルーセルは最大${CAROUSEL_MAX_ITEMS}枚です。${media.length}枚は多すぎます。`;
        }
        if (!mediaUrlsAreRegistered(ctx.tenant.id, media)) {
          return "登録されていない画像URLが含まれています。URLは自分で組み立てず、list_media が返したものをそのまま使ってください。";
        }
        if (body.length > CAPTION_MAX_LENGTH) {
          return `Instagram のキャプションは${CAPTION_MAX_LENGTH}文字までです（現在 ${body.length}文字）。短くしてください。`;
        }
      }

      const mediaNote = media.length > 0 ? `\n画像: ${media.length}枚` : "";
      return enqueueExternal(ctx, {
        action: "post_social",
        preview: `[${platform}]\n${body}${mediaNote}`,
        payload: { platform, body, mediaUrls: media, scheduledFor: scheduledForIso },
        risk: "medium",
        taskTitle: `${platform} 投稿の下書き`,
      });
    },
  });

  const draftListingUpdate = betaTool({
    name: "draft_listing_update",
    description:
      "掲載媒体の情報更新を承認キューに積む。営業時間・メニュー・写真などの変更に使う。承認されるまで反映されない。",
    inputSchema: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          description: "媒体名。例: 'Googleビジネスプロフィール', '食べログ'",
        },
        fields: {
          type: "object",
          description: "更新するフィールドと値の組。",
          additionalProperties: { type: "string" },
        },
      },
      required: ["platform", "fields"],
      additionalProperties: false,
    },
    run: async ({ platform, fields }) => {
      const summary = Object.entries(fields ?? {})
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      return enqueueExternal(ctx, {
        action: "update_listing",
        preview: `[${platform}]\n${summary}`,
        payload: { platform, fields },
        risk: "medium",
        taskTitle: `${platform} の掲載情報を更新`,
      });
    },
  });

  return [
    listInbox,
    readEmail,
    listCalendar,
    searchNotesTool,
    saveNote,
    recordMetricTool,
    logTask,
    listMedia,
    draftEmail,
    draftCalendarEvent,
    draftSocialPost,
    draftListingUpdate,
  ];
}
