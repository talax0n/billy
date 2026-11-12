import type { BusinessDate } from "./dates.ts";
import { rupiah, type Rupiah } from "./money.ts";

export type InvoiceStatus = "void" | "paid" | "partial" | "unpaid";

export interface InvoiceState {
  status: InvoiceStatus;
  outstanding: Rupiah;
  /** Open balance past the due date. Never true for void or paid invoices. */
  overdue: boolean;
}

export function deriveInvoiceStatus(input: {
  total: Rupiah;
  /** Sum of non-voided payments. */
  paid: Rupiah;
  dueDate: BusinessDate;
  voided: boolean;
  today: BusinessDate;
}): InvoiceState {
  const outstanding = rupiah(input.total - input.paid);
  if (input.voided) return { status: "void", outstanding: rupiah(0), overdue: false };
  if (outstanding <= 0) return { status: "paid", outstanding: rupiah(0), overdue: false };
  return {
    status: input.paid > 0 ? "partial" : "unpaid",
    outstanding,
    overdue: input.dueDate < input.today,
  };
}
