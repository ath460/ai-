import type { ConnectorBundle } from "../connectors/types.ts";
import { getLastWorkedRunAt } from "../db/repo.ts";
import type { Job } from "../types.ts";

/**
 * モデルを呼ぶ前の足切り。
 *
 * 費用の内訳は、ホスティングでもDBでもなくモデルの起動回数で決まる。
 * 30分ごとのジョブは月1,400回以上動くが、その大半は「新着ゼロ」で、
 * 受信箱を見て終わるだけの起動にフル価格を払うことになる。
 *
 * ここでの判定はコネクタの読み取りだけで完結する（Gmail の list は無料）。
 * 判定に失敗したら「実行する」に倒す。足切りの失敗で仕事を落とすより、
 * 1回分の費用を払うほうが安い。
 */

export interface PrecheckResult {
  shouldRun: boolean;
  /** スキップしたときに run レコードへ残す理由。 */
  reason: string;
}

const RUN = (reason: string): PrecheckResult => ({ shouldRun: true, reason });
const SKIP = (reason: string): PrecheckResult => ({ shouldRun: false, reason });

export async function shouldRunJob(
  job: Job,
  connectors: ConnectorBundle,
): Promise<PrecheckResult> {
  switch (job.precheck) {
    case "new_inbox":
      return checkNewInbox(job, connectors);
    case "always":
    default:
      return RUN("常時実行の設定");
  }
}

async function checkNewInbox(
  job: Job,
  connectors: ConnectorBundle,
): Promise<PrecheckResult> {
  // 実際に稼働した最後の時刻。skipped は含めない
  // （含めると、新着が来ていても基準時刻が動き続けてスキップし続ける）。
  const since = await getLastWorkedRunAt(job.id);

  // 初回は基準が無いので必ず実行する。
  if (!since) return RUN("初回実行");

  try {
    const messages = await connectors.mail.listInbox({ limit: 30 });
    const fresh = messages.filter((m) => m.receivedAt > since);

    if (fresh.length === 0) {
      return SKIP(`前回稼働（${since}）以降の新着メールなし`);
    }
    return RUN(`新着${fresh.length}件`);
  } catch (err) {
    // 受信箱が見られない理由は色々ある（トークン失効、Gmail の一時障害）。
    // ここで止めると問い合わせを取りこぼすので、実行側に倒す。
    const detail = err instanceof Error ? err.message : String(err);
    return RUN(`受信箱の確認に失敗したため実行（${detail}）`);
  }
}
