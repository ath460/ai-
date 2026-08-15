/**
 * ドメイン型定義。
 *
 * このファイルは DB 実装（現状 SQLite）に依存しない。
 * Postgres に差し替えても、ここと repo のシグネチャは変わらない。
 */

/** AI社員の職種。サイトで謳っている「営業・マーケティング・事務」に対応する。 */
export type StaffRole = "sales" | "marketing" | "backoffice";

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  sales: "営業",
  marketing: "マーケティング",
  backoffice: "事務",
};

/**
 * 実行単位（1回のジョブ起動）の状態。
 *
 * skipped は「事前チェックで足切りし、モデルを呼ばなかった」状態。
 * 失敗ではないので failed と分けている。費用の大半はモデル呼び出しなので、
 * ここを分けておくと「何回分の費用を抑えたか」がそのまま出せる。
 */
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";

/** 稼働タスク（AI社員がやった1件の仕事）の状態。 */
export type TaskStatus = "done" | "waiting_approval" | "blocked";

/** 承認待ちアクションの状態。 */
export type ApprovalStatus = "pending" | "approved" | "rejected" | "executed" | "failed" | "expired";

/**
 * 外部に影響が出るアクションの種別。
 * ここに載っているものは AI社員が単独で実行できず、必ず承認キューを通る。
 */
export type ExternalAction =
  | "send_email"
  | "reply_email"
  | "create_calendar_event"
  | "post_social"
  | "update_listing";

export const EXTERNAL_ACTION_LABEL: Record<ExternalAction, string> = {
  send_email: "メール送信",
  reply_email: "メール返信",
  create_calendar_event: "予定の登録",
  post_social: "SNS投稿",
  update_listing: "掲載情報の更新",
};

/** 承認画面での危険度表示。文面ミスと金額ミスを同列に扱わないための区別。 */
export type RiskLevel = "low" | "medium" | "high";

export interface Tenant {
  id: string;
  name: string;
  industry: string | null;
  timezone: string;
  /** 文体・NGワード・営業時間など、AI社員の全ジョブに効く設定。 */
  settings: TenantSettings;
  createdAt: string;
}

export interface TenantSettings {
  /** 店舗の文体設計。「担当が変わっても文体が崩れない」の実体。 */
  toneOfVoice?: string;
  /** 使ってはいけない表現・約束できない内容。 */
  ngPhrases?: string[];
  businessHours?: string;
  /** 承認なしで外部発信を許可するアクション（既定は空 = 全て承認必須）。 */
  autoApprove?: ExternalAction[];
}

export interface Staff {
  id: string;
  tenantId: string;
  role: StaffRole;
  name: string;
  /** この AI社員固有の役割説明。system prompt に差し込まれる。 */
  persona: string;
  enabled: boolean;
  createdAt: string;
}

/**
 * モデルを呼ぶ前の足切り条件。
 *
 * 費用の大半は Opus の1回の起動なので、「やることが無いのに起動する」を
 * 潰せるかどうかが運用コストを決める。判定に使うのはコネクタの読み取りだけで、
 * モデルは呼ばない。
 *
 * - always    : 毎回起動する（日次の集計や投稿など、必ず仕事がある種類）
 * - new_inbox : 前回稼働以降に新着メールが無ければ起動しない
 */
export type JobPrecheck = "always" | "new_inbox";

export interface Job {
  id: string;
  tenantId: string;
  staffId: string;
  name: string;
  /** 5フィールドの cron 式。テナントのタイムゾーンで評価する。 */
  cron: string;
  /** そのジョブでAI社員に与える指示。 */
  instruction: string;
  precheck: JobPrecheck;
  enabled: boolean;
  lastRunAt: string | null;
}

export interface Run {
  id: string;
  tenantId: string;
  jobId: string;
  staffId: string;
  /** 冪等キー。`${jobId}@${スロット時刻}`。UNIQUE 制約で二重起動を防ぐ。 */
  slotKey: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  /** AI社員が書いた、人間向けの一行サマリ。 */
  summary: string | null;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
}

export interface Task {
  id: string;
  tenantId: string;
  runId: string;
  staffId: string;
  title: string;
  detail: string | null;
  status: TaskStatus;
  /** 承認キュー行きのタスクのみ、対応する承認レコードのID。 */
  approvalId: string | null;
  createdAt: string;
}

export interface Approval {
  id: string;
  tenantId: string;
  runId: string | null;
  staffId: string;
  action: ExternalAction;
  /** 承認画面にそのまま出す、人が読める要約（宛先・件名・本文の頭など）。 */
  preview: string;
  /** コネクタに渡す実行ペイロード。 */
  payload: Record<string, unknown>;
  risk: RiskLevel;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  /** 却下時に人が書いた理由。次回以降の指示に効かせる。 */
  rejectionReason: string | null;
  resultSummary: string | null;
}

/** AI社員の長期記憶。文体サンプル、顧客の傾向、過去の却下理由などを貯める。 */
export interface Note {
  id: string;
  tenantId: string;
  staffId: string | null;
  key: string;
  body: string;
  updatedAt: string;
}

export interface Metric {
  id: string;
  tenantId: string;
  date: string;
  key: string;
  value: number;
  unit: string | null;
}

export interface AuditLog {
  id: string;
  tenantId: string;
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
  createdAt: string;
}

/**
 * 店舗の写真。
 * Instagram は画像必須かつ Meta が取得できる公開URLしか受け付けないため、
 * AI社員はここに登録済みのものからしか選べない。
 */
export interface MediaAsset {
  id: string;
  tenantId: string;
  url: string;
  description: string;
  tags: string[];
  createdAt: string;
}

export type ConnectorProvider =
  | "gmail"
  | "google_calendar"
  | "instagram"
  | "social"
  | "listing";

export interface ConnectorAccount {
  id: string;
  tenantId: string;
  provider: ConnectorProvider;
  /** メールアドレスやカレンダーIDなど、人が見て分かる識別子。 */
  accountRef: string;
  credentials: Record<string, unknown>;
  status: "connected" | "mock" | "error";
}
