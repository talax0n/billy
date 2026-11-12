import { addDays, type BusinessDate } from "./dates.ts";
import { rupiah, type Rupiah } from "./money.ts";

/**
 * Inventory cost of one unit of a purchase line: the line total after its own discount,
 * divided by qty, rounded half up to whole rupiah. The document discount and PPN are not
 * spread over the lines.
 */
export function netUnitCost(lineTotal: Rupiah, qty: number): Rupiah {
  return rupiah(Math.round(lineTotal / qty));
}

export const dueBuckets = ["late", "within7", "within30", "later"] as const;
export type DueBucket = (typeof dueBuckets)[number];

/**
 * Payment-planning bucket of an open payable: past due, due within 7 days (today included),
 * in 8–30 days, or later.
 */
export function dueBucket(dueDate: BusinessDate, today: BusinessDate): DueBucket {
  if (dueDate < today) return "late";
  if (dueDate <= addDays(today, 7)) return "within7";
  if (dueDate <= addDays(today, 30)) return "within30";
  return "later";
}
