import type { Dialect } from "./driver.ts";

/**
 * スキーマ定義。CREATE TABLE IF NOT EXISTS のみで構成し、
 * 起動時に毎回流しても安全（= マイグレーション兼初期化）。
 *
 * 全テーブルが tenant_id を持つ。クライアント提供時に店舗ごとの
 * データが混ざらないよう、repo 層の全クエリで tenant_id を必須にしている。
 *
 * SQLite と Postgres の差はごく少ない。浮動小数の型名だけ分岐する。
 */
export function schemaSql(dialect: Dialect): string {
  const REAL = dialect === "postgres" ? "DOUBLE PRECISION" : "REAL";

  return `
CREATE TABLE IF NOT EXISTS tenants (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  industry      TEXT,
  timezone      TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('sales','marketing','backoffice')),
  name       TEXT NOT NULL,
  persona    TEXT NOT NULL DEFAULT '',
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_tenant ON staff(tenant_id);

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id    TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  cron        TEXT NOT NULL,
  instruction TEXT NOT NULL,
  -- モデルを呼ぶ前の足切り条件。'always' は毎回起動、
  -- 'new_inbox' は前回実行以降に新着メールが無ければ起動しない。
  precheck    TEXT NOT NULL DEFAULT 'always',
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_tenant ON jobs(tenant_id);

CREATE TABLE IF NOT EXISTS runs (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  staff_id      TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  slot_key      TEXT NOT NULL,
  -- skipped は「事前チェックで足切りしてモデルを呼ばなかった」状態。
  -- 失敗ではないので failed と分けている。
  status        TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','skipped')),
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  summary       TEXT,
  error         TEXT,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0
);
-- 冪等性の要。同じスロットのジョブは何度叩かれても1回しか走らない。
CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_slot ON runs(slot_key);
CREATE INDEX IF NOT EXISTS idx_runs_tenant_started ON runs(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_job_started ON runs(job_id, started_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  staff_id   TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  detail     TEXT,
  status     TEXT NOT NULL CHECK (status IN ('done','waiting_approval','blocked')),
  -- 承認キュー行きのタスクだけ、対応する承認レコードを指す。
  -- 承認/却下されたときに、このタスクの表示も同時に更新するため。
  approval_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_created ON tasks(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_approval ON tasks(approval_id);

CREATE TABLE IF NOT EXISTS approvals (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id           TEXT REFERENCES runs(id) ON DELETE SET NULL,
  staff_id         TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  action           TEXT NOT NULL,
  preview          TEXT NOT NULL,
  payload_json     TEXT NOT NULL,
  risk             TEXT NOT NULL DEFAULT 'medium' CHECK (risk IN ('low','medium','high')),
  status           TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','executed','failed','expired')),
  created_at       TEXT NOT NULL,
  decided_at       TEXT,
  decided_by       TEXT,
  rejection_reason TEXT,
  result_summary   TEXT
);
CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id   TEXT REFERENCES staff(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  body       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_key ON notes(tenant_id, key);

CREATE TABLE IF NOT EXISTS metrics (
  id        TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date      TEXT NOT NULL,
  key       TEXT NOT NULL,
  value     ${REAL} NOT NULL,
  unit      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_unique ON metrics(tenant_id, date, key);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id, created_at DESC);

-- 店舗の写真ライブラリ。
-- Instagram は画像なしで投稿できず、しかも Meta 側が取りに行くため
-- 「公開された https URL」でなければならない。AI社員が画像を捏造できないので、
-- 使える写真をここに登録しておき、その中から選ばせる。
CREATE TABLE IF NOT EXISTS media_assets (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  -- AI社員が「どれを使うか」を選ぶための説明。人間向けではなくモデル向けに書く。
  description TEXT NOT NULL,
  tags        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_tenant ON media_assets(tenant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_url ON media_assets(tenant_id, url);

CREATE TABLE IF NOT EXISTS connector_accounts (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,
  account_ref      TEXT NOT NULL,
  credentials_json TEXT NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'mock'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_unique ON connector_accounts(tenant_id, provider);
`;
}
