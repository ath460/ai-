"use server";

import { revalidatePath } from "next/cache";
import { executeAndRecord } from "@/lib/agents/dispatch";
import {
  decideApproval,
  getApproval,
  getDefaultTenant,
  setTaskStatusByApproval,
  writeAudit,
} from "@/lib/db/repo";

/**
 * 承認・却下のサーバーアクション。
 *
 * 二重タップ対策は decideApproval 側（pending のときだけ遷移する UPDATE）。
 * ここで false が返ったら、既に誰かが処理済みなので何もしない。
 */

function currentActor(): string {
  // 認証を入れるまでの暫定。ログイン実装時はセッションから取る。
  return process.env.ONYX_OPERATOR_NAME ?? "店長";
}

export async function approveAction(formData: FormData): Promise<void> {
  const approvalId = String(formData.get("approvalId") ?? "");
  const tenant = getDefaultTenant();
  if (!tenant || !approvalId) return;

  const claimed = decideApproval({
    tenantId: tenant.id,
    approvalId,
    decision: "approved",
    decidedBy: currentActor(),
  });
  if (!claimed) return;

  const approval = getApproval(tenant.id, approvalId);
  if (!approval) return;

  const result = await executeAndRecord(approval);
  setTaskStatusByApproval(tenant.id, approvalId, result.ok ? "done" : "blocked", result.summary);

  writeAudit({
    tenantId: tenant.id,
    actor: currentActor(),
    action: "approval.approved",
    target: approvalId,
    detail: approval.preview.slice(0, 200),
  });

  revalidatePath("/approvals");
  revalidatePath("/");
}

export async function rejectAction(formData: FormData): Promise<void> {
  const approvalId = String(formData.get("approvalId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const tenant = getDefaultTenant();
  if (!tenant || !approvalId) return;

  const claimed = decideApproval({
    tenantId: tenant.id,
    approvalId,
    decision: "rejected",
    decidedBy: currentActor(),
    // 理由は次回の下書きにそのまま渡る。空でも却下自体は通す。
    rejectionReason: reason || "理由の記載なし",
  });
  if (!claimed) return;

  setTaskStatusByApproval(
    tenant.id,
    approvalId,
    "blocked",
    reason ? `却下: ${reason}` : "却下されました。",
  );

  writeAudit({
    tenantId: tenant.id,
    actor: currentActor(),
    action: "approval.rejected",
    target: approvalId,
    detail: reason,
  });

  revalidatePath("/approvals");
  revalidatePath("/");
}
