import type { BusinessDate } from "./dates.ts";
import type { Rupiah } from "./money.ts";

export type CashDirection = "in" | "out";

/** The cash side of a document: one row of `cash_entries` without its source and audit columns. */
export interface CashMovement {
  accountId: string;
  date: BusinessDate;
  direction: CashDirection;
  amount: Rupiah;
}

/** A transfer moves money out of the source account and into the destination, both on the transfer date. */
export function transferMovements(transfer: {
  fromAccountId: string;
  toAccountId: string;
  date: BusinessDate;
  amount: Rupiah;
}): CashMovement[] {
  const { fromAccountId, toAccountId, date, amount } = transfer;
  return [
    { accountId: fromAccountId, date, direction: "out", amount },
    { accountId: toAccountId, date, direction: "in", amount },
  ];
}

/**
 * The entry that cancels `entry` when its document is voided: same account, amount and date,
 * opposite direction. Keeping the original date makes every historical balance read as if the
 * document never happened, which matches period totals that exclude voided documents.
 */
export function reversalOf(entry: CashMovement): CashMovement {
  return { ...entry, direction: entry.direction === "in" ? "out" : "in" };
}

/** Manual cash rows are `other_in` / `other_out` by direction. */
export const manualCashCategory = (direction: CashDirection) => (direction === "in" ? "other_in" : "other_out");

/** `2026-11` → the half-open range of business dates `[2026-11-01, 2026-12-01)`. */
export function monthRange(month: string): { from: BusinessDate; until: BusinessDate } {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));
  const next = monthIndex === 12 ? `${year + 1}-01` : `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  return { from: `${month}-01`, until: `${next}-01` };
}
