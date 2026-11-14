import type { SalesStatusFilter } from "@billy/core";
import { type Db, payments } from "@billy/db";
import { and, gte, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

interface InvoiceColumns {
  id: AnyPgColumn;
  total: AnyPgColumn;
  dueDate: AnyPgColumn;
  voidedAt: AnyPgColumn;
}

/**
 * SQL for the derived invoice state (data-model ground rule 5), shared by sales and purchases.
 * Join `paidByInvoice` on `paidByInvoice.invoiceId = invoice.id`; `paid` is the sum of the
 * non-voided payments and `open` holds for a live invoice with money still owed.
 */
export function invoiceState(db: Db, invoice: InvoiceColumns, paymentInvoiceId: AnyPgColumn) {
  const paidByInvoice = db
    .select({ invoiceId: paymentInvoiceId, paid: sql<string>`sum(${payments.amount})`.as("paid") })
    .from(payments)
    .where(isNull(payments.voidedAt))
    .groupBy(paymentInvoiceId)
    .as("paid_by_invoice");
  const paid = sql<number>`coalesce(${paidByInvoice.paid}, 0)`.mapWith(Number);
  const live = isNull(invoice.voidedAt);
  const open = and(live, sql`${invoice.total} > ${paid}`)!;

  /** Each filter matches the StatusTag the row shows, so Telat wins over Sebagian and Belum bayar. */
  function statusWhere(status: SalesStatusFilter, today: string): SQL {
    switch (status) {
      case "open":
        return open;
      case "void":
        return isNotNull(invoice.voidedAt);
      case "paid":
        return and(live, sql`${invoice.total} <= ${paid}`)!;
      case "overdue":
        return and(open, lt(invoice.dueDate, today))!;
      case "partial":
        return and(open, gte(invoice.dueDate, today), sql`${paid} > 0`)!;
      case "unpaid":
        return and(open, gte(invoice.dueDate, today), sql`${paid} = 0`)!;
    }
  }

  /**
   * List order by what needs attention: Telat (oldest due date first), Belum lunas, Lunas, Void.
   * Callers append their own tie-breakers, e.g. newest date first.
   */
  function priorityOrder(today: string): SQL[] {
    const overdue = statusWhere("overdue", today);
    return [
      sql`case when ${overdue} then 0 when ${open} then 1 when ${live} then 2 else 3 end`,
      sql`case when ${overdue} then ${invoice.dueDate} end`,
    ];
  }

  return { paidByInvoice, paid, live, open, statusWhere, priorityOrder };
}
