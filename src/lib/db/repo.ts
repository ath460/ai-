import { getDb, newId, nowIso } from "./client.ts";
import type {
  Approval,
  ApprovalStatus,
  AuditLog,
  ConnectorAccount,
  ConnectorProvider,
  ExternalAction,
  Job,
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

export function createTenant(input: {
  name: string;
  industry?: string;
  timezone?: string;
  settings?: TenantSettings;
}): Tenant {
  const tenant: Tenant = {
    id: newId("tnt"),
    name: input.name,
    industry: input.industry ?? null,
    timezone: input.timezone ?? "Asia/Tokyo",
    settings: input.settings ?? {},
    createdAt: nowIso(),
  };
  getDb()
    .prepare(
      `INSERT INTO tenants (id, name, industry, timezone, settings_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      tenant.id,
      tenant.name,
      tenant.industry,
      tenant.timezone,
      JSON.stringify(tenant.settings),
      tenant.createdAt,
    );
  return tenant;
}

export function listTenants(): Tenant[] {
  return (getDb().prepare(`SELECT * FROM tenants ORDER BY created_at`).all() as Row[]).map(toTenant);
}

export function getTenant(tenantId: string): Tenant | null {
  const row = getDb().prepare(`SELECT * FROM tenants WHERE id = ?`).get(tenantId) as Row | undefined;
  return row ? toTenant(row) : null;
}

/**
 * 既定テナント。ONYX 社内運用ではこれ1件しか使わない。
 * 環境変数 ONYX_TENANT_ID が指定されていればそれを優先する。
 */
export function getDefaultTenant(): Tenant | null {
  const pinned = process.env.ONYX_TENANT_ID;
  if (pinned) return getTenant(pinned);
  return listTenants()[0] ?? null;
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

export function createStaff(input: {
  tenantId: string;
  role: StaffRole;
  name: string;
  persona: string;
}): Staff {
  const staff: Staff = { ...input, id: newId("stf"), enabled: true, createdAt: nowIso() };
  getDb()
    .prepare(
      `INSERT INTO staff (id, tenant_id, role, name, persona, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(staff.id, staff.tenantId, staff.role, staff.name, staff.persona, staff.createdAt);
  return staff;
}

export function listStaff(tenantId: string): Staff[] {
  return (
    getDb().prepare(`SELECT * FROM staff WHERE tenant_id = ? ORDER BY created_at`).all(tenantId) as Row[]
  ).map(toStaff);
}

export function getStaff(tenantId: string, staffId: string): Staff | null {
  const row = getDb()
    .prepare(`SELECT * FROM staff WHERE tenant_id = ? AND id = ?`)
    .get(tenantId, staffId) as Row | undefined;
  return row ? toStaff(row) : null;
}

export function setStaffEnabled(tenantId: string, staffId: string, enabled: boolean): void {
  getDb()
    .prepare(`UPDATE staff SET enabled = ? WHERE tenant_id = ? AND id = ?`)
    .run(enabled ? 1 : 0, tenantId, staffId);
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
    enabled: bool(r.enabled),
    lastRunAt: strOrNull(r.last_run_at),
  };
}

export function createJob(input: {
  tenantId: string;
  staffId: string;
  name: string;
  cron: string;
  instruction: string;
}): Job {
  const job: Job = { ...input, id: newId("job"), enabled: true, lastRunAt: null };
  getDb()
    .prepare(
      `INSERT INTO jobs (id, tenant_id, staff_id, name, cron, instruction, enabled, last_run_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, NULL)`,
    )
    .run(job.id, job.tenantId, job.staffId, job.name, job.cron, job.instruction);
  return job;
}

export function listJobs(tenantId: string): Job[] {
  return (getDb().prepare(`SELECT * FROM jobs WHERE tenant_id = ?`).all(tenantId) as Row[]).map(toJob);
}

/** スケジューラ用。全テナント分の有効ジョブを返す唯一の例外。 */
export function listAllEnabledJobs(): Job[] {
  return (
    getDb()
      .prepare(
        `SELECT j.* FROM jobs j
         JOIN staff s ON s.id = j.staff_id
         WHERE j.enabled = 1 AND s.enabled = 1`,
      )
      .all() as Row[]
  ).map(toJob);
}

export function touchJobLastRun(jobId: string, at: string): void {
  getDb().prepare(`UPDATE jobs SET last_run_at = ? WHERE id = ?`).run(at, jobId);
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
export function claimRunSlot(input: {
  tenantId: string;
  jobId: string;
  staffId: string;
  slotKey: string;
}): Run | null {
  const run: Run = {
    id: newId("run"),
    tenantId: input.tenantId,
    jobId: input.jobId,
    staffId: input.staffId,
    slotKey: input.slotKey,
    status: "running",
    startedAt: nowIso(),
    finishedAt: null,
    summary: null,
    error: null,
    inputTokens: 0,
    outputTokens: 0,
  };
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO runs
         (id, tenant_id, job_id, staff_id, slot_key, status, started_at, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, 'running', ?, 0, 0)`,
    )
    .run(run.id, run.tenantId, run.jobId, run.staffId, run.slotKey, run.startedAt);

  if (Number(result.changes) === 0) return null;
  return run;
}

export function finishRun(input: {
  runId: string;
  status: Extract<RunStatus, "succeeded" | "failed">;
  summary?: string | null;
  error?: string | null;
  inputTokens?: number;
  outputTokens?: number;
}): void {
  getDb()
    .prepare(
      `UPDATE runs
          SET status = ?, finished_at = ?, summary = ?, error = ?,
              input_tokens = ?, output_tokens = ?
        WHERE id = ?`,
    )
    .run(
      input.status,
      nowIso(),
      input.summary ?? null,
      input.error ?? null,
      input.inputTokens ?? 0,
      input.outputTokens ?? 0,
      input.runId,
    );
}

export function listRuns(tenantId: string, limit = 50): Run[] {
  return (
    getDb()
      .prepare(`SELECT * FROM runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT ?`)
      .all(tenantId, limit) as Row[]
  ).map(toRun);
}

export function getRun(tenantId: string, runId: string): Run | null {
  const row = getDb()
    .prepare(`SELECT * FROM runs WHERE tenant_id = ? AND id = ?`)
    .get(tenantId, runId) as Row | undefined;
  return row ? toRun(row) : null;
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

export function createTask(input: {
  tenantId: string;
  runId: string;
  staffId: string;
  title: string;
  detail?: string | null;
  status?: TaskStatus;
  approvalId?: string | null;
}): Task {
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
  getDb()
    .prepare(
      `INSERT INTO tasks (id, tenant_id, run_id, staff_id, title, detail, status, approval_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      task.id,
      task.tenantId,
      task.runId,
      task.staffId,
      task.title,
      task.detail,
      task.status,
      task.approvalId,
      task.createdAt,
    );
  return task;
}

export function getTask(tenantId: string, taskId: string): Task | null {
  const row = getDb()
    .prepare(`SELECT * FROM tasks WHERE tenant_id = ? AND id = ?`)
    .get(tenantId, taskId) as Row | undefined;
  return row ? toTask(row) : null;
}

/** 承認・却下の結果を、稼働ログ側の表示にも反映する。 */
export function setTaskStatusByApproval(
  tenantId: string,
  approvalId: string,
  status: TaskStatus,
  detail?: string,
): void {
  if (detail === undefined) {
    getDb()
      .prepare(`UPDATE tasks SET status = ? WHERE tenant_id = ? AND approval_id = ?`)
      .run(status, tenantId, approvalId);
    return;
  }
  getDb()
    .prepare(`UPDATE tasks SET status = ?, detail = ? WHERE tenant_id = ? AND approval_id = ?`)
    .run(status, detail, tenantId, approvalId);
}

export function listTasks(tenantId: string, opts?: { since?: string; limit?: number }): Task[] {
  const limit = opts?.limit ?? 100;
  if (opts?.since) {
    return (
      getDb()
        .prepare(
          `SELECT * FROM tasks WHERE tenant_id = ? AND created_at >= ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(tenantId, opts.since, limit) as Row[]
    ).map(toTask);
  }
  return (
    getDb()
      .prepare(`SELECT * FROM tasks WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(tenantId, limit) as Row[]
  ).map(toTask);
}

export function listTasksByRun(tenantId: string, runId: string): Task[] {
  return (
    getDb()
      .prepare(`SELECT * FROM tasks WHERE tenant_id = ? AND run_id = ? ORDER BY created_at`)
      .all(tenantId, runId) as Row[]
  ).map(toTask);
}

export function listTasksByStaff(tenantId: string, staffId: string, limit = 50): Task[] {
  return (
    getDb()
      .prepare(
        `SELECT * FROM tasks WHERE tenant_id = ? AND staff_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(tenantId, staffId, limit) as Row[]
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

export function createApproval(input: {
  tenantId: string;
  runId: string | null;
  staffId: string;
  action: ExternalAction;
  preview: string;
  payload: Record<string, unknown>;
  risk?: RiskLevel;
}): Approval {
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
  getDb()
    .prepare(
      `INSERT INTO approvals
         (id, tenant_id, run_id, staff_id, action, preview, payload_json, risk, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(
      approval.id,
      approval.tenantId,
      approval.runId,
      approval.staffId,
      approval.action,
      approval.preview,
      JSON.stringify(approval.payload),
      approval.risk,
      approval.createdAt,
    );
  return approval;
}

export function listApprovals(
  tenantId: string,
  opts?: { status?: ApprovalStatus; limit?: number },
): Approval[] {
  const limit = opts?.limit ?? 100;
  if (opts?.status) {
    return (
      getDb()
        .prepare(
          `SELECT * FROM approvals WHERE tenant_id = ? AND status = ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(tenantId, opts.status, limit) as Row[]
    ).map(toApproval);
  }
  return (
    getDb()
      .prepare(`SELECT * FROM approvals WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(tenantId, limit) as Row[]
  ).map(toApproval);
}

export function getApproval(tenantId: string, approvalId: string): Approval | null {
  const row = getDb()
    .prepare(`SELECT * FROM approvals WHERE tenant_id = ? AND id = ?`)
    .get(tenantId, approvalId) as Row | undefined;
  return row ? toApproval(row) : null;
}

/**
 * pending のものだけを approved / rejected に遷移させる。
 * 二重タップやワーカーとの競合で同じ承認が2回実行されるのを防ぐ。
 * 遷移できたときだけ true。
 */
export function decideApproval(input: {
  tenantId: string;
  approvalId: string;
  decision: "approved" | "rejected";
  decidedBy: string;
  rejectionReason?: string | null;
}): boolean {
  const result = getDb()
    .prepare(
      `UPDATE approvals
          SET status = ?, decided_at = ?, decided_by = ?, rejection_reason = ?
        WHERE tenant_id = ? AND id = ? AND status = 'pending'`,
    )
    .run(
      input.decision,
      nowIso(),
      input.decidedBy,
      input.rejectionReason ?? null,
      input.tenantId,
      input.approvalId,
    );
  return Number(result.changes) > 0;
}

export function markApprovalExecuted(input: {
  approvalId: string;
  status: Extract<ApprovalStatus, "executed" | "failed">;
  resultSummary: string;
}): void {
  getDb()
    .prepare(`UPDATE approvals SET status = ?, result_summary = ? WHERE id = ?`)
    .run(input.status, input.resultSummary, input.approvalId);
}

export function countPendingApprovals(tenantId: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM approvals WHERE tenant_id = ? AND status = 'pending'`)
    .get(tenantId) as Row | undefined;
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

export function upsertNote(input: {
  tenantId: string;
  staffId?: string | null;
  key: string;
  body: string;
}): Note {
  const note: Note = {
    id: newId("not"),
    tenantId: input.tenantId,
    staffId: input.staffId ?? null,
    key: input.key,
    body: input.body,
    updatedAt: nowIso(),
  };
  getDb()
    .prepare(
      `INSERT INTO notes (id, tenant_id, staff_id, key, body, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, key)
       DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
    )
    .run(note.id, note.tenantId, note.staffId, note.key, note.body, note.updatedAt);
  return note;
}

export function listNotes(tenantId: string, limit = 50): Note[] {
  return (
    getDb()
      .prepare(`SELECT * FROM notes WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT ?`)
      .all(tenantId, limit) as Row[]
  ).map(toNote);
}

export function searchNotes(tenantId: string, query: string, limit = 10): Note[] {
  const like = `%${query}%`;
  return (
    getDb()
      .prepare(
        `SELECT * FROM notes
          WHERE tenant_id = ? AND (key LIKE ? OR body LIKE ?)
          ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(tenantId, like, like, limit) as Row[]
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

export function recordMetric(input: {
  tenantId: string;
  date: string;
  key: string;
  value: number;
  unit?: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO metrics (id, tenant_id, date, key, value, unit)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, date, key)
       DO UPDATE SET value = excluded.value, unit = excluded.unit`,
    )
    .run(newId("mtr"), input.tenantId, input.date, input.key, input.value, input.unit ?? null);
}

export function listMetrics(tenantId: string, sinceDate: string): Metric[] {
  return (
    getDb()
      .prepare(`SELECT * FROM metrics WHERE tenant_id = ? AND date >= ? ORDER BY date DESC, key`)
      .all(tenantId, sinceDate) as Row[]
  ).map(toMetric);
}

// ------------------------------------------------------------ audit logs

export function writeAudit(input: {
  tenantId: string;
  actor: string;
  action: string;
  target?: string | null;
  detail?: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO audit_logs (id, tenant_id, actor, action, target, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId("aud"),
      input.tenantId,
      input.actor,
      input.action,
      input.target ?? null,
      input.detail ?? null,
      nowIso(),
    );
}

export function listAudit(tenantId: string, limit = 100): AuditLog[] {
  return (
    getDb()
      .prepare(`SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(tenantId, limit) as Row[]
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

export function addMediaAsset(input: {
  tenantId: string;
  url: string;
  description: string;
  tags?: string[];
}): void {
  getDb()
    .prepare(
      `INSERT INTO media_assets (id, tenant_id, url, description, tags, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, url)
       DO UPDATE SET description = excluded.description, tags = excluded.tags`,
    )
    .run(
      newId("med"),
      input.tenantId,
      input.url,
      input.description,
      (input.tags ?? []).join(","),
      nowIso(),
    );
}

export function listMediaAssets(tenantId: string, limit = 50): MediaAsset[] {
  return (
    getDb()
      .prepare(`SELECT * FROM media_assets WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(tenantId, limit) as Row[]
  ).map(toMediaAsset);
}

/** AI社員が「秋の写真」のように探すためのゆるい検索。 */
export function searchMediaAssets(tenantId: string, query: string, limit = 20): MediaAsset[] {
  const like = `%${query}%`;
  return (
    getDb()
      .prepare(
        `SELECT * FROM media_assets
          WHERE tenant_id = ? AND (description LIKE ? OR tags LIKE ?)
          ORDER BY created_at DESC LIMIT ?`,
      )
      .all(tenantId, like, like, limit) as Row[]
  ).map(toMediaAsset);
}

/** 下書きに載った画像URLが、本当に登録済みのものかを確かめる。 */
export function mediaUrlsAreRegistered(tenantId: string, urls: string[]): boolean {
  if (urls.length === 0) return false;
  const known = new Set(listMediaAssets(tenantId, 500).map((m) => m.url));
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

export function upsertConnectorAccount(input: {
  tenantId: string;
  provider: ConnectorProvider;
  accountRef: string;
  credentials?: Record<string, unknown>;
  status?: ConnectorAccount["status"];
}): void {
  getDb()
    .prepare(
      `INSERT INTO connector_accounts (id, tenant_id, provider, account_ref, credentials_json, status)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, provider)
       DO UPDATE SET account_ref = excluded.account_ref,
                     credentials_json = excluded.credentials_json,
                     status = excluded.status`,
    )
    .run(
      newId("con"),
      input.tenantId,
      input.provider,
      input.accountRef,
      JSON.stringify(input.credentials ?? {}),
      input.status ?? "mock",
    );
}

export function getConnectorAccount(
  tenantId: string,
  provider: ConnectorProvider,
): ConnectorAccount | null {
  const row = getDb()
    .prepare(`SELECT * FROM connector_accounts WHERE tenant_id = ? AND provider = ?`)
    .get(tenantId, provider) as Row | undefined;
  return row ? toConnectorAccount(row) : null;
}

export function listConnectorAccounts(tenantId: string): ConnectorAccount[] {
  return (
    getDb().prepare(`SELECT * FROM connector_accounts WHERE tenant_id = ?`).all(tenantId) as Row[]
  ).map(toConnectorAccount);
}
