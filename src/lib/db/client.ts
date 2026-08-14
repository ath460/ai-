import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SCHEMA_SQL } from "./schema.ts";

/**
 * SQLite 接続のシングルトン。
 *
 * node:sqlite（Node 22 同梱）を使うのでネイティブビルドが不要。
 * Postgres へ移す場合はこのファイルと repo.ts の実装だけを差し替える。
 * 呼び出し側（AI社員エンジン・UI）はこの型に依存していない。
 */

let instance: DatabaseSync | null = null;

function databasePath(): string {
  return resolve(process.env.ONYX_DB_PATH ?? "./data/onyx.sqlite");
}

export function getDb(): DatabaseSync {
  if (instance) return instance;

  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  // WAL: ダッシュボードの読み取りと cron ワーカーの書き込みを並行させる。
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  // ワーカーとWebが同時に書きにいったとき、即座に諦めず5秒待つ。
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA_SQL);

  instance = db;
  return db;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

/** 短いプレフィックス付きID。ログ上でどのテーブルの行か一目で分かるようにする。 */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
