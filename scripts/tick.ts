import { runJob } from "../src/lib/agents/runner.ts";
import { closeDb } from "../src/lib/db/client.ts";
import { listAllEnabledJobs } from "../src/lib/db/repo.ts";
import { tick } from "../src/lib/scheduler/tick.ts";

/**
 * 手動実行。
 *
 *   npm run tick            — 今この分に該当するジョブだけ実行（本番と同じ挙動）
 *   npm run tick -- --all   — cron を無視して全ジョブを1回実行（動作確認・デモ用）
 *   npm run tick -- --job <jobId>
 */

const args = process.argv.slice(2);
const runAll = args.includes("--all");
const jobIndex = args.indexOf("--job");
const targetJobId = jobIndex >= 0 ? args[jobIndex + 1] : null;

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "ANTHROPIC_API_KEY が未設定です。`ant auth login` のプロファイルがあればそちらが使われます。",
  );
}

async function main(): Promise<void> {
  if (runAll || targetJobId) {
    const jobs = (await listAllEnabledJobs()).filter((j) => !targetJobId || j.id === targetJobId);

    if (jobs.length === 0) {
      console.log("対象のジョブがありません。先に `npm run db:seed` を実行してください。");
      return;
    }

    console.log(`${jobs.length}件のジョブを順に実行します。`);
    for (const job of jobs) {
      process.stdout.write(`\n▸ ${job.name} … `);
      const outcome = await runJob(job);
      console.log(`[${outcome.status}]`);
      console.log(`  ${outcome.summary.split("\n").join("\n  ")}`);
      if (outcome.tasks.length > 0) {
        console.log(`  稼働ログ ${outcome.tasks.length}件 / 承認待ち ${outcome.approvals.length}件`);
      }
    }
    return;
  }

  const result = await tick();
  console.log(
    `${result.checkedAt} 対象${result.due}件 → 成功${result.succeeded} 失敗${result.failed} スキップ${result.skipped}`,
  );
  for (const d of result.details) {
    console.log(`  - [${d.status}] ${d.jobName}: ${d.summary.split("\n")[0]}`);
  }
  if (result.due === 0) {
    console.log("この分に該当するジョブはありません。--all で全件を試せます。");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
