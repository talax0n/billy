import { needsAttentionSql } from "../../lib/stock-level.ts";
import {
  actionItems,
  addDays,
  businessDate,
  delta,
  kpis,
  previousWindow,
  rupiah,
  weekStart,
  weeklyCashFlow,
  type DateWindow,
  type OpenInvoice,
  type OpenInvoices,
  type PeriodTotals,
} from "@billy/core";
import {
  accounts,
  cashEntries,
  contacts,
  type Db,
  expenses,
  payments,
  posLines,
  posSales,
  products,
  purchaseInvoices,
  salesInvoices,
  salesLines,
  stockMovements,
} from "@billy/db";
import {
  and,
  between,
  desc,
  eq,
  isNull,
  lte,
  ne,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { money, netSales, signedAmount, snapshot } from "./sql.ts";

/** Void timestamps count from their Jakarta business date. */
const activeAt = (date: AnyColumn, voidedAt: AnyColumn, at: string) =>
  and(
    lte(date, at),
    or(
      isNull(voidedAt),
      sql`(${voidedAt} at time zone 'Asia/Jakarta')::date > ${at}`,
    ),
  );
const accountScope = (account?: string) =>
  account ? eq(cashEntries.accountId, account) : undefined;
const cashFlowScope = (window: DateWindow, account?: string) =>
  and(
    between(cashEntries.date, window.from, window.to),
    ne(cashEntries.sourceType, "transfer"),
    accountScope(account),
  );

export async function periodTotals(
  db: Db,
  window: DateWindow,
  account?: string,
): Promise<PeriodTotals> {
  const sold = (date: AnyColumn, voidedAt: AnyColumn) =>
    and(between(date, window.from, window.to), isNull(voidedAt));
  const cost = (line: typeof salesLines | typeof posLines) =>
    money(sql`sum(${line.qty} * ${line.unitCost})`);
  const [[invoice], [pos], [invoiceCost], [posCost], [flow]] =
    await Promise.all([
      db
        .select({ total: money(sql`sum(${netSales(salesInvoices)})`) })
        .from(salesInvoices)
        .where(sold(salesInvoices.date, salesInvoices.voidedAt)),
      db
        .select({ total: money(sql`sum(${netSales(posSales)})`) })
        .from(posSales)
        .where(sold(posSales.date, posSales.voidedAt)),
      db
        .select({ cost: cost(salesLines) })
        .from(salesLines)
        .innerJoin(salesInvoices, eq(salesInvoices.id, salesLines.invoiceId))
        .where(sold(salesInvoices.date, salesInvoices.voidedAt)),
      db
        .select({ cost: cost(posLines) })
        .from(posLines)
        .innerJoin(posSales, eq(posSales.id, posLines.saleId))
        .where(sold(posSales.date, posSales.voidedAt)),
      db
        .select({
          incoming: money(
            sql`sum(${cashEntries.amount}) filter (where ${cashEntries.direction} = 'in')`,
          ),
          outgoing: money(
            sql`sum(${cashEntries.amount}) filter (where ${cashEntries.direction} = 'out')`,
          ),
        })
        .from(cashEntries)
        .where(cashFlowScope(window, account)),
    ]);
  return {
    invoiceSales: invoice!.total,
    posSales: pos!.total,
    profit: rupiah(invoice!.total + pos!.total - invoiceCost!.cost - posCost!.cost),
    incoming: flow!.incoming,
    outgoing: flow!.outgoing,
  };
}

/** Invoices with a positive balance at `at`, counting only documents and payments active then. */
export async function openInvoices(db: Db, at: string): Promise<OpenInvoices> {
  const open = (
    invoice: typeof salesInvoices | typeof purchaseInvoices,
    contactId: AnyColumn,
    paymentInvoiceId: AnyColumn,
  ) => {
    const outstanding = money(
      sql`${invoice.total} - coalesce(sum(${payments.amount}) filter (where ${activeAt(payments.date, payments.voidedAt, at)}), 0)`,
    );
    return db
      .select({
        id: invoice.id,
        number: invoice.number,
        contactId: contacts.id,
        contactName: contacts.name,
        dueDate: invoice.dueDate,
        total: invoice.total,
        outstanding,
      })
      .from(invoice)
      .innerJoin(contacts, eq(contacts.id, contactId))
      .leftJoin(payments, eq(paymentInvoiceId, invoice.id))
      .where(activeAt(invoice.date, invoice.voidedAt, at))
      .groupBy(invoice.id, contacts.id)
      .having(sql`${outstanding} > 0`)
      .orderBy(invoice.dueDate, invoice.id) as Promise<OpenInvoice[]>;
  };
  const [receivables, payables] = await Promise.all([
    open(salesInvoices, salesInvoices.customerId, payments.salesInvoiceId),
    open(
      purchaseInvoices,
      purchaseInvoices.supplierId,
      payments.purchaseInvoiceId,
    ),
  ]);
  return { receivables, payables };
}

export async function accountBalances(db: Db, today: string) {
  const balance = money(
    sql`sum(${signedAmount}) filter (where ${cashEntries.date} <= ${today})`,
  );
  return db
    .select({
      id: accounts.id,
      name: accounts.name,
      kind: accounts.kind,
      balance,
      weeklyChange: money(
        sql`sum(${signedAmount}) filter (where ${between(cashEntries.date, weekStart(today), today)})`,
      ),
    })
    .from(accounts)
    .leftJoin(cashEntries, eq(cashEntries.accountId, accounts.id))
    .groupBy(accounts.id)
    .orderBy(desc(balance), accounts.name);
}

/** Active products whose derived stock is negative or under the minimum. */
export async function stockAlerts(db: Db, today: string) {
  const stock = sql<number>`coalesce(sum(${stockMovements.qty}) filter (where ${stockMovements.date} <= ${today}), 0)::int`;
  return db
    .select({
      id: products.id,
      name: products.name,
      minStock: products.minStock,
      stock,
    })
    .from(products)
    .leftJoin(stockMovements, eq(stockMovements.productId, products.id))
    .where(eq(products.active, true))
    .groupBy(products.id)
    .having(needsAttentionSql(stock));
}

async function weeklyTotals(
  db: Db,
  to: string,
  weeks: number,
  account?: string,
) {
  const from = sql<string>`to_char(date_trunc('week', ${cashEntries.date}::timestamp), 'YYYY-MM-DD')`;
  return db
    .select({
      from,
      incoming: money(
        sql`sum(${cashEntries.amount}) filter (where ${cashEntries.direction} = 'in')`,
      ),
      outgoing: money(
        sql`sum(${cashEntries.amount}) filter (where ${cashEntries.direction} = 'out')`,
      ),
    })
    .from(cashEntries)
    .where(
      cashFlowScope(
        { from: addDays(weekStart(to), (1 - weeks) * 7), to },
        account,
      ),
    )
    .groupBy(from);
}

async function currentActions(db: Db, today: string) {
  const [open, products, balances] = await Promise.all([
    openInvoices(db, today),
    stockAlerts(db, today),
    accountBalances(db, today),
  ]);
  return { actions: actionItems({ ...open, products, balances }, today), balances };
}

export async function dashboard(
  db: Db,
  query: DateWindow & { account?: string | undefined; weeks: "12" | "26" },
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const today = businessDate(now);
    const previous = previousWindow(query);
    const [currentTotals, previousTotals, currentOpen, previousOpen, chart, { actions, balances }] =
      await Promise.all([
        periodTotals(tx, query, query.account),
        periodTotals(tx, previous, query.account),
        openInvoices(tx, query.to),
        openInvoices(tx, previous.to),
        weeklyTotals(tx, query.to, Number(query.weeks), query.account),
        currentActions(tx, today),
      ]);
    const current = kpis(currentTotals, currentOpen, query.to);
    const before = kpis(previousTotals, previousOpen, previous.to);
    return {
      asOf: now.toISOString(),
      today,
      window: { from: query.from, to: query.to },
      previousWindow: previous,
      current,
      previous: before,
      deltas: {
        sales: delta(current.sales, before.sales),
        profit: delta(current.profit, before.profit),
        net: delta(current.net, before.net),
        receivables: delta(current.receivables, before.receivables),
        duePayables: delta(current.duePayables, before.duePayables),
      },
      balances,
      totalBalance: rupiah(balances.reduce((n, a) => n + a.balance, 0)),
      chart: weeklyCashFlow(chart, query.to, Number(query.weeks)),
      nextAction: actions[0] ?? null,
      actionCount: actions.length,
    };
  }, snapshot);
}

export async function listActions(
  db: Db,
  query: { q: string; page: number; pageSize: number },
) {
  const { actions } = await db.transaction(
    (tx) => currentActions(tx, businessDate()),
    snapshot,
  );
  const q = query.q.toLocaleLowerCase("id");
  const filtered = actions.filter((r) =>
    r.name.toLocaleLowerCase("id").includes(q),
  );
  return {
    rows: filtered.slice(
      (query.page - 1) * query.pageSize,
      query.page * query.pageSize,
    ),
    total: filtered.length,
    count: actions.length,
  };
}

/** First day of the month `months` before the month of `date` (YYYY-MM-01). */
function monthStart(date: string, months = 0) {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * The last 12 calendar months up to `today`, per month: invoice sales and cashier sales (net of
 * document discounts, like the dashboard), purchases (invoice totals incl. PPN) and expenses.
 * Void documents are left out.
 */
export async function yearlyOverview(db: Db, today: string) {
  const window = { from: monthStart(today, 11), to: today };
  const month = (date: AnyColumn) => sql<string>`to_char(${date}, 'YYYY-MM')`;
  const byMonth = async (
    table: typeof salesInvoices | typeof posSales | typeof purchaseInvoices | typeof expenses,
    amount: SQL,
  ) =>
    new Map(
      (
        await db
          .select({ month: month(table.date), total: money(sql`sum(${amount})`) })
          .from(table)
          .where(and(between(table.date, window.from, window.to), isNull(table.voidedAt)))
          .groupBy(month(table.date))
      ).map((r) => [r.month, r.total]),
    );
  const [sales, pos, purchases, spent] = await Promise.all([
    byMonth(salesInvoices, netSales(salesInvoices)),
    byMonth(posSales, netSales(posSales)),
    byMonth(purchaseInvoices, sql`${purchaseInvoices.total}`),
    byMonth(expenses, sql`${expenses.amount}`),
  ]);
  const months = Array.from({ length: 12 }, (_, i) => monthStart(today, 11 - i).slice(0, 7)).map((m) => ({
    month: m,
    sales: sales.get(m) ?? rupiah(0),
    pos: pos.get(m) ?? rupiah(0),
    purchases: purchases.get(m) ?? rupiah(0),
    expenses: spent.get(m) ?? rupiah(0),
  }));
  const sum = (key: "sales" | "pos" | "purchases" | "expenses") => rupiah(months.reduce((n, m) => n + m[key], 0));
  return {
    ...window,
    months,
    totals: { sales: sum("sales"), pos: sum("pos"), purchases: sum("purchases"), expenses: sum("expenses") },
  };
}
