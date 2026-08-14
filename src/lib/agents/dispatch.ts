import { resolveConnectors } from "../connectors/index.ts";
import type { DispatchResult } from "../connectors/types.ts";
import { markApprovalExecuted, writeAudit } from "../db/repo.ts";
import type { Approval } from "../types.ts";

/**
 * 承認済みアクションの実行。
 *
 * ここが「外部に出る」唯一の出口。AI社員エンジンからは直接呼ばれず、
 * 人が承認したとき（またはテナント設定で自動承認されたとき）にのみ通る。
 */

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export async function executeApproval(approval: Approval): Promise<DispatchResult> {
  const connectors = await resolveConnectors(approval.tenantId);
  const p = approval.payload;

  switch (approval.action) {
    case "send_email":
    case "reply_email":
      return connectors.mail.send({
        to: asString(p.to),
        subject: asString(p.subject),
        body: asString(p.body),
        threadId: typeof p.threadId === "string" ? p.threadId : undefined,
        inReplyTo: typeof p.inReplyTo === "string" ? p.inReplyTo : undefined,
      });

    case "create_calendar_event":
      return connectors.calendar.createEvent({
        title: asString(p.title),
        start: asString(p.start),
        end: asString(p.end),
        location: typeof p.location === "string" ? p.location : undefined,
        attendees: asStringArray(p.attendees),
        description: typeof p.description === "string" ? p.description : undefined,
      });

    case "post_social": {
      const platform = asString(p.platform, "x");
      return connectors.social.post({
        platform: (["x", "instagram", "google_business"].includes(platform)
          ? platform
          : "x") as "x" | "instagram" | "google_business",
        body: asString(p.body),
        mediaUrls: asStringArray(p.mediaUrls),
        scheduledFor: typeof p.scheduledFor === "string" ? p.scheduledFor : undefined,
      });
    }

    case "update_listing":
      return connectors.listing.update({
        platform: asString(p.platform),
        fields:
          p.fields && typeof p.fields === "object"
            ? (p.fields as Record<string, string>)
            : {},
      });

    default: {
      // 型上は到達しないが、DB に未知の action が入っていた場合の保険。
      const unknownAction: string = approval.action;
      return { ok: false, summary: `未対応のアクションです: ${unknownAction}` };
    }
  }
}

/**
 * 実行して結果を承認レコードに書き戻す。失敗しても例外は投げず、
 * failed として記録する（1件の送信失敗で承認処理全体を落とさない）。
 */
export async function executeAndRecord(approval: Approval): Promise<DispatchResult> {
  try {
    const result = await executeApproval(approval);
    await markApprovalExecuted({
      approvalId: approval.id,
      status: result.ok ? "executed" : "failed",
      resultSummary: result.summary,
    });
    await writeAudit({
      tenantId: approval.tenantId,
      actor: "system",
      action: result.ok ? "approval.executed" : "approval.failed",
      target: approval.id,
      detail: result.summary,
    });
    return result;
  } catch (err) {
    const summary = err instanceof Error ? err.message : String(err);
    await markApprovalExecuted({ approvalId: approval.id, status: "failed", resultSummary: summary });
    await writeAudit({
      tenantId: approval.tenantId,
      actor: "system",
      action: "approval.failed",
      target: approval.id,
      detail: summary,
    });
    return { ok: false, summary };
  }
}
