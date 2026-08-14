import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DbDriver } from "./driver.ts";

/**
 * SQLite ドライバ（node:sqlite / Node 22 同梱）。
 *
 * ネイティブビルドが要らないので `npm install` だけで動く。
 * 1台のVPSに全部載せる構成では、これが一番運用が軽い。
 */
export function createSqliteDriver(path?: string): DbDriver {
  const file = resolve(path ?? process.env.ONYX_DB_PATH ?? "./data/onyx.sqlite");
  mkdirSync(dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  // WAL: ダッシュボードの読み取りと cron ワーカーの書き込みを並行させる。
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  // ワーカーとWebが同時に書きにいったとき、即座に諦めず5秒待つ。
  db.exec("PRAGMA busy_timeout = 5000;");

  return {
    dialect: "sqlite",

    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      // node:sqlite は同期。await する側から見れば違いは無い。
      return db.prepare(sql).all(...(params as never[])) as T[];
    },

    async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
      const result = db.prepare(sql).run(...(params as never[]));
      return { changes: Number(result.changes) };
    },

    async exec(sql: string): Promise<void> {
      db.exec(sql);
    },

    async close(): Promise<void> {
      db.close();
    },
  };
}
