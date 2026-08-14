import { SetupNotice } from "@/components/SetupNotice";
import { Card, PageHeader, RoleBadge, timeAgo } from "@/components/ui";
import { getDefaultTenant, listJobs, listStaff, listTasksByStaff } from "@/lib/db/repo";
import { describeCron } from "@/lib/scheduler/cron";

export const dynamic = "force-dynamic";

export default function StaffListPage() {
  const tenant = getDefaultTenant();
  if (!tenant) return <SetupNotice />;

  const staff = listStaff(tenant.id);
  const jobs = listJobs(tenant.id);

  return (
    <main>
      <PageHeader eyebrow="STAFF" title="AI社員" />
      <div className="space-y-3 px-5 pb-8">
        {staff.map((s) => {
          const myJobs = jobs.filter((j) => j.staffId === s.id);
          const last = listTasksByStaff(tenant.id, s.id, 1)[0];
          return (
            <Card key={s.id} href={`/staff/${s.id}`}>
              <div className="flex items-center gap-2">
                <RoleBadge role={s.role} />
                <span className="flex-1 truncate text-[15px] font-bold text-[color:var(--color-text-hi)]">
                  {s.name}
                </span>
                <span
                  className={`font-mono text-[10px] ${
                    s.enabled ? "text-[color:var(--color-ok)]" : "text-[color:var(--color-ash)]"
                  }`}
                >
                  {s.enabled ? "稼働中" : "停止中"}
                </span>
              </div>

              <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-[color:var(--color-text-mute)]">
                {s.persona}
              </p>

              <ul className="mt-3 space-y-1">
                {myJobs.map((j) => (
                  <li key={j.id} className="flex items-center gap-2 text-[11px]">
                    <span className="font-mono text-[color:var(--color-gold)]">
                      {describeCron(j.cron)}
                    </span>
                    <span className="truncate text-[color:var(--color-ash)]">{j.name}</span>
                  </li>
                ))}
              </ul>

              {last ? (
                <p className="mt-3 truncate border-t border-[color:var(--color-edge)] pt-2 text-[11px] text-[color:var(--color-ash)]">
                  最終稼働 {timeAgo(last.createdAt, tenant.timezone)}: {last.title}
                </p>
              ) : null}
            </Card>
          );
        })}
      </div>
    </main>
  );
}
