import { ApprovalCard } from "@/components/ApprovalCard";
import { SetupNotice } from "@/components/SetupNotice";
import { EmptyState, PageHeader, SectionTitle, timeAgo } from "@/components/ui";
import { getDefaultTenant, listApprovals, listStaff } from "@/lib/db/repo";
import { EXTERNAL_ACTION_LABEL } from "@/lib/types";
import { approveAction, rejectAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * 承認画面。ここが「寝ていても自動で」を成立させている場所。
 *
 * AI社員は夜のうちに下書きを積む。店長は朝、この画面を上から潰すだけで、
 * 外部に出るものだけ人の目を通したことになる。
 */
export default async function ApprovalsPage() {
  const tenant = await getDefaultTenant();
  if (!tenant) return <SetupNotice />;

  const [staff, pending, all] = await Promise.all([
    listStaff(tenant.id),
    listApprovals(tenant.id, { status: "pending", limit: 50 }),
    listApprovals(tenant.id, { limit: 30 }),
  ]);
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const recent = all.filter((a) => a.status !== "pending");

  return (
    <main>
      <PageHeader
        eyebrow="APPROVAL"
        title={pending.length > 0 ? `承認待ち ${pending.length}件` : "承認待ちなし"}
      />

      {pending.length === 0 ? (
        <EmptyState>
          すべて処理済みです。
          <br />
          AI社員が新しい下書きを作るとここに並びます。
        </EmptyState>
      ) : (
        <div className="space-y-3 px-5">
          {pending.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              staff={staffById.get(approval.staffId)}
              timeZone={tenant.timezone}
              approveAction={approveAction}
              rejectAction={rejectAction}
            />
          ))}
        </div>
      )}

      {recent.length > 0 ? (
        <section className="mt-10 pb-8">
          <SectionTitle count={recent.length}>処理済み</SectionTitle>
          <ul className="space-y-1.5 px-5">
            {recent.map((a) => (
              <li
                key={a.id}
                className="flex items-start gap-2 rounded border border-[color:var(--color-edge)] px-3 py-2"
              >
                <span
                  className={`shrink-0 font-mono text-[10px] ${
                    a.status === "executed"
                      ? "text-[color:var(--color-ok)]"
                      : a.status === "rejected"
                        ? "text-[color:var(--color-ash)]"
                        : "text-[color:var(--color-err)]"
                  }`}
                >
                  {a.status === "executed"
                    ? "送信済"
                    : a.status === "rejected"
                      ? "却下"
                      : a.status === "approved"
                        ? "承認済"
                        : "失敗"}
                </span>
                <span className="flex-1 truncate text-[12px] text-[color:var(--color-text-mute)]">
                  {EXTERNAL_ACTION_LABEL[a.action]}: {a.preview.split("\n")[0]}
                  {a.rejectionReason ? (
                    <span className="block truncate text-[11px] text-[color:var(--color-ash)]">
                      理由: {a.rejectionReason}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-[color:var(--color-ash)]">
                  {timeAgo(a.decidedAt ?? a.createdAt, tenant.timezone)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
