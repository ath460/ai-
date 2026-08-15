import Link from "next/link";
import type { ReactNode } from "react";
import { STAFF_ROLE_LABEL, type StaffRole, type TaskStatus } from "@/lib/types";

/** 画面上部の見出し。全ページ共通。 */
export function PageHeader({
  eyebrow,
  title,
  right,
}: {
  eyebrow: string;
  title: string;
  right?: ReactNode;
}) {
  return (
    <header className="px-5 pb-4 pt-[calc(env(safe-area-inset-top)+20px)]">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-1 text-[22px] font-bold leading-tight text-[color:var(--color-text-hi)]">
            {title}
          </h1>
        </div>
        {right}
      </div>
      <div className="strata mt-4" />
    </header>
  );
}

export function Card({
  children,
  href,
  className = "",
}: {
  children: ReactNode;
  href?: string;
  className?: string;
}) {
  const base = `block rounded-lg border border-[color:var(--color-edge)] bg-[color:var(--color-stone)] p-4 ${className}`;
  if (href) {
    return (
      <Link href={href} className={`${base} active:bg-[color:var(--color-stone-2)]`}>
        {children}
      </Link>
    );
  }
  return <div className={base}>{children}</div>;
}

export function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h2 className="mb-3 flex items-baseline gap-2 px-5 text-[13px] font-bold tracking-wider text-[color:var(--color-ash-2)]">
      {children}
      {typeof count === "number" ? (
        <span className="font-mono text-[11px] text-[color:var(--color-gold)]">{count}</span>
      ) : null}
    </h2>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="mx-5 rounded-lg border border-dashed border-[color:var(--color-edge)] px-4 py-8 text-center text-[13px] text-[color:var(--color-ash)]">
      {children}
    </p>
  );
}

const ROLE_ACCENT: Record<StaffRole, string> = {
  sales: "text-[color:var(--color-gold-lt)]",
  marketing: "text-[#9fc8e8]",
  backoffice: "text-[#c3b8e8]",
};

export function RoleBadge({ role }: { role: StaffRole }) {
  return (
    <span
      className={`shrink-0 rounded border border-[color:var(--color-edge)] px-1.5 py-0.5 font-mono text-[10px] tracking-wider ${ROLE_ACCENT[role]}`}
    >
      {STAFF_ROLE_LABEL[role]}
    </span>
  );
}

const TASK_STATUS_STYLE: Record<TaskStatus, { label: string; className: string }> = {
  done: { label: "完了", className: "text-[color:var(--color-ok)]" },
  waiting_approval: { label: "承認待ち", className: "text-[color:var(--color-gold)]" },
  blocked: { label: "要判断", className: "text-[color:var(--color-err)]" },
};

export function TaskStatusPill({ status }: { status: TaskStatus }) {
  const s = TASK_STATUS_STYLE[status];
  return <span className={`shrink-0 font-mono text-[10px] tracking-wider ${s.className}`}>{s.label}</span>;
}

/** 「3分前」「昨日 21:40」のような、スマホで一目で分かる表記。 */
export function timeAgo(iso: string, timeZone = "Asia/Tokyo"): string {
  const then = new Date(iso).getTime();
  const diffMin = Math.floor((Date.now() - then) / 60_000);

  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  if (diffMin < 60 * 12) return `${Math.floor(diffMin / 60)}時間前`;

  return new Date(iso).toLocaleString("ja-JP", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(iso: string, timeZone = "Asia/Tokyo"): string {
  return new Date(iso).toLocaleTimeString("ja-JP", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });
}
