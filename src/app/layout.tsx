import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";
import { countPendingApprovals, getDefaultTenant } from "@/lib/db/repo";

// 承認待ち件数をタブに出すため、レイアウト自体もリクエストごとに描画する。
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ONYX AI社員",
  description: "営業・マーケティング・事務の稼働状況を、スマホだけで確認する。",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ONYX",
  },
};

export const viewport: Viewport = {
  themeColor: "#08080A",
  width: "device-width",
  initialScale: 1,
  // ホーム画面から開いたときにピンチズームで崩れないようにする。
  maximumScale: 1,
  viewportFit: "cover",
};

/** タブのバッジ用。DB 未初期化でも画面は出したいので、失敗しても 0 で続行する。 */
function pendingApprovalCount(): number {
  try {
    const tenant = getDefaultTenant();
    return tenant ? countPendingApprovals(tenant.id) : 0;
  } catch {
    return 0;
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        {children}
        <BottomNav pendingCount={pendingApprovalCount()} />
      </body>
    </html>
  );
}
