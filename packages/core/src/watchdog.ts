import { z } from "zod";
import type { AuditAction } from "./audit.ts";
import type { BusinessDate } from "./dates.ts";
import { businessDateInput, rupiahInput } from "./schemas/common.ts";

/** Every threshold the watchdog uses besides the ones the admin sets in Pengaturan. */
export const WATCHDOG = {
  /** A cashier's voids, revisi or refunds on one day are above normal past max(min, factor × median of the prior days). */
  spikeMinCount: 3,
  spikeFactor: 2,
  spikeHistoryDays: 30,
  failedLoginsPerDay: 3,
  /** A discount at or within this many basis points (0,5%) of the cap. */
  discountNearCapBp: 50,
  /** A sale or shift timed this far after the server received it means the device clock runs ahead. */
  clockAheadMs: 5 * 60_000,
  /** A posted opname whose differences, at cost and ignoring sign, add up to at least this. */
  opnameDifferenceValue: 100_000,
} as const;

export const watchdogFlagTypes = [
  "voids",
  "revisi",
  "refunds",
  "shift_difference",
  "below_cost",
  "discount_near_cap",
  "draft_open_after_close",
  "draft_cancelled_printed",
  "outside_hours",
  "failed_logins",
  "pin_lockout",
  "clock_tampering",
  "opname_difference",
] as const;
export type WatchdogFlagType = (typeof watchdogFlagTypes)[number];

export const watchdogFlagLabels: Record<WatchdogFlagType, string> = {
  voids: "Void di atas normal",
  revisi: "Revisi di atas normal",
  refunds: "Refund di atas normal",
  shift_difference: "Selisih kas shift",
  below_cost: "Di bawah modal",
  discount_near_cap: "Diskon di batas",
  draft_open_after_close: "Nota sementara belum selesai",
  draft_cancelled_printed: "Nota sementara tercetak dibatalkan",
  outside_hours: "Di luar jam buka",
  failed_logins: "Gagal masuk berulang",
  pin_lockout: "PIN dikunci",
  clock_tampering: "Jam perangkat tidak wajar",
  opname_difference: "Selisih stok opname",
};

/** What a flag opens: a document, the Shift report, or Log Aktivitas filtered to the person and day. */
export type WatchdogTarget =
  | { type: "pos_sale" | "sales_invoice" | "opname"; id: string }
  | { type: "shift"; cashierId: string; date: BusinessDate }
  | { type: "audit"; actorId: string | null; action: AuditAction | null; date: BusinessDate };

export interface WatchdogFlag {
  /** Stable within a result, for list keys. */
  id: string;
  type: WatchdogFlagType;
  severity: "high" | "medium";
  who: { id: string | null; name: string } | null;
  /** ISO instant. */
  at: string;
  date: BusinessDate;
  /** One readable line. */
  message: string;
  target: WatchdogTarget;
}

/** At most a quarter: the watchdog computes on read. */
export const watchdogQuery = z
  .object({ from: businessDateInput, to: businessDateInput })
  .refine(({ from, to }) => from <= to && Date.parse(to) - Date.parse(from) <= 92 * 86_400_000, "Rentang tanggal maksimal 93 hari");

export const dailySummaryQuery = z.object({ date: businessDateInput });

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format jam HH:MM, misal 07:00");

export const watchdogSettingsInput = z
  .object({
    /** A closed shift whose cash difference, either way, reaches this is flagged. */
    cashDifferenceThreshold: rupiahInput,
    openTime: clock,
    closeTime: clock,
  })
  .refine((s) => s.openTime < s.closeTime, { message: "Jam tutup harus sesudah jam buka", path: ["closeTime"] });
export type WatchdogSettingsInput = z.input<typeof watchdogSettingsInput>;
export type WatchdogSettings = z.output<typeof watchdogSettingsInput>;

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** `history` holds one count per prior day, zero for a day without any. */
export const aboveNormal = (count: number, history: readonly number[]) =>
  count > Math.max(WATCHDOG.spikeMinCount, WATCHDOG.spikeFactor * median(history));
