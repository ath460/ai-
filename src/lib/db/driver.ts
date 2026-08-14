/**
 * DB ドライバの抽象。
 *
 * SQLite（node:sqlite・同期）と Postgres（pg・非同期）の両方を同じ形で扱うため、
 * インターフェースは非同期に揃えている。repo.ts はこの型にしか依存しない。
 *
 * SQL は常に `?` プレースホルダで書く。Postgres 側で $1, $2 に変換する。
 */

export type Dialect = "sqlite" | "postgres";

export interface DbDriver {
  readonly dialect: Dialect;
  /** SELECT。行を配列で返す。 */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** INSERT / UPDATE / DELETE。影響行数を返す。 */
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  /** DDL など、複数文をまとめて流す。 */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * `?` を `$1, $2, ...` に変換する。
 *
 * 注意: 文字列リテラル内の `?` は考慮していない。
 * repo.ts の SQL には該当箇所が無く、増やす場合もパラメータ化すること
 * （リテラルに `?` を直書きしない）。
 */
export function toPositionalPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}
