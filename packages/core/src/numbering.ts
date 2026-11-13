import type { BusinessDate } from "./dates.ts";

/** Server-numbered documents: sales, purchase, tukar faktur, biaya, nota sementara, penawaran, stok opname. */
export type DocPrefix = "SO" | "PO" | "TF" | "BY" | "S" | "Q" | "OP";

/** `2026-11-13` → `261113`, the counter period of a document number. */
export function docPeriod(date: BusinessDate): string {
  return date.slice(2, 4) + date.slice(5, 7) + date.slice(8, 10);
}

/** `{PREFIX}-{YYMMDD}-{NNNN}`. The counter widens past 9999 instead of wrapping. */
export function formatDocNumber(prefix: string, date: BusinessDate, counter: number): string {
  return `${prefix}-${docPeriod(date)}-${String(counter).padStart(4, "0")}`;
}

/**
 * The next POS receipt number for a device. `last` is the device's previous counter and
 * period; the counter restarts at 1 when the business date changes.
 */
export function nextPosNumber(
  deviceCode: string,
  date: BusinessDate,
  last: { period: string; value: number } | null,
): { number: string; period: string; value: number } {
  const period = docPeriod(date);
  const value = last?.period === period ? last.value + 1 : 1;
  return { number: formatDocNumber(deviceCode, date, value), period, value };
}

/**
 * The number of an edited ("Ubah") server document: the original's number with `/R1`, and
 * `/R2`, `/R3`… for each further edit of the edit. The lineage stays readable on paper and the
 * day's counter is not spent on a correction.
 */
export function revisionNumber(number: string): string {
  const match = /^(.*)\/R(\d+)$/.exec(number);
  return match ? `${match[1]}/R${Number(match[2]) + 1}` : `${number}/R1`;
}
