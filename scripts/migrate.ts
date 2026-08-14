import { closeDb, getDb } from "../src/lib/db/client.ts";

/**
 * スキーマ適用。getDb() が CREATE TABLE IF NOT EXISTS を流すので、
 * 何度実行しても安全。DATABASE_URL の有無で SQLite / Postgres が切り替わる。
 */
const db = await getDb();
console.log(`スキーマを適用しました（${db.dialect}）。`);
await closeDb();
