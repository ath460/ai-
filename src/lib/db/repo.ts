import { getDb, newId, nowIso } from "./client.ts";
import type {
  Approval,
  ApprovalStatus,
  AuditLog,
  ConnectorAccount,
  ConnectorProvider,
  ExternalAction,
  Job,
  JobPrecheck,
  MediaAsset,
  Metric,
  Note,
  RiskLevel,
  Run,
  RunStatus,
  Staff,
  StaffRole,
  Task,
  TaskStatus,
  Tenant,
  TenantSettings,
} from "../types.ts";

/**
 * リポジトリ層。SQL はすべてこのファイルに閉じる。
 *
 * SQL は `?` プレースホルダで書く。Postgres 用の $1, $2 への変換は
 * ドライバ側が行うので、ここでは方言を意識しない。
 *
 * 設計上の約束: テナントを跨ぐデータが返る関数を作らない。
 * 一覧系は必ず tenantId を第一引数に取る。
 */

type Row = Record<string, unknown>;

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => Number(v);
const bool = (v: unknown): boolean => Number(v) === 1;
const json = <T,>(v: unknown, fallback: T): T => {
  if (typeof v !== "string" || v.length === 0) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

async function query(sql: string, params: unknown[] = []): Promise<Row[]> {
  return (await getDb()).query<Row>(sql, params);
}

async function run(sql: string, params: unknown[] = []): Promise<number> {
  const result = await (await getDb()).run(sql, params);
  return result.changes;
}

async function first(sql: string, params: unknown[] = []): Promise<Row | undefined> {
  return (await query(sql, params))[0];
}

// ---------------------------------------------------------------- tenants

function toTenant(r: Row): Tenant {
  return {
    id: str(r.id),
    name: str(r.name),
    industry: strOrNull(r.industry),
    timezone: str(r.timezone),
    settings: json<TenantSettings>(r.settings_json, {}),
    createdAt: str(r.created_at),
  };
}

export async function createTenant(input: {
  name: string;
  industry?: string;
  timezone?: string;
  settings?: TenantSettings;
}): Promise<Tenant> {
  const tenant: Tenant = {
    id: newId("tnt"),
    name: input.name,
    industry: input.industry ?? null,
    timezone: input.timezone ?? "Asia/Tokyo",
    settings: input.settings ?? {},
    createdAt: nowIso(),
  };
  await run(
    `INSERT INTO tenants (id, name, industry, timezone, settings_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      tenant.id,
      tenant.name,
      tenant.industry,
      tenant.timezone,
      JSON.stringify(tenant.settings),
      tenant.createdAt,
    ],
  );
  return tenant;
}

export async function listTenants(): Promise<Tenant[]> {
  return (await query(`SELECT * FROM tenants ORDER BY created_at`)).map(toTenant);
}

export async function getTenant(tenantId: string): Promise<Tenant | null> {
  const row = await first(`SELECT * FROM tenants WHERE id = ?`, [tenantId]);
  return row ? toTenant(row) : null;
}

/**
 * 既定テナント。ONYX 社内運用ではこれ1件しか使わない。
 * 環境変数 ONYX_TENANT_ID が指定されていればそれを優先する。
 */
export async function getDefaultTenant(): Promise<Tenant | null> {
  const pinned = process.env.ONYX_TENANT_ID;
  if (pinned) return getTenant(pinned);
  return (await listTenants())[0] ?? null;
}

// ------------------------------------------------------------------ staff

function toStaff(r: Row): Staff {
  return {
    id: str(r.id),
    tenantId: str(r.tenant_id),
    role: str(r.role) as StaffRole,
    name: str(r.name),
    persona: str(r.persona),
    enabled: bool(r.enabled),
    createdAt: str(r.created_at),
  };
}

export async function createStaff(input: {
  tenantId: string;
  role: StaffRole;
  name: string;
  persona: string;
}): Promise<Staff> {
  const staff: Staff = { ...input, id: newId("stf"), enabled: true, createdAt: nowIso() };
  await run(
    `INSERT INTO staff (id, tenant_id, role, name, persona, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [staff.id, staff.tenantId, staff.role, staff.name, staff.persona, staff.createdAt],
  );
  return staff;
}

export async function listStaff(tenantId: string): Promise<Staff[]> {
  return (await query(`SELECT * FROM staff WHERE tenant_id = ? ORDER BY created_at`, [tenantId])).map(
    toStaff,
  );
}

export async function getStaff(tenantId: string, staffId: string): Promise<Staff | null> {
  const row = await first(`SELECT * FROM staff WHERE tenant_id = ? AND id = ?`, [tenantId, staffId]);
  return row ? toStaff(row) : null;
}

export async function setStaffEnabled(
  tenantId: string,
  staffId: string,
  enabled: boolean,
): Promise<void> {
  await run(`UPDATE staff SET enabled = ? WHERE tenant_id = ? AND id = ?`, [
    enabled ? 1 : 0,
    tenantId,
    staffId,
  ]);
}

// ------------------------------------------------------------------- jobs

function toJob(r: Row): Job {
  return {
    id: str(r.id),
    tenantId: str(r.tenant_id),
    staffId: str(r.staff_id),
    name: str(r.name),
    cron: str(r.cron),
    instruction: str(r.instruction),
    precheck: str(r.precheck) as JobPrecheck,
    enabled: bool(r.enabled),
    lastRunAt: strOrNull(r.last_run_at),
  };
}

export async function createJob(input: {
  tenantId: string;
  staffId: string;
  name: string;
  cron: string;
  instruction: string;
  precheck?: JobPrecheck;
}): Promise<Job> {
  const job: Job = {
    ...input,
    id: newId("job"),
    precheck: input.precheck ?? "always",
    enabled: true,
    lastRunAt: null,
  };
  await run(
    `INSERT INTO jobs (id, tenant_id, staff_id, name, cron, instruction, precheck, enabled, last_run_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
    [job.id, job.tenantId, job.staffId, job.name, job.cron, job.instruction, job.precheck],
  );
  return job;
}

export async function listJobs(tenantId: string): Promise<Job[]> {
  return (await query(`SELECT * FROM jobs WHERE tenant_id = ?`, [tenantId])).map(toJob);
}

/** スケジューラ用。全テナント分の有効ジョブを返す唯一の例外。 */
export async function listAllEnabledJobs(): Promise<Job[]> {
  return (
    await query(
      `SELECT j.* FROM jobs j
       JOIN staff s ON s.id = j.staff_id
       WHERE j.enabled = 1 AND s.enabled = 1`,
    )
  ).map(toJob);
}

export async function touchJobLastRun(jobId: string, at: string): Promise<void> {
  await run(`UPDATE jobs SET last_run_at = ? WHERE id = ?`, [at, jobId]);
}

// ------------------------------------------------------------------- runs

function toRun(r: Row): Run {
  return {
    id: str(r.id),
    tenantId: str(r.tenant_id),
    jobId: str(r.job_id),
    staffId: str(r.staff_id),
    slotKey: str(r.slot_key),
    status: str(r.status) as RunStatus,
    startedAt: str(r.started_at),
    finishedAt: strOrNull(r.finished_at),
    summary: strOrNull(r.summary),
    error: strOrNull(r.error),
    inputTokens: num(r.input_tokens),
    outputTokens: num(r.output_tokens),
  };
}

/**
 * スロットを予約する。同じ slotKey が既にあれば null を返す。
 *
 * ワーカーと Vercel Cron が同時に叩いても、UNIQUE 制約により
 * 片方だけが run を獲得する。二重にメールが下書きされる事故を防ぐ。
 */
export async function claimRunSlot(input: {
  tenantId: string;
  jobId: string;
  staffId: string;
  slotKey: string;
}): Promise<Run | null> {
  const startedAt = nowIso();
  const id = newId("run");

  const changes = await run(
    `INSERT INTO runs
       (id, tenant_id, job_id, staff_id, slot_key, status, started_at, input_tokens, output_tokens)
     VALUES (?, ?, ?, ?, ?, 'running', ?, 0, 0)
     ON CONFLICT DO NOTHING`,
    [id, input.tenantId, input.jobId, input.staffId, input.slotKey, startedAt],
  );

  if (changes === 0) return null;

  return {
    id,
    tenantId: input.tenantId,
    jobId: input.jobId,
    staffId: input.staffId,
    slotKey: input.slotKey,
    status: "running",
    startedAt,
    finishedAt: null,
    summary: null,
    error: null,
    inputTokens: 0,
    outputTokens: 0,
  };
}

export async function finishRun(input: {
  runId: string;
  status: Extract<RunStatus, "succeeded" | "failed" | "skipped">;
  summary?: string | null;
  error?: string | null;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<void> {
  await run(
    `UPDATE runs
        SET status = ?, finished_at = ?, summary = ?, error = ?,
            input_tokens = ?, output_tokens = ?
      WHERE id = ?`,
    [
      input.status,
      nowIso(),
      input.summary ?? null,
      input.error ?? null,
      input.inputTokens ?? 0,
      input.outputTokens ?? 0,
      input.runId,
    ],
  );
}

export async function listRuns(tenantId: string, limit = 50): Promise<Run[]> {
  return (
    await query(`SELECT * FROM runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT ?`, [
      tenantId,
      limit,
    ])
  ).map(toRun);
}

export async function getRun(tenantId: string, runId: string): Promise<Run | null> {
  const row = await first(`SELECT * FROM runs WHERE tenant_id = ? AND id = ?`, [tenantId, runId]);
  return row ? toRun(row) : null;
}

/**
 * そのジョブが最後に実際に稼働した時刻。
 *
 * 事前チェックの基準に使う。skipped は「何もしなかった」ので基準にしない
 * ——skipped を含めると、新着が来ていても毎回スキップし続けてしまう。
 */
export async function getLastWorkedRunAt(jobId: string): Promise<string | null> {
  const row = await first(
    `SELECT started_at FROM runs
      WHERE job_id = ? AND status IN ('succeeded','failed')
      ORDER BY started_at DESC LIMIT 1`,
    [jobId],
  );
  return row ? str(row.started_at) : null;
}

/** 事前チェックで足切りした回数。費用削減の効果を画面に出すために使う。 */
export async function countSkippedRuns(tenantId: string, since: string): Promise<number> {
  const row = await first(
    `SELECT COUNT(*) AS c FROM runs
      WHERE tenant_id = ? AND status = 'skipped' AND started_at >= ?`,
    [tenantId, since],
  );
  return row ? num(row.c) : 0;
}

// ------------------------------------------------------------------ tasks

function toTask(r: Row): Task {
  return {
    id: str(r.id),
    tenantId: str(r.tenant_id),
    runId: str(r.run_id),
    staffId: str(r.staff_id),
    title: str(r.title),
    detail: strOrNull(r.detail),
    status: str(r.status) as TaskStatus,
    approvalId: strOrNull(r.approval_id),
    createdAt: str(r.created_at),
  };
}

export async function createTask(input: {
  tenantId: string;
  runId: string;
  staffId: string;
  title: string;
  detail?: string | null;
  status?: TaskStatus;
  approvalId?: string | null;
}): Promise<Task> {
  const task: Task = {
    id: newId("tsk"),
    tenantId: input.tenantId,
    runId: input.runId,
    staffId: input.staffId,
    title: input.title,
    detail: input.detail ?? null,
    status: input.status ?? "done",
    approvalId: input.approvalId ?? null,
    createdAt: nowIso(),
  };
  await run(
    `INSERT INTO tasks (id, tenant_id, run_id, staff_id, title, detail, status, approval_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task.id,
      task.tenantId,
      task.runId,
      task.staffId,
      task.title,
      task.detail,
      task.status,
      task.approvalId,
      task.createdAt,
    ],
  );
  return task;
}

export async function getTask(tenantId: string, taskId: string): Promise<Task | null> {
  const row = await first(`SELECT * FROM tasks WHERE tenant_id = ? AND id = ?`, [tenantId, taskId]);
  return row ? toTask(row) : null;
}

/** 承認・却下の結果を、稼働ログ側の表示にも反映する。 */
export async function setTaskStatusByApproval(
  tenantId: string,
  approvalId: string,
  status: TaskStatus,
  detail?: string,
): Promise<void> {
  if (detail === undefined) {
    await run(`UPDATE tasks SET status = ? WHERE tenant_id = ? AND approval_id = ?`, [
      status,
      tenantId,
      approvalId,
    ]);
    return;
  }
  await run(`UPDATE tasks SET status = ?, detail = ? WHERE tenant_id = ? AND approval_id = ?`, [
    status,
    detail,
    tenantId,
    approvalId,
  ]);
}

export async function listTasks(
  tenantId: string,
  opts?: { since?: string; limit?: number },
): Promise<Task[]> {
  const limit = opts?.limit ?? 100;
  if (opts?.since) {
    return (
      await query(
        `SELECT * FROM tasks WHERE tenant_id = ? AND created_at >= ?
         ORDER BY created_at DESC LIMIT ?`,
        [tenantId, opts.since, limit],
      )
    ).map(toTask);
  }
  return (
    await query(`SELECT * FROM tasks WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`, [
      tenantId,
      limit,
    ])
  ).map(toTask);
}

export async function listTasksByRun(tenantId: string, runId: string): Promise<Task[]> {
  return (
    await query(`SELECT * FROM tasks WHERE tenant_id = ? AND run_id = ? ORDER BY created_at`, [
      tenantId,
      runId,
    ])
  ).map(toTask);
}

export async function listTasksByStaff(
  tenantId: string,
  staffId: string,
  limit = 50,
): Promise<Task[]> {
  return (
    await query(
      `SELECT * FROM tasks WHERE tenant_id = ? AND staff_id = ?
       ORDER BY created_at DESC LIMIT ?`,
      [tenantId, staffId, limit],
    )
  ).map(toTask);
}

// -------------------------------------------------------------- approvals

function toApproval(r: Row): Approval {
  return {
    id: str(r.id),
    tenantId: str(r.tenant_id),
    runId: strOrNull(r.run_id),
    staffId: str(r.staff_id),
    action: str(r.action) as ExternalAction,
    preview: str(r.preview),
    payload: json<Record<string, unknown>>(r.payload_json, {}),
    risk: str(r.risk) as RiskLevel,
    status: str(r.status) as ApprovalStatus,
    createdAt: str(r.created_at),
    decidedAt: strOrNull(r.decided_at),
    decidedBy: strOrNull(r.decided_by),
    rejectionReason: strOrNull(r.rejection_reason),
    resultSummary: strOrNull(r.result_summary),
  };
}

export async function createApproval(input: {
  tenantId: string;
  runId: string | null;
  staffId: string;
  action: ExternalAction;
  preview: string;
  payload: Record<string, unknown>;
  risk?: RiskLevel;
}): Promise<Approval> {
  const approval: Approval = {
    id: newId("apr"),
    tenantId: input.tenantId,
    runId: input.runId,
    staffId: input.staffId,
    action: input.action,
    preview: input.preview,
    payload: input.payload,
    risk: input.risk ?? "medium",
    status: "pending",
    createdAt: nowIso(),
    decidedAt: null,
    decidedBy: null,
    rejectionReason: null,
    resultSummary: null,
  };
  await run(
    `INSERT INTO approvals
       (id, tenant_id, run_id, staff_id, action, preview, payload_json, risk, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      approval.id,
      approval.tenantId,
      approval.runId,
      approval.staffId,
      approval.action,
      approval.preview,
      JSON.stringify(approval.payload),
      approval.risk,
      approval.createdAt,
    ],
  );
  return approval;
}

export async function listApprovals(
  tenantId: string,
  opts?: { status?: ApprovalStatus; limit?: number },
): Promise<Approval[]> {
  const limit = opts?.limit ?? 100;
  if (opts?.status) {
    return (
      await query(
        `SELECT * FROM approvals WHERE tenant_id = ? AND status = ?
         ORDER BY created_at DESC LIMIT ?`,
        [tenantId, opts.status, limit],
      )
    ).map(toApproval);
  }
  return (
    await query(`SELECT * FROM approvals WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`, [
      tenantId,
      limit,
    ])
  ).map(toApproval);
}

export async function getApproval(
  tenantId: string,
  approvalId: string,
): Promise<Approval | null> {
  const row = await first(`SELECT * FROM approvals WHERE tenant_id = ? AND id = ?`, [
    tenantId,
    approvalId,
  ]);
  return row ? toApproval(row) : null;
}

/**
 * pending のものだけを approved / rejected に遷移させる。
 * 二重タップやワーカーとの競合で同じ承認が2回実行されるのを防ぐ。
 * 遷移できたときだけ true。
 */
export async function decideApproval(input: {
  tenantId: string;
  approvalId: string;
  decision: "approved" | "rejected";
  decidedBy: string;
  rejectionReason?: string | null;
}): Promise<boolean> {
  const changes = await run(
    `UPDATE approvals
        SET status = ?, decided_at = ?, decided_by = ?, rejection_reason = ?
      WHERE tenant_id = ? AND id = ? AND status = 'pending'`,
    [
      input.decision,
      nowIso(),
      input.decidedBy,
      input.rejectionReason ?? null,
      input.tenantId,
      input.approvalId,
    ],
  );
  return changes > 0;
}

export async function markApprovalExecuted(input: {
  approvalId: string;
  status: Extract<ApprovalStatus, "executed" | "failed">;
  resultSummary: string;
}): Promise<void> {
  await run(`UPDATE approvals SET status = ?, result_summary = ? WHERE id = ?`, [
    input.status,
    input.resultSummary,
    input.approvalId,
  ]);
}

export async function countPendingApprovals(tenantId: string): Promise<number> {
  const row = await first(
    `SELECT COUNT(*) AS c FROM approvals WHERE tenant_id = ? AND status = 'pending'`,
    [tenantId],
  );
  return row ? num(row.c) : 0;
}

// ------------------------------------------------------------------ notes

function toNote(r: Row): Note {
  return {
    id: str(r.id),
    tenantId: str(r.tenant_id),
    staffId: strOrNull(r.staff_id),
    key: str(r.key),
    body: str(r.body),
    updatedAt: str(r.updated_at),
  };
}

export async function upsertNote(input: {
  tenantId: string;
  staffId?: string | null;
  key: string;
  body: string;
}): Promise<Note> {
  const note: Note = {
    id: newId("not"),
    tenantId: input.tenantId,
    staffId: input.staffId ?? null,
    key: input.key,
    body: input.body,
    updatedAt: nowIso(),
  };
  await run(
    `INSERT INTO notes (id, tenant_id, staff_id, key, body, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, key)
     DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
    [note.id, note.tenantId, note.staffId, note.key, note.body, note.updatedAt],
  );
  return note;
}

export async function listNotes(tenantId: string, limit = 50): Promise<Note[]> {
  return (
    await query(`SELECT * FROM notes WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT ?`, [
      tenantId,
      limit,
    ])
  ).map(toNote);
}

export async function searchNotes(
  tenantId: string,
  queryText: string,
  limit = 10,
): Promise<Note[]> {
  const like = `%${queryText}%`;
  return (
    await query(
      `SELECT * FROM notes
        WHERE tenant_id = ? AND (key LIKE ? OR body LIKE ?)
        ORDER BY updated_at DESC LIMIT ?`,
      [tenantId, like, like, limit],
    )
  ).map(toNote);
}

// ---------------------------------------------------------------- metrics

function toMetric(r: Row): Metric {
  return {
    id: str(r.id),
    tenantId: str(r.tenant_id),
    date: str(r.date),
    key: str(r.key),
    value: num(r.value),
    unit: strOrNull(r.unit),
  };
}

export async function recordMetric(input: {
  tenantId: string;
  date: string;
  key: string;
  value: number;
  unit?: string | null;
}): Promise<void> {
  await run(
    `INSERT INTO metrics (id, tenant_id, date, key, value, unit)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, date, key)
     DO UPDATE SET value = excluded.value, unit = excluded.unit`,
    [newId("mtr"), input.tenantId, input.date, input.key, input.value, input.unit ?? null],
  );
}

export async function listMetrics(tenantId: string, sinceDate: string): Promise<Metric[]> {
  return (
    await query(`SELECT * FROM metrics WHERE tenant_id = ? AND date >= ? ORDER BY date DESC, key`, [
      tenantId,
      sinceDate,
    ])
  ).map(toMetric);
}

// ------------------------------------------------------------ audit logs

export async function writeAudit(input: {
  tenantId: string;
  actor: string;
  action: string;
  target?: string | null;
  detail?: string | null;
}): Promise<void> {
  await run(
    `INSERT INTO audit_logs (id, tenant_id, actor, action, target, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      newId("aud"),
      input.tenantId,
      input.actor,
      input.action,
      input.target ?? null,
      input.detail ?? null,
      nowIso(),
    ],
  );
}

export async function listAudit(tenantId: string, limit = 100): Promise<AuditLog[]> {
  return (
    await query(`SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`, [
      tenantId,
      limit,
    ])
  ).map((r) => ({
    id: str(r.id),
    tenantId: str(r.tenant_id),
    actor: str(r.actor),
    action: str(r.action),
    target: strOrNull(r.target),
    detail: strOrNull(r.detail),
    createdAt: str(r.created_at),
  }));
}

// ----------------------------------------------------------- media assets

function toMediaAsset(r: Row): MediaAsset {
  const raw = str(r.tags);
  return {
    id: str(r.id),
    tenantId: str(r.tenant_id),
    url: str(r.url),
    description: str(r.description),
    tags: raw.length > 0 ? raw.split(",").map((t) => t.trim()).filter(Boolean) : [],
    createdAt: str(r.created_at),
  };
}

export async function addMediaAsset(input: {
  tenantId: string;
  url: string;
  description: string;
  tags?: string[];
}): Promise<void> {
  await run(
    `INSERT INTO media_assets (id, tenant_id, url, description, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, url)
     DO UPDATE SET description = excluded.description, tags = excluded.tags`,
    [
      newId("med"),
      input.tenantId,
      input.url,
      input.description,
      (input.tags ?? []).join(","),
      nowIso(),
    ],
  );
}

export async function listMediaAssets(tenantId: string, limit = 50): Promise<MediaAsset[]> {
  return (
    await query(
      `SELECT * FROM media_assets WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`,
      [tenantId, limit],
    )
  ).map(toMediaAsset);
}

/** AI社員が「秋の写真」のように探すためのゆるい検索。 */
export async function searchMediaAssets(
  tenantId: string,
  queryText: string,
  limit = 20,
): Promise<MediaAsset[]> {
  const like = `%${queryText}%`;
  return (
    await query(
      `SELECT * FROM media_assets
        WHERE tenant_id = ? AND (description LIKE ? OR tags LIKE ?)
        ORDER BY created_at DESC LIMIT ?`,
      [tenantId, like, like, limit],
    )
  ).map(toMediaAsset);
}

/** 下書きに載った画像URLが、本当に登録済みのものかを確かめる。 */
export async function mediaUrlsAreRegistered(
  tenantId: string,
  urls: string[],
): Promise<boolean> {
  if (urls.length === 0) return false;
  const known = new Set((await listMediaAssets(tenantId, 500)).map((m) => m.url));
  return urls.every((u) => known.has(u));
}

// ------------------------------------------------------- connector accounts

function toConnectorAccount(r: Row): ConnectorAccount {
  return {
    id: str(r.id),
    tenantId: str(r.tenant_id),
    provider: str(r.provider) as ConnectorProvider,
    accountRef: str(r.account_ref),
    credentials: json<Record<string, unknown>>(r.credentials_json, {}),
    status: str(r.status) as ConnectorAccount["status"],
  };
}

export async function upsertConnectorAccount(input: {
  tenantId: string;
  provider: ConnectorProvider;
  accountRef: string;
  credentials?: Record<string, unknown>;
  status?: ConnectorAccount["status"];
}): Promise<void> {
  await run(
    `INSERT INTO connector_accounts (id, tenant_id, provider, account_ref, credentials_json, status)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, provider)
     DO UPDATE SET account_ref = excluded.account_ref,
                   credentials_json = excluded.credentials_json,
                   status = excluded.status`,
    [
      newId("con"),
      input.tenantId,
      input.provider,
      input.accountRef,
      JSON.stringify(input.credentials ?? {}),
      input.status ?? "mock",
    ],
  );
}

export async function getConnectorAccount(
  tenantId: string,
  provider: ConnectorProvider,
): Promise<ConnectorAccount | null> {
  const row = await first(`SELECT * FROM connector_accounts WHERE tenant_id = ? AND provider = ?`, [
    tenantId,
    provider,
  ]);
  return row ? toConnectorAccount(row) : null;
}

export async function listConnectorAccounts(tenantId: string): Promise<ConnectorAccount[]> {
  return (await query(`SELECT * FROM connector_accounts WHERE tenant_id = ?`, [tenantId])).map(
    toConnectorAccount,
  );
}
