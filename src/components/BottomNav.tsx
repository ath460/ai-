"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 下部タブ。片手で親指が届く位置に置く。
 * 店長がこのアプリを開くのは移動中か開店前なので、
 * 「承認待ち」に最短で行けることを最優先にしている。
 */

const TABS = [
  { href: "/", label: "稼働", icon: "▤" },
  { href: "/approvals", label: "承認", icon: "✓" },
  { href: "/staff", label: "AI社員", icon: "◇" },
  { href: "/report", label: "日報", icon: "▦" },
] as const;

export function BottomNav({ pendingCount = 0 }: { pendingCount?: number }) {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-[color:var(--color-edge)] bg-[color:var(--color-stone)]/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="メインナビゲーション"
    >
      <ul className="mx-auto flex max-w-md">
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[11px] tracking-wider transition-colors ${
                  active ? "text-[color:var(--color-gold-lt)]" : "text-[color:var(--color-ash)]"
                }`}
              >
                <span aria-hidden className="text-base leading-none">
                  {tab.icon}
                </span>
                {tab.label}
                {tab.href === "/approvals" && pendingCount > 0 ? (
                  <span
                    className="absolute right-[22%] top-2 min-w-[18px] rounded-full bg-[color:var(--color-gold)] px-1 text-center text-[10px] font-bold leading-[18px] text-[color:var(--color-ink)]"
                    aria-label={`承認待ち ${pendingCount} 件`}
                  >
                    {pendingCount > 99 ? "99+" : pendingCount}
                  </span>
                ) : null}
                {active ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-6 top-0 h-px bg-[color:var(--color-gold)]"
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
