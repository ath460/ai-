import { notFound } from "next/navigation";
import { Card, EmptyState, PageHeader, RoleBadge, SectionTitle, TaskStatusPill, timeAgo } from "@/components/ui";
import {
  getDefaultTenant,
  getStaff,
  listJobs,
  listRuns,
  listTasksByStaff,
} from "@/lib/db/repo";
import { describeCron } from "@/lib/scheduler/cron";
import { STAFF_ROLE_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getDefaultTenant();
  if (!tenant) notFound();

  const staff = await getStaff(tenant.id, id);
  if (!staff) notFound();

  const [allJobs, tasks, allRuns] = await Promise.all([
    listJobs(tenant.id),
    listTasksByStaff(tenant.id, staff.id, 40),
    listRuns(tenant.id, 60),
  ]);
  const jobs = allJobs.filter((j) => j.staffId === staff.id);
  // 事前チェックで足切りしたものは実行履歴に混ぜない。件数だけ別に出す。
  const runs = allRuns.filter((r) => r.staffId === staff.id && r.status !== "skipped");
  const skipped = allRuns.filter((r) => r.staffId === staff.id && r.status === "skipped").length;

  return (
    <main>
      <PageHeader
        eyebrow={STAFF_ROLE_LABEL[staff.role]}
        title={staff.name}
        right={<RoleBadge role={staff.role} />}
      />

      <section className="px-5">
        <Card>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[color:var(--color-text-mute)]">
            {staff.persona}
          </p>
        </Card>
      </section>

      <section className="mt-8">
        <SectionTitle count={jobs.length}>担当している業務</SectionTitle>
        <div className="space-y-2 px-5">
          {jobs.map((j) => (
            <Card key={j.id}>
              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded border border-[color:var(--color-edge)] px-1.5 py-0.5 font-mono text-[10px] text-[color:var(--color-gold)]">
                  {describeCron(j.cron)}
                </span>
                <span className="flex-1 truncate text-[14px] font-bold text-[color:var(--color-text-hi)]">
                  {j.name}
                </span>
              </div>
              <p className="mt-2 line-clamp-3 text-[12px] leading-relaxed text-[color:var(--color-text-mute)]">
                {j.instruction}
              </p>
              {j.lastRunAt ? (
                <p className="mt-2 font-mono text-[10px] text-[color:var(--color-ash)]">
                  最終実行 {timeAgo(j.lastRunAt, tenant.timezone)}
                </p>
              ) : null}
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle count={runs.length}>実行履歴</SectionTitle>
        {skipped > 0 ? (
          <p className="mb-2 px-5 text-[11px] text-[color:var(--color-ash)]">
            ほかに {skipped} 回は、やることが無いと判定して起動していません（費用なし）。
          </p>
        ) : null}
        {runs.length === 0 ? (
          <EmptyState>まだ実行されていません。</EmptyState>
        ) : (
          <ul className="space-y-2 px-5">
            {runs.slice(0, 10).map((r) => (
              <li key={r.id}>
                <Card>
                  <div className="flex items-center gap-2">
                    <span
                      className={`shrink-0 font-mono text-[10px] ${
                        r.status === "succeeded"
                          ? "text-[color:var(--color-ok)]"
                          : r.status === "failed"
                            ? "text-[color:var(--color-err)]"
                            : "text-[color:var(--color-gold)]"
                      }`}
                    >
                      {r.status === "succeeded" ? "完了" : r.status === "failed" ? "失敗" : "実行中"}
                    </span>
                    <span className="flex-1 font-mono text-[10px] text-[color:var(--color-ash)]">
                      {timeAgo(r.startedAt, tenant.timezone)}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-[color:var(--color-ash)]">
                      {(r.inputTokens + r.outputTokens).toLocaleString()} tok
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-[color:var(--color-text-body)]">
                    {r.summary ?? r.error ?? "—"}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 pb-8">
        <SectionTitle count={tasks.length}>稼働ログ</SectionTitle>
        {tasks.length === 0 ? (
          <EmptyState>まだ稼働ログはありません。</EmptyState>
        ) : (
          <ol className="space-y-2 px-5">
            {tasks.map((t) => (
              <li key={t.id}>
                <Card href={`/tasks/${t.id}`}>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 font-mono text-[11px] text-[color:var(--color-ash)]">
                      {timeAgo(t.createdAt, tenant.timezone)}
                    </span>
                    <span className="flex-1 text-[14px] leading-snug">{t.title}</span>
                    <TaskStatusPill status={t.status} />
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
