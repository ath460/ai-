import { closeDb, getDb } from "../src/lib/db/client.ts";

/**
 * スキーマ適用。getDb() が CREATE TABLE IF NOT EXISTS を流すので、
 * 何度実行しても安全。
 */
getDb();
console.log("スキーマを適用しました。");
closeDb();
