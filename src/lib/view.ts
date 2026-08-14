import { zonedParts } from "./scheduler/cron.ts";

/**
 * 画面側で使う日付ユーティリティ。
 * 「今日」の境界は店舗のタイムゾーンで決める。サーバーが UTC でも
 * 深夜1時の投稿が「昨日」に落ちないようにするため。
 */

/** 店舗のタイムゾーンにおける今日の 00:00 を、UTC の ISO 文字列で返す。 */
export function startOfTodayIso(timeZone: string, now: Date = new Date()): string {
  const p = zonedParts(now, timeZone);
  // 現地の 00:00 は、現在時刻から現地の経過時分を引いた時点。
  const elapsedMs = (p.hour * 60 + p.minute) * 60_000 + now.getSeconds() * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - elapsedMs).toISOString();
}

/** 店舗のタイムゾーンでの YYYY-MM-DD。 */
export function todayDateString(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** N 日前の YYYY-MM-DD。日報の比較期間に使う。 */
export function daysAgoDateString(timeZone: string, days: number, now: Date = new Date()): string {
  return todayDateString(timeZone, new Date(now.getTime() - days * 86_400_000));
}
