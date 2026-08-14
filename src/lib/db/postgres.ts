import pg from "pg";
import { toPositionalPlaceholders, type DbDriver } from "./driver.ts";

/**
 * Postgres ドライバ。
 *
 * Vercel / Railway / Render など、ファイルシステムが永続しない環境で使う。
 * 接続は DATABASE_URL から取る。
 *
 * サーバーレスに載せる場合は、接続数が呼び出しごとに増えないよう
 * プーラー付きの接続文字列（Neon / Supabase の pgbouncer エンドポイント）を使うこと。
 * ここでの max は「1プロセスあたり」の上限で、プロセス数までは制御できない。
 */
export function createPostgresDriver(connectionString?: string): DbDriver {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL が設定されていません。");

  const pool = new pg.Pool({
    connectionString: url,
    // ダッシュボードは1人しか見ないし、ワーカーの同時実行も2本。少なくて足りる。
    max: Number(process.env.PGPOOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // マネージドPostgresは概ねTLS必須。ローカル検証時だけ無効化できるようにする。
    ssl: process.env.PGSSL === "disable" ? undefined : { rejectUnauthorized: false },
  });

  // プール内の接続が落ちてもプロセスごと落とさない。次の取得で張り直される。
  pool.on("error", (err) => {
    console.error("[postgres] アイドル接続でエラー:", err.message);
  });

  return {
    dialect: "postgres",

    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await pool.query(toPositionalPlaceholders(sql), params);
      return result.rows as T[];
    },

    async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
      const result = await pool.query(toPositionalPlaceholders(sql), params);
      return { changes: result.rowCount ?? 0 };
    },

    async exec(sql: string): Promise<void> {
      // DDL は複数文をまとめて流す。pg は単一クエリで複数文を受け付ける。
      await pool.query(sql);
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
