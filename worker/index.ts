import { tick } from "../src/lib/scheduler/tick.ts";
import { closeDb } from "../src/lib/db/client.ts";

/**
 * 常駐ワーカー（ローカル / VPS 用）。
 *
 * 毎分 tick を呼ぶだけ。Vercel にデプロイする場合はこのプロセスは不要で、
 * vercel.json の cron から /api/cron/tick を叩けば同じことが起きる。
 * 両方動かしても、スロット予約で実行は1回に収束する。
 */

let running = false;
let stopping = false;

async function safeTick(): Promise<void> {
  // 前回の tick がまだ終わっていなければ、この分は飛ばす。
  // 重ねて走らせるとレート制限に当たるだけで得がない。
  if (running) {
    console.warn(`[worker] 前回の実行が継続中のためスキップ: ${new Date().toISOString()}`);
    return;
  }
  running = true;
  try {
    const result = await tick();
    if (result.due > 0) {
      console.log(
        `[worker] ${result.checkedAt} 対象${result.due}件 → 成功${result.succeeded} 失敗${result.failed} スキップ${result.skipped}`,
      );
      for (const d of result.details) {
        console.log(`  - [${d.status}] ${d.jobName}: ${d.summary.split("\n")[0]}`);
      }
    }
  } catch (err) {
    // ここで落とすとワーカーごと死ぬ。ログに残して次の分へ進む。
    console.error("[worker] tick に失敗:", err);
  } finally {
    running = false;
  }
}

/** 次の「毎分ちょうど」まで待つ。cron 式の分境界とズレないようにするため。 */
function msUntilNextMinute(): number {
  const now = Date.now();
  return 60_000 - (now % 60_000);
}

async function loop(): Promise<void> {
  while (!stopping) {
    await new Promise((resolve) => setTimeout(resolve, msUntilNextMinute()));
    if (stopping) break;
    void safeTick();
  }
}

function shutdown(signal: string): void {
  console.log(`[worker] ${signal} を受信。終了します。`);
  stopping = true;
  // 実行中の tick を待ってから DB を閉じる。
  const waitForIdle = setInterval(() => {
    if (!running) {
      clearInterval(waitForIdle);
      closeDb();
      process.exit(0);
    }
  }, 200);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

console.log("[worker] AI社員の常駐ワーカーを開始しました。毎分ジョブを確認します。");
void loop();
