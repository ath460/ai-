import { SetupNotice } from "@/components/SetupNotice";
import { Card, EmptyState, PageHeader, RoleBadge, SectionTitle } from "@/components/ui";
import {
  getDefaultTenant,
  listMetrics,
  listRuns,
  listStaff,
  listTasks,
} from "@/lib/db/repo";
import { daysAgoDateString, startOfTodayIso, todayDateString } from "@/lib/view";

export const dynamic = "force-dynamic";

/**
 * 日報。
 *
 * サイトで出している「1日2時間45分 → 15分」の主張を、実測で裏づける画面。
 * 削減時間は AI社員が実際に片付けた件数から推定する。前提はページ下部に明示する
 * ——根拠を隠した数字は、代行を任せる判断材料にならない。
 */

/** 1件あたりの想定所要時間（分）。サイトの試算（掲載更新45分/投稿40分など）に合わせた保守値。 */
const MINUTES_PER_TASK = 12;

export default function ReportPage() {
  const tenant = getDefaultTenant();
  if (!tenant) return <SetupNotice />;

  const today = todayDateString(tenant.timezone);
  const since = startOfTodayIso(tenant.timezone);

  const staff = listStaff(tenant.id);
  const tasks = listTasks(tenant.id, { since, limit: 300 });
  const runs = listRuns(tenant.id, 100).filter((r) => r.startedAt >= since);
  const metrics = listMetrics(tenant.id, daysAgoDateString(tenant.timezone, 7));

  const done = tasks.filter((t) => t.status === "done");
  const blocked = tasks.filter((t) => t.status === "blocked");
  const savedMinutes = done.length * MINUTES_PER_TASK;
  const tokens = runs.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0);

  const nightRuns = runs.filter((r) => {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tenant.timezone,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date(r.startedAt)),
    );
    return hour >= 22 || hour < 7;
  });

  return (
    <main>
      <PageHeader eyebrow="DAILY REPORT" title={today} />

      <section className="grid grid-cols-2 gap-2 px-5">
        <Card>
          <p className="font-mono text-[28px] font-bold leading-none text-[color:var(--color-gold-lt)]">
            {Math.floor(savedMinutes / 60)}
            <span className="text-[14px]">時間</span>
            {savedMinutes % 60}
            <span className="text-[14px]">分</span>
          </p>
          <p className="mt-2 text-[11px] text-[color:var(--color-ash)]">本日の削減時間（推定）</p>
        </Card>
        <Card>
          <p className="font-mono text-[28px] font-bold leading-none text-[color:var(--color-text-hi)]">
            {done.length}
          </p>
          <p className="mt-2 text-[11px] text-[color:var(--color-ash)]">片付いた件数</p>
        </Card>
        <Card>
          <p className="font-mono text-[28px] font-bold leading-none text-[color:var(--color-text-hi)]">
            {nightRuns.length}
          </p>
          <p className="mt-2 text-[11px] text-[color:var(--color-ash)]">
            深夜・早朝の稼働（22-7時）
          </p>
        </Card>
        <Card>
          <p className="font-mono text-[28px] font-bold leading-none text-[color:var(--color-err)]">
            {blocked.length}
          </p>
          <p className="mt-2 text-[11px] text-[color:var(--color-ash)]">店長の判断が要る件数</p>
        </Card>
      </section>

      <section className="mt-8">
        <SectionTitle>AI社員別</SectionTitle>
        <div className="space-y-2 px-5">
          {staff.map((s) => {
            const mine = tasks.filter((t) => t.staffId === s.id);
            const mineDone = mine.filter((t) => t.status === "done").length;
            const ratio = mine.length > 0 ? Math.round((mineDone / mine.length) * 100) : 0;
            return (
              <Card key={s.id} href={`/staff/${s.id}`}>
                <div className="flex items-center gap-2">
                  <RoleBadge role={s.role} />
                  <span className="flex-1 truncate text-[14px] text-[color:var(--color-text-hi)]">
                    {s.name}
                  </span>
                  <span className="font-mono text-[12px] text-[color:var(--color-ash)]">
                    {mineDone}/{mine.length}
                  </span>
                </div>
                <div
                  className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[color:var(--color-stone-2)]"
                  role="presentation"
                >
                  <div
                    className="h-full bg-[color:var(--color-gold)]"
                    style={{ width: `${ratio}%` }}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {blocked.length > 0 ? (
        <section className="mt-8">
          <SectionTitle count={blocked.length}>店長の判断が要るもの</SectionTitle>
          <ul className="space-y-2 px-5">
            {blocked.map((t) => (
              <li key={t.id}>
                <Card href={`/tasks/${t.id}`}>
                  <p className="text-[14px] leading-snug text-[color:var(--color-text-body)]">
                    {t.title}
                  </p>
                  {t.detail ? (
                    <p className="mt-1 line-clamp-2 text-[12px] text-[color:var(--color-ash)]">
                      {t.detail}
                    </p>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-8">
        <SectionTitle count={metrics.length}>直近7日の指標</SectionTitle>
        {metrics.length === 0 ? (
          <EmptyState>まだ記録された指標はありません。</EmptyState>
        ) : (
          <ul className="space-y-1.5 px-5">
            {metrics.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded border border-[color:var(--color-edge)] px-3 py-2"
              >
                <span className="font-mono text-[10px] text-[color:var(--color-ash)]">{m.date}</span>
                <span className="flex-1 px-3 text-[13px] text-[color:var(--color-text-body)]">
                  {m.key}
                </span>
                <span className="font-mono text-[13px] text-[color:var(--color-gold-lt)]">
                  {m.value.toLocaleString()}
                  {m.unit ?? ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 px-5 pb-8">
        <p className="text-[11px] leading-relaxed text-[color:var(--color-ash)]">
          ※ 削減時間は「片付いた件数 × {MINUTES_PER_TASK}分」で算出した推定値です。人が同じ作業を
          した場合の目安であり、実測値ではありません。
          <br />
          本日のモデル利用: {tokens.toLocaleString()} トークン / 実行 {runs.length} 回。
        </p>
      </section>
    </main>
  );
}
