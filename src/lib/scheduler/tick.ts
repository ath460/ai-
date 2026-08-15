import { runJob } from "../agents/runner.ts";
import { getTenant, listAllEnabledJobs } from "../db/repo.ts";
import type { Job } from "../types.ts";
import { cronMatches } from "./cron.ts";

/**
 * 「今この分に走るべきジョブ」を拾って実行する。
 *
 * ローカルワーカーからも Vercel Cron からも、同じこの関数が呼ばれる。
 * 二重呼び出しは runJob 側のスロット予約（UNIQUE 制約）で吸収されるので、
 * 両方同時に動いていても実行は1回に収束する。
 */

export interface TickResult {
  checkedAt: string;
  due: number;
  succeeded: number;
  failed: number;
  skipped: number;
  details: Array<{ jobId: string; jobName: string; status: string; summary: string }>;
}

/** 同時にモデルへ投げる本数。API のレート制限と費用の上限を兼ねる。 */
const CONCURRENCY = 2;

export async function findDueJobs(at: Date = new Date()): Promise<Job[]> {
  const jobs = await listAllEnabledJobs();

  // テナントは数が少ないので、ジョブごとに引かずまとめて解決する。
  const timezones = new Map<string, string>();
  for (const job of jobs) {
    if (timezones.has(job.tenantId)) continue;
    const tenant = await getTenant(job.tenantId);
    if (tenant) timezones.set(tenant.id, tenant.timezone);
  }

  return jobs.filter((job) => {
    const tz = timezones.get(job.tenantId);
    return tz ? cronMatches(job.cron, at, tz) : false;
  });
}

export async function tick(at: Date = new Date()): Promise<TickResult> {
  const due = await findDueJobs(at);
  const result: TickResult = {
    checkedAt: at.toISOString(),
    due: due.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  // CONCURRENCY 本ずつの塊で回す。全部同時に投げるとレート制限に当たる。
  for (let i = 0; i < due.length; i += CONCURRENCY) {
    const batch = due.slice(i, i + CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map(async (job) => ({ job, outcome: await runJob(job, at) })),
    );

    for (const { job, outcome } of outcomes) {
      if (outcome.status === "succeeded") result.succeeded += 1;
      else if (outcome.status === "failed") result.failed += 1;
      else result.skipped += 1;

      result.details.push({
        jobId: job.id,
        jobName: job.name,
        status: outcome.status,
        summary: outcome.summary,
      });
    }
  }

  return result;
}
