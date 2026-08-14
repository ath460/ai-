import Link from "next/link";
import { SetupNotice } from "@/components/SetupNotice";
import {
  Card,
  EmptyState,
  PageHeader,
  RoleBadge,
  SectionTitle,
  TaskStatusPill,
  timeAgo,
} from "@/components/ui";
import { connectorStatus } from "@/lib/connectors";
import {
  countPendingApprovals,
  getDefaultTenant,
  listRuns,
  listStaff,
  listTasks,
} from "@/lib/db/repo";
import { startOfTodayIso } from "@/lib/view";

export const dynamic = "force-dynamic";

/**
 * ホーム =「今日、AI社員が何をしたか」。
 *
 * 店長が朝に開く画面。上から順に
 *   1. 承認してほしいもの（唯一のやること）
 *   2. 誰が何件片付けたか
 *   3. 稼働ログの時系列
 * を置いている。スクロールせずに 1 が見えることを最優先にしている。
 */
export default function HomePage() {
  const tenant = getDefaultTenant();
  if (!tenant) return <SetupNotice />;

  const since = startOfTodayIso(tenant.timezone);
  const staff = listStaff(tenant.id);
  const tasks = listTasks(tenant.id, { since, limit: 200 });
  const pending = countPendingApprovals(tenant.id);
  const lastRun = listRuns(tenant.id, 1)[0] ?? null;
  const connectors = connectorStatus(tenant.id);
  const staffById = new Map(staff.map((s) => [s.id, s]));

  const doneCount = tasks.filter((t) => t.status === "done").length;
  const blockedCount = tasks.filter((t) => t.status === "blocked").length;

  const nowLabel = new Date().toLocaleString("ja-JP", {
    timeZone: tenant.timezone,
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <main>
      <PageHeader
        eyebrow="TODAY"
        title={tenant.name}
        right={
          <span className="font-mono text-[11px] text-[color:var(--color-ash)]">{nowLabel}</span>
        }
      />

      {/* 1. 承認 — 店長がやる唯一のこと */}
      <section className="px-5">
        {pending > 0 ? (
          <Link
            href="/approvals"
            className="flex items-center justify-between rounded-lg border border-[color:var(--color-gold)] bg-[linear-gradient(135deg,#E8D08A,#C9A227_60%,#9C7A1C)] px-5 py-4 text-[color:var(--color-ink)] active:opacity-90"
          >
            <span>
              <span className="block font-mono text-[10px] tracking-[0.2em]">APPROVAL</span>
              <span className="block text-[17px] font-bold">承認待ち {pending}件</span>
            </span>
            <span aria-hidden className="text-xl font-bold">
              →
            </span>
          </Link>
        ) : (
          <div className="rounded-lg border border-[color:var(--color-edge)] px-5 py-4">
            <p className="font-mono text-[10px] tracking-[0.2em] text-[color:var(--color-gold)]">
              APPROVAL
            </p>
            <p className="text-[15px] font-bold text-[color:var(--color-text-hi)]">
              承認待ちはありません
            </p>
          </div>
        )}
      </section>

      {/* 2. 今日の数字 */}
      <section className="mt-5 grid grid-cols-3 gap-2 px-5">
        {[
          { label: "完了", value: doneCount, accent: "var(--color-text-hi)" },
          { label: "承認待ち", value: pending, accent: "var(--color-gold)" },
          { label: "要判断", value: blockedCount, accent: "var(--color-err)" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-[color:var(--color-edge)] bg-[color:var(--color-stone)] px-3 py-3 text-center"
          >
            <p className="font-mono text-[24px] font-bold leading-none" style={{ color: stat.accent }}>
              {stat.value}
            </p>
            <p className="mt-1.5 text-[11px] text-[color:var(--color-ash)]">{stat.label}</p>
          </div>
        ))}
      </section>

      {/* 3. AI社員 */}
      <section className="mt-8">
        <SectionTitle count={staff.length}>AI社員</SectionTitle>
        <div className="space-y-2 px-5">
          {staff.map((s) => {
            const mine = tasks.filter((t) => t.staffId === s.id);
            return (
              <Card key={s.id} href={`/staff/${s.id}`}>
                <div className="flex items-center gap-2">
                  <RoleBadge role={s.role} />
                  <span className="flex-1 truncate text-[15px] font-bold text-[color:var(--color-text-hi)]">
                    {s.name}
                  </span>
                  <span className="font-mono text-[12px] text-[color:var(--color-ash)]">
                    {mine.length}件
                  </span>
                  <span aria-hidden className="text-[color:var(--color-gold)]">
                    →
                  </span>
                </div>
                <p className="mt-1.5 truncate text-[12px] text-[color:var(--color-text-mute)]">
                  {mine[0]?.title ?? (s.enabled ? "本日の稼働はまだありません" : "停止中")}
                </p>
              </Card>
            );
          })}
        </div>
      </section>

      {/* 4. 稼働ログ */}
      <section className="mt-8">
        <SectionTitle count={tasks.length}>今日の稼働ログ</SectionTitle>
        {tasks.length === 0 ? (
          <EmptyState>
            まだ今日の稼働はありません。
            <br />
            スケジュールされた時刻になると自動で動き始めます。
          </EmptyState>
        ) : (
          <ol className="space-y-2 px-5">
            {tasks.slice(0, 40).map((task) => {
              const owner = staffById.get(task.staffId);
              return (
                <li key={task.id}>
                  <Card href={`/tasks/${task.id}`}>
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 font-mono text-[11px] text-[color:var(--color-ash)]">
                        {timeAgo(task.createdAt, tenant.timezone)}
                      </span>
                      <span className="flex-1 text-[14px] leading-snug text-[color:var(--color-text-body)]">
                        {task.title}
                      </span>
                      <TaskStatusPill status={task.status} />
                    </div>
                    {owner ? (
                      <p className="mt-1 text-[11px] text-[color:var(--color-ash)]">{owner.name}</p>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* 5. 接続状況 — モックで動いているのか本番接続なのかを隠さない */}
      <section className="mt-8 pb-8">
        <SectionTitle>接続状況</SectionTitle>
        <div className="space-y-1.5 px-5">
          {connectors.map((c) => (
            <div
              key={c.label}
              className="flex items-center justify-between rounded border border-[color:var(--color-edge)] px-3 py-2"
            >
              <span className="text-[13px] text-[color:var(--color-text-body)]">{c.label}</span>
              <span
                className={`font-mono text-[10px] tracking-wider ${
                  c.live ? "text-[color:var(--color-ok)]" : "text-[color:var(--color-ash)]"
                }`}
              >
                {c.live ? "接続済み" : "未接続"}
              </span>
            </div>
          ))}
        </div>
        {lastRun ? (
          <p className="mt-4 px-5 font-mono text-[10px] text-[color:var(--color-ash)]">
            最終稼働: {timeAgo(lastRun.startedAt, tenant.timezone)} / {lastRun.status}
          </p>
        ) : null}
      </section>
    </main>
  );
}
