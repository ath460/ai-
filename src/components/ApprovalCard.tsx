"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { EXTERNAL_ACTION_LABEL, type Approval, type Staff } from "@/lib/types";
import { RoleBadge, timeAgo } from "./ui";

/**
 * 承認カード。
 *
 * 「承認する」は1タップで通す。却下だけ理由の入力を挟む
 * ——理由は次回の下書きにそのまま渡り、同じ直しを2回言わずに済むため。
 * 本文は既定でたたんでおき、宛先と件名だけ最初に見せる。
 */

const RISK_STYLE = {
  low: "text-[color:var(--color-ash)]",
  medium: "text-[color:var(--color-gold)]",
  high: "text-[color:var(--color-err)]",
} as const;

const RISK_LABEL = { low: "低", medium: "中", high: "要確認" } as const;

function SubmitButton({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: "approve" | "reject";
}) {
  const { pending } = useFormStatus();
  const base =
    "min-h-[48px] w-full rounded font-bold text-[15px] transition-opacity disabled:opacity-50";
  const style =
    variant === "approve"
      ? "bg-[linear-gradient(135deg,#E8D08A,#C9A227_60%,#9C7A1C)] text-[color:var(--color-ink)]"
      : "border border-[color:var(--color-edge)] text-[color:var(--color-text-mute)]";
  return (
    <button type="submit" disabled={pending} className={`${base} ${style}`}>
      {pending ? "処理中…" : children}
    </button>
  );
}

export function ApprovalCard({
  approval,
  staff,
  timeZone,
  approveAction,
  rejectAction,
}: {
  approval: Approval;
  staff: Staff | undefined;
  timeZone: string;
  approveAction: (formData: FormData) => Promise<void>;
  rejectAction: (formData: FormData) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const lines = approval.preview.split("\n");
  const head = lines.slice(0, 2).join("\n");
  const rest = lines.slice(2).join("\n");
  const hasMore = rest.trim().length > 0;

  return (
    <article className="rounded-lg border border-[color:var(--color-edge)] bg-[color:var(--color-stone)] p-4">
      <div className="flex items-center gap-2">
        {staff ? <RoleBadge role={staff.role} /> : null}
        <span className="flex-1 truncate text-[13px] font-bold text-[color:var(--color-text-hi)]">
          {EXTERNAL_ACTION_LABEL[approval.action]}
        </span>
        <span className={`font-mono text-[10px] ${RISK_STYLE[approval.risk]}`}>
          {RISK_LABEL[approval.risk]}
        </span>
        <span className="font-mono text-[10px] text-[color:var(--color-ash)]">
          {timeAgo(approval.createdAt, timeZone)}
        </span>
      </div>

      <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-[color:var(--color-text-body)]">
        {expanded ? approval.preview : head}
      </pre>

      {hasMore ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 min-h-[36px] font-mono text-[11px] tracking-wider text-[color:var(--color-gold)]"
        >
          {expanded ? "たたむ" : "全文を見る →"}
        </button>
      ) : null}

      {rejecting ? (
        <form action={rejectAction} className="mt-4 space-y-2">
          <input type="hidden" name="approvalId" value={approval.id} />
          <label htmlFor={`reason-${approval.id}`} className="block text-[12px] text-[color:var(--color-ash)]">
            どこを直せばよいですか（次回の下書きに反映されます）
          </label>
          <textarea
            id={`reason-${approval.id}`}
            name="reason"
            rows={2}
            autoFocus
            placeholder="例: 金額に触れないでほしい"
            className="w-full rounded border border-[color:var(--color-edge)] bg-[color:var(--color-ink)] p-3 text-[14px] text-[color:var(--color-text-body)] placeholder:text-[color:var(--color-ash)]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="min-h-[48px] flex-1 rounded border border-[color:var(--color-edge)] text-[14px] text-[color:var(--color-ash)]"
            >
              やめる
            </button>
            <div className="flex-1">
              <SubmitButton variant="reject">却下して差し戻す</SubmitButton>
            </div>
          </div>
        </form>
      ) : (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setRejecting(true)}
            className="min-h-[48px] flex-1 rounded border border-[color:var(--color-edge)] text-[15px] text-[color:var(--color-text-mute)]"
          >
            却下
          </button>
          <form action={approveAction} className="flex-[2]">
            <input type="hidden" name="approvalId" value={approval.id} />
            <SubmitButton variant="approve">承認して送信</SubmitButton>
          </form>
        </div>
      )}
    </article>
  );
}
