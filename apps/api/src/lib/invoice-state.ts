import type { SalesStatusFilter, SortDir } from "@billy/core";
import { type Db, payments } from "@billy/db";
import { and, asc, desc, gte, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
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
      case "due":
        return and(open, gte(invoice.dueDate, today))!;
      case "overdue":
        return and(open, lt(invoice.dueDate, today))!;
      case "partial":
        return and(open, gte(invoice.dueDate, today), sql`${paid} > 0`)!;
      case "unpaid":
        return and(open, gte(invoice.dueDate, today), sql`${paid} = 0`)!;
    }
  }

  /**
   * List order. `status` (the default) ranks by what needs attention: Telat, Belum lunas, Lunas,
   * Void, and unpaid invoices by nearest jatuh tempo. Any other key sorts its own column.
   * `newest` breaks ties and must end on a unique column so pages never overlap.
   */
  function listOrder(
    sort: { sort?: string | undefined; dir: SortDir },
    columns: Record<string, SQL | AnyPgColumn>,
    newest: SQL[],
    today: string,
  ): SQL[] {
    const by = sort.dir === "desc" ? desc : asc;
    const column = sort.sort && sort.sort !== "status" ? columns[sort.sort] : undefined;
    if (column) return [by(column), ...newest];
    const rank = sql`case when ${statusWhere("overdue", today)} then 0 when ${open} then 1 when ${live} then 2 else 3 end`;
    return [by(rank), asc(sql`case when ${open} then ${invoice.dueDate} end`), ...newest];
  }

  return { paidByInvoice, paid, live, open, statusWhere, listOrder };
}
