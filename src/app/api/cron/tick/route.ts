import { NextResponse } from "next/server";
import { tick } from "@/lib/scheduler/tick";

/**
 * Vercel Cron から毎分叩かれるエンドポイント。
 *
 * ローカルの常駐ワーカーと同じ tick を呼ぶ。両方が動いていても、
 * runJob 側のスロット予約で実行は1回に収束する。
 */

// node:sqlite と googleapis を使うので Edge ではなく Node ランタイム。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// AI社員の1ジョブは思考とツール往復で数分かかることがある。
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;

  // 秘密鍵が未設定なら、ローカル開発とみなして通す。
  // 本番（Vercel）では必ず設定すること。未設定のまま公開すると誰でも叩ける。
  if (!secret) return process.env.NODE_ENV !== "production";

  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await tick();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
