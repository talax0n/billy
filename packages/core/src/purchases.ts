import { addDays, type BusinessDate } from "./dates.ts";
import { rupiah, type Rupiah } from "./money.ts";

/** The inventory cost is the line's net value divided by quantity, rounded to rupiah. */
export function netUnitCost(lineTotal: Rupiah, qty: number): Rupiah {
  return rupiah(Math.round(lineTotal / qty));
}

export function dueBucket(dueDate: BusinessDate, today: BusinessDate): "late" | "within7" | "within30" | "later" {
  if (dueDate < today) return "late";
  if (dueDate <= addDays(today, 7)) return "within7";
  if (dueDate <= addDays(today, 30)) return "within30";
  return "later";
}
