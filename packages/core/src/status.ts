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

/** The status glossary shown on screen and in exports: Lunas, Sebagian, Belum bayar, Telat, Void. */
export function invoiceStatusLabel(state: Pick<InvoiceState, "status" | "overdue">): string {
  if (state.status === "void") return "Void";
  if (state.status === "paid") return "Lunas";
  if (state.overdue) return "Telat";
  return state.status === "partial" ? "Sebagian" : "Belum bayar";
}
