/**
 * 5フィールドの cron 式を、指定タイムゾーンの壁時計で評価する。
 *
 * 外部依存を入れずに済ませているのは、必要なのが「今この分に該当するか」の
 * 判定だけだから。次回実行時刻の算出やジョブ常駐は要らない
 * （ワーカーも Vercel Cron も毎分こちらを呼ぶ形にしている）。
 *
 * 対応記法: *  a  a-b  a,b,c  * /n  a-b/n
 * 曜日は 0=日曜。
 */

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface ZonedParts {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

/** UTC の Date を、指定タイムゾーンでの各フィールドに分解する。 */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "0";

  return {
    minute: Number(get("minute")),
    hour: Number(get("hour")),
    dayOfMonth: Number(get("day")),
    month: Number(get("month")),
    dayOfWeek: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

function fieldMatches(spec: string, value: number, min: number, max: number): boolean {
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;

    const [rangePart, stepPart] = trimmed.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step <= 0) continue;

    let lo: number;
    let hi: number;

    if (rangePart === "*") {
      lo = min;
      hi = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-").map(Number);
      lo = a;
      hi = b;
    } else {
      const single = Number(rangePart);
      lo = single;
      // "5/15" のようにステップ付きの単一値は「5 から max まで step ごと」と解釈する。
      hi = stepPart === undefined ? single : max;
    }

    if (!Number.isInteger(lo) || !Number.isInteger(hi)) continue;
    if (value < lo || value > hi) continue;
    if ((value - lo) % step === 0) return true;
  }
  return false;
}

/** cron 式が、指定タイムゾーンにおける date の「分」に該当するか。 */
export function cronMatches(expression: string, date: Date, timeZone: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const p = zonedParts(date, timeZone);

  // 日と曜日はどちらかが * なら AND、両方指定なら OR（標準 cron の挙動）。
  const domIsWildcard = dayOfMonth === "*";
  const dowIsWildcard = dayOfWeek === "*";
  const domMatch = fieldMatches(dayOfMonth, p.dayOfMonth, 1, 31);
  const dowMatch = fieldMatches(dayOfWeek, p.dayOfWeek, 0, 6);
  const dayMatch =
    domIsWildcard || dowIsWildcard ? domMatch && dowMatch : domMatch || dowMatch;

  return (
    fieldMatches(minute, p.minute, 0, 59) &&
    fieldMatches(hour, p.hour, 0, 23) &&
    fieldMatches(month, p.month, 1, 12) &&
    dayMatch
  );
}

/** 人が読める説明。設定画面で cron 式の横に出す。 */
export function describeCron(expression: string): string {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return expression;
  const [minute, hour, , , dayOfWeek] = fields;

  const days =
    dayOfWeek === "*"
      ? "毎日"
      : dayOfWeek === "1-5"
        ? "平日"
        : `曜日 ${dayOfWeek}`;

  if (hour === "*" && minute.startsWith("*/")) return `${days} ${minute.slice(2)}分おき`;
  if (hour.startsWith("*/")) return `${days} ${hour.slice(2)}時間おき`;
  if (/^\d+$/.test(hour) && /^\d+$/.test(minute)) {
    return `${days} ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  }
  return expression;
}
