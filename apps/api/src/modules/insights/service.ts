import {
  accountBalances,
  actionItems,
  businessDate,
  delta,
  documentProfits,
  kpis,
  previousWindow,
  rupiah,
  weeklyCashFlow,
  type DateWindow,
  type InsightData,
} from "@billy/core";
import {
  accounts,
  cashEntries,
  contacts,
  type Db,
  payments,
  posSales,
  posLines,
  products,
  purchaseInvoices,
  salesInvoices,
  salesLines,
} from "@billy/db";
import { eq, lte, sql } from "drizzle-orm";

export async function readInsightData(
  db: Db,
  through: string,
  stockThrough = through,
): Promise<InsightData> {
  const [
    invoices,
    purchases,
    pos,
    paymentRows,
    cash,
    accountRows,
    productRows,
    invoiceLines,
    cashierLines,
  ] = await Promise.all([
    db
      .select({
        id: salesInvoices.id,
        number: salesInvoices.number,
        contactId: salesInvoices.customerId,
        contactName: contacts.name,
        date: salesInvoices.date,
        dueDate: salesInvoices.dueDate,
        total: salesInvoices.total,
        voidedAt: salesInvoices.voidedAt,
      })
      .from(salesInvoices)
      .innerJoin(contacts, eq(contacts.id, salesInvoices.customerId))
      .where(lte(salesInvoices.date, through)),
    db
      .select({
        id: purchaseInvoices.id,
        number: purchaseInvoices.number,
        contactId: purchaseInvoices.supplierId,
        contactName: contacts.name,
        date: purchaseInvoices.date,
        dueDate: purchaseInvoices.dueDate,
        total: purchaseInvoices.total,
        voidedAt: purchaseInvoices.voidedAt,
      })
      .from(purchaseInvoices)
      .innerJoin(contacts, eq(contacts.id, purchaseInvoices.supplierId))
      .where(lte(purchaseInvoices.date, through)),
    db
      .select({
        id: posSales.id,
        number: posSales.number,
        date: posSales.date,
        total: posSales.total,
        voidedAt: posSales.voidedAt,
      })
      .from(posSales)
      .where(lte(posSales.date, through)),
    db.select().from(payments).where(lte(payments.date, through)),
    db.select().from(cashEntries).where(lte(cashEntries.date, through)),
    db
      .select({ id: accounts.id, name: accounts.name, kind: accounts.kind })
      .from(accounts),
    db
      .select({
        id: products.id,
        name: products.name,
        minStock: products.minStock,
        stock: sql<number>`coalesce((select sum(qty)::int from stock_movements where product_id = products.id and date <= ${stockThrough}), 0)`,
      })
      .from(products)
      .where(eq(products.active, true)),
    db
      .select({
        documentId: salesLines.invoiceId,
        lineTotal: salesLines.lineTotal,
        qty: salesLines.qty,
        unitCost: salesLines.unitCost,
      })
      .from(salesLines)
      .innerJoin(salesInvoices, eq(salesInvoices.id, salesLines.invoiceId))
      .where(lte(salesInvoices.date, through)),
    db
      .select({
        documentId: posLines.saleId,
        lineTotal: posLines.lineTotal,
        qty: posLines.qty,
        unitCost: posLines.unitCost,
      })
      .from(posLines)
      .innerJoin(posSales, eq(posSales.id, posLines.saleId))
      .where(lte(posSales.date, through)),
  ]);
  const profits = documentProfits([...invoiceLines, ...cashierLines]);
  const voidDate = (at: Date | null) => (at ? businessDate(at) : null);
  return {
    invoices: invoices.map((r) => ({
      ...r,
      profit: profits.get(r.id) ?? rupiah(0),
      voidedDate: voidDate(r.voidedAt),
    })),
    purchases: purchases.map((r) => ({
      ...r,
      profit: rupiah(0),
      voidedDate: voidDate(r.voidedAt),
    })),
    pos: pos.map((r) => ({
      ...r,
      profit: profits.get(r.id) ?? rupiah(0),
      voidedDate: voidDate(r.voidedAt),
    })),
    payments: paymentRows.map((r) => ({
      invoiceId: (r.salesInvoiceId ?? r.purchaseInvoiceId)!,
      date: r.date,
      amount: r.amount,
      voidedDate: voidDate(r.voidedAt),
    })),
    cash,
    accounts: accountRows,
    products: productRows,
  };
}

export async function dashboard(
  db: Db,
  query: DateWindow & { account?: string | undefined; weeks: "12" | "26" },
  now = new Date(),
) {
  return db.transaction(
    async (tx) => {
      const today = businessDate(now);
      const data = await readInsightData(
        tx,
        query.to > today ? query.to : today,
        today,
      );
      const current = kpis(data, query, query.account);
      const previous = kpis(data, previousWindow(query), query.account);
      const balances = accountBalances(data, today);
      const actions = actionItems(data, today);
      return {
        asOf: now.toISOString(),
        today,
        window: { from: query.from, to: query.to },
        previousWindow: previousWindow(query),
        current,
        previous,
        deltas: {
          sales: delta(current.sales, previous.sales),
          profit: delta(current.profit, previous.profit),
          net: delta(current.net, previous.net),
          receivables: delta(current.receivables, previous.receivables),
          duePayables: delta(current.duePayables, previous.duePayables),
        },
        balances,
        totalBalance: rupiah(
          balances
            .filter((a) => a.kind !== "ewallet")
            .reduce((n, a) => n + a.balance, 0),
        ),
        chart: weeklyCashFlow(
          data.cash,
          query.to,
          Number(query.weeks),
          query.account,
        ),
        nextAction: actions[0] ?? null,
        actionCount: actions.length,
      };
    },
    { isolationLevel: "repeatable read" },
  );
}
export async function listActions(
  db: Db,
  query: { q: string; page: number; pageSize: number },
) {
  const all = actionItems(
    await db.transaction((tx) => readInsightData(tx, businessDate()), {
      isolationLevel: "repeatable read",
    }),
    businessDate(),
  );
  const filtered = all.filter((r) =>
    r.name.toLocaleLowerCase("id").includes(query.q.toLocaleLowerCase("id")),
  );
  return {
    rows: filtered.slice(
      (query.page - 1) * query.pageSize,
      query.page * query.pageSize,
    ),
    total: filtered.length,
    count: all.length,
  };
}
