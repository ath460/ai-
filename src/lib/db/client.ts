import type { DbDriver } from "./driver.ts";
import { createPostgresDriver } from "./postgres.ts";
import { schemaSql } from "./schema.ts";
import { createSqliteDriver } from "./sqlite.ts";

/**
 * DB 接続のシングルトン。
 *
 * DATABASE_URL があれば Postgres、無ければ SQLite。
 * これがそのままデプロイ先の選択になる:
 *   - VPS に1台で載せる      → SQLite（設定不要）
 *   - Vercel / Railway など  → Postgres（ファイルシステムが永続しないため）
 */

let driverPromise: Promise<DbDriver> | null = null;

function createDriver(): DbDriver {
  return process.env.DATABASE_URL ? createPostgresDriver() : createSqliteDriver();
}

async function initialize(): Promise<DbDriver> {
  const driver = createDriver();
  // CREATE TABLE IF NOT EXISTS だけなので、毎起動流しても安全。
  await driver.exec(schemaSql(driver.dialect));
  return driver;
}

/**
 * 初期化込みで接続を返す。
 *
 * Promise をキャッシュしているので、起動直後に並行して呼ばれても
 * スキーマ適用は1回しか走らない。
 */
export function getDb(): Promise<DbDriver> {
  driverPromise ??= initialize();
  return driverPromise;
}

export async function closeDb(): Promise<void> {
  if (!driverPromise) return;
  const driver = await driverPromise;
  driverPromise = null;
  await driver.close();
}

/** 短いプレフィックス付きID。ログ上でどのテーブルの行か一目で分かるようにする。 */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
