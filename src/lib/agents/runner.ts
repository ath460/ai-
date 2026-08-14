import Anthropic from "@anthropic-ai/sdk";
import { resolveConnectors } from "../connectors/index.ts";
import {
  claimRunSlot,
  finishRun,
  getStaff,
  getTenant,
  listApprovals,
  touchJobLastRun,
  writeAudit,
} from "../db/repo.ts";
import type { Approval, Job, Task } from "../types.ts";
import { buildSystemPrompt, buildUserPrompt } from "./prompts.ts";
import { buildTools, type AgentRunContext } from "./tools.ts";

/** AI社員が使うモデル。長時間の自律作業と日本語の文体維持の両方が要るため Opus を使う。 */
const MODEL = "claude-opus-5";

/** 1ジョブあたりのツール往復上限。暴走時のコスト上限を兼ねる。 */
const MAX_ITERATIONS = 24;

export interface RunOutcome {
  status: "succeeded" | "failed" | "skipped";
  runId: string | null;
  summary: string;
  tasks: Task[];
  approvals: Approval[];
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // ANTHROPIC_API_KEY か、ant auth login のプロファイルから解決される。
  client ??= new Anthropic();
  return client;
}

/**
 * 現在時刻をジョブのスロットへ丸める。
 *
 * cron の最小粒度が「分」なので、分単位で丸めたキーを冪等キーに使う。
 * ローカルワーカーと Vercel Cron が同じ分に叩いても、実行されるのは片方だけ。
 */
export function slotKeyFor(jobId: string, at: Date = new Date()): string {
  const iso = new Date(Math.floor(at.getTime() / 60_000) * 60_000).toISOString();
  return `${jobId}@${iso}`;
}

/**
 * ジョブを1回実行する。
 *
 * 同じスロットが既に走っていれば "skipped" を返して何もしない。
 * 例外は投げない。失敗も run レコードに残して返す（1件の失敗で
 * スケジューラ全体を止めないため）。
 */
export async function runJob(job: Job, at: Date = new Date()): Promise<RunOutcome> {
  const tenant = getTenant(job.tenantId);
  const staff = getStaff(job.tenantId, job.staffId);

  if (!tenant || !staff) {
    return {
      status: "failed",
      runId: null,
      summary: "テナントまたはAI社員が見つかりません。",
      tasks: [],
      approvals: [],
    };
  }

  const run = claimRunSlot({
    tenantId: job.tenantId,
    jobId: job.id,
    staffId: job.staffId,
    slotKey: slotKeyFor(job.id, at),
  });

  // 同一スロットを他のプロセスが既に取っている。
  if (!run) {
    return { status: "skipped", runId: null, summary: "同じ時間枠で実行済み。", tasks: [], approvals: [] };
  }

  touchJobLastRun(job.id, run.startedAt);

  const ctx: AgentRunContext = {
    tenant,
    staff,
    runId: run.id,
    connectors: resolveConnectors(tenant.id),
    tasks: [],
    approvals: [],
  };

  // 却下された下書きの理由を次回に効かせる。「直しが何度でも効く」の実体。
  const recentRejections = listApprovals(tenant.id, { status: "rejected", limit: 5 })
    .filter((a) => a.staffId === staff.id && a.rejectionReason)
    .map((a) => ({ preview: a.preview.slice(0, 80), reason: a.rejectionReason as string }));

  try {
    const runner = getClient().beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16000,
      // Claude Opus 5 では既定で思考が入るが、意図として明示しておく。
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      // 安全分類器に断られた場合、同じ呼び出しの中で代替モデルに回す。
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: buildSystemPrompt(tenant, staff),
      messages: [
        {
          role: "user",
          content: buildUserPrompt({
            jobName: job.name,
            instruction: job.instruction,
            timezone: tenant.timezone,
            recentRejections,
          }),
        },
      ],
      tools: buildTools(ctx),
      max_iterations: MAX_ITERATIONS,
    });

    let inputTokens = 0;
    let outputTokens = 0;

    // 各往復でトークンを積む。最終メッセージの usage はその1回分しか含まないため。
    for await (const message of runner) {
      inputTokens += message.usage.input_tokens ?? 0;
      outputTokens += message.usage.output_tokens ?? 0;
    }

    const finalMessage = await runner.done();

    if (finalMessage.stop_reason === "refusal") {
      const detail = finalMessage.stop_details?.explanation ?? "内容が安全ポリシーに抵触しました。";
      finishRun({ runId: run.id, status: "failed", error: detail, inputTokens, outputTokens });
      writeAudit({
        tenantId: tenant.id,
        actor: staff.name,
        action: "run.refused",
        target: run.id,
        detail,
      });
      return { status: "failed", runId: run.id, summary: detail, tasks: ctx.tasks, approvals: ctx.approvals };
    }

    const summary =
      finalMessage.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim() || "報告なし。";

    finishRun({ runId: run.id, status: "succeeded", summary, inputTokens, outputTokens });
    writeAudit({
      tenantId: tenant.id,
      actor: staff.name,
      action: "run.succeeded",
      target: run.id,
      detail: `${job.name} / タスク${ctx.tasks.length}件 / 承認待ち${ctx.approvals.length}件`,
    });

    return { status: "succeeded", runId: run.id, summary, tasks: ctx.tasks, approvals: ctx.approvals };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishRun({ runId: run.id, status: "failed", error: message });
    writeAudit({
      tenantId: tenant.id,
      actor: staff.name,
      action: "run.failed",
      target: run.id,
      detail: message,
    });
    return {
      status: "failed",
      runId: run.id,
      summary: `実行に失敗しました: ${message}`,
      tasks: ctx.tasks,
      approvals: ctx.approvals,
    };
  }
}
