import type { BusinessDate } from "./dates.ts";
import { DomainError } from "./errors.ts";
import { formatRupiah, rupiah, type Rupiah } from "./money.ts";
import type { InvoiceState } from "./status.ts";

export const agingBuckets = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgingBucket = (typeof agingBuckets)[number];

export const agingLabels: Record<AgingBucket, string> = {
  current: "Belum jatuh tempo",
  d1_30: "1–30 hari",
  d31_60: "31–60 hari",
  d61_90: "61–90 hari",
  d90_plus: "> 90 hari",
};

const DAY_MS = 86_400_000;

/** Whole days from the due date to today; 0 or less means not yet due. */
export function daysOverdue(dueDate: BusinessDate, today: BusinessDate): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / DAY_MS);
}

export function agingBucket(dueDate: BusinessDate, today: BusinessDate): AgingBucket {
  const days = daysOverdue(dueDate, today);
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

export type AgingTotals = Record<AgingBucket, Rupiah> & { total: Rupiah };

export interface OpenReceivable {
  customerId: string;
  dueDate: BusinessDate;
  outstanding: Rupiah;
}

const emptyAging = (): AgingTotals => ({
  current: rupiah(0),
  d1_30: rupiah(0),
  d31_60: rupiah(0),
  d61_90: rupiah(0),
  d90_plus: rupiah(0),
  total: rupiah(0),
});

/** Outstanding per customer split into aging buckets, plus the count of open invoices. */
export function ageReceivables(
  invoices: readonly OpenReceivable[],
  today: BusinessDate,
): Map<string, AgingTotals & { invoiceCount: number }> {
  const byCustomer = new Map<string, AgingTotals & { invoiceCount: number }>();
  for (const inv of invoices) {
    if (inv.outstanding <= 0) continue;
    const row = byCustomer.get(inv.customerId) ?? { ...emptyAging(), invoiceCount: 0 };
    const bucket = agingBucket(inv.dueDate, today);
    row[bucket] = rupiah(row[bucket] + inv.outstanding);
    row.total = rupiah(row.total + inv.outstanding);
    row.invoiceCount += 1;
    byCustomer.set(inv.customerId, row);
  }
  return byCustomer;
}

/**
 * List filters, matching what the status tag shows: an overdue invoice tags as Telat,
 * so it falls under `overdue` and not under `unpaid` or `partial`. `open` is anything still owed.
 */
export const salesStatusFilters = ["open", "due", "unpaid", "partial", "overdue", "paid", "void"] as const;
export type SalesStatusFilter = (typeof salesStatusFilters)[number];

export function assertPaymentAllowed(state: InvoiceState, amount: Rupiah): void {
  if (state.status === "void") throw new DomainError("conflict", "Faktur sudah di-void");
  if (amount <= 0) throw new DomainError("invalid", "Jumlah pembayaran harus lebih dari 0");
  if (amount > state.outstanding) {
    throw new DomainError("invalid", `Pembayaran melebihi sisa tagihan ${formatRupiah(state.outstanding)}`);
  }
}

export function assertInvoiceVoidable(invoice: { voided: boolean; activePayments: number }): void {
  if (invoice.voided) throw new DomainError("conflict", "Faktur sudah di-void");
  if (invoice.activePayments > 0) {
    throw new DomainError("conflict", "Void dulu semua pembayaran faktur ini");
  }
}
