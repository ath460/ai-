import type { DbDriver } from "./driver.ts";
import { schemaSql } from "./schema.ts";

/**
 * DB 接続のシングルトン。
 *
 * DATABASE_URL があれば Postgres、無ければ SQLite。
 * これがそのままデプロイ先の選択になる:
 *   - VPS に1台で載せる           → SQLite（設定不要）
 *   - Render / Railway / Vercel  → Postgres（ファイルシステムが永続しないため）
 *
 * ドライバは動的に読み込む。static import にすると、Postgres だけを使う環境でも
 * sqlite.ts の `node:sqlite` が評価され、その API を持たない Node（22.5未満）や
 * ランタイムで起動時に落ちる。使う側だけを読み込めばその依存は発生しない。
 */

let driverPromise: Promise<DbDriver> | null = null;

async function createDriver(): Promise<DbDriver> {
  if (process.env.DATABASE_URL) {
    const { createPostgresDriver } = await import("./postgres.ts");
    return createPostgresDriver();
  }
  const { createSqliteDriver } = await import("./sqlite.ts");
  return createSqliteDriver();
}

async function initialize(): Promise<DbDriver> {
  const driver = await createDriver();
  // CREATE TABLE IF NOT EXISTS だけなので、毎起動流しても安全。
  // デプロイ先で別途マイグレーションを走らせなくても、最初のアクセスで整う。
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
