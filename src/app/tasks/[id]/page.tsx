import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader, RoleBadge, SectionTitle, TaskStatusPill, timeAgo } from "@/components/ui";
import { getApproval, getDefaultTenant, getRun, getStaff, getTask } from "@/lib/db/repo";
import { EXTERNAL_ACTION_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 稼働ログ1件の詳細。何を根拠にAI社員がそう動いたかまで辿れるようにする。 */
export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = getDefaultTenant();
  if (!tenant) notFound();

  const task = getTask(tenant.id, id);
  if (!task) notFound();

  const staff = getStaff(tenant.id, task.staffId);
  const run = getRun(tenant.id, task.runId);
  const approval = task.approvalId ? getApproval(tenant.id, task.approvalId) : null;

  return (
    <main>
      <PageHeader
        eyebrow="TASK"
        title={task.title}
        right={<TaskStatusPill status={task.status} />}
      />

      <section className="space-y-2 px-5">
        <div className="flex items-center gap-2">
          {staff ? <RoleBadge role={staff.role} /> : null}
          <span className="text-[13px] text-[color:var(--color-text-mute)]">{staff?.name}</span>
          <span className="font-mono text-[11px] text-[color:var(--color-ash)]">
            {timeAgo(task.createdAt, tenant.timezone)}
          </span>
        </div>

        {task.detail ? (
          <Card>
            <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-[color:var(--color-text-body)]">
              {task.detail}
            </pre>
          </Card>
        ) : null}
      </section>

      {approval ? (
        <section className="mt-8">
          <SectionTitle>紐づく承認</SectionTitle>
          <div className="px-5">
            <Card href={approval.status === "pending" ? "/approvals" : undefined}>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[13px] font-bold text-[color:var(--color-text-hi)]">
                  {EXTERNAL_ACTION_LABEL[approval.action]}
                </span>
                <span className="font-mono text-[10px] text-[color:var(--color-gold)]">
                  {approval.status === "pending" ? "承認待ち →" : approval.status}
                </span>
              </div>
              {approval.rejectionReason ? (
                <p className="mt-2 text-[12px] text-[color:var(--color-ash)]">
                  却下理由: {approval.rejectionReason}
                </p>
              ) : null}
              {approval.resultSummary ? (
                <p className="mt-2 text-[12px] text-[color:var(--color-text-mute)]">
                  {approval.resultSummary}
                </p>
              ) : null}
            </Card>
          </div>
        </section>
      ) : null}

      {run ? (
        <section className="mt-8 pb-8">
          <SectionTitle>この稼働の報告</SectionTitle>
          <div className="px-5">
            <Card>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[color:var(--color-text-body)]">
                {run.summary ?? run.error ?? "—"}
              </p>
              <p className="mt-3 font-mono text-[10px] text-[color:var(--color-ash)]">
                {timeAgo(run.startedAt, tenant.timezone)} 開始 /{" "}
                {(run.inputTokens + run.outputTokens).toLocaleString()} tok
              </p>
            </Card>
            {staff ? (
              <Link
                href={`/staff/${staff.id}`}
                className="mt-3 block text-center font-mono text-[11px] tracking-wider text-[color:var(--color-gold)]"
              >
                {staff.name} の稼働をすべて見る →
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
