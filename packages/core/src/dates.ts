/** A business date: `YYYY-MM-DD` in Asia/Jakarta, the shape of a Postgres `date`. */
export type BusinessDate = string;

export const BUSINESS_TIME_ZONE = "Asia/Jakarta";

const isoDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The business date of an instant (default: now). */
export function businessDate(at: Date = new Date()): BusinessDate {
  return isoDay.format(at);
}

export function addDays(date: BusinessDate, days: number): BusinessDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export const daysBetween = (from: BusinessDate, to: BusinessDate): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The instant a business date starts. Asia/Jakarta keeps UTC+7 all year, without daylight saving. */
export const dayStart = (date: BusinessDate): Date => new Date(`${date}T00:00:00+07:00`);

const longDay = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** `2026-11-13` → `13 Nov 2026`. */
export function formatDate(date: BusinessDate): string {
  return longDay.format(new Date(`${date}T00:00:00Z`));
}
