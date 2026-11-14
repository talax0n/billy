import {
  addDays,
  businessDate,
  CASH_DEPOSIT_THRESHOLD,
  previousWindow,
  weekStart,
  type DateWindow,
} from "@billy/core";
import {
  accounts,
  cashEntries,
  payments,
  posLines,
  posSales,
  products,
  purchaseInvoices,
  salesInvoices,
  salesLines,
  stockMovements,
} from "@billy/db";
import { eq, lte } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestApp } from "../../testing.ts";
import { seedInsightDemo } from "./fixture.ts";
import { dashboard, listActions, stockAlerts, yearlyOverview } from "./service.ts";

vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-11-13T07:00:00Z"));
const { db, call, signIn } = await createTestApp();
let cookie: string;
let fixture: Awaited<ReturnType<typeof seedInsightDemo>>;
beforeAll(async () => {
  const staff = await signIn("staff");
  cookie = staff.cookie;
  fixture = await seedInsightDemo(db, staff.user.id, "2026-11-13");
});
afterAll(() => vi.useRealTimers());
const query = "from=2026-11-01&to=2026-11-13";
it("serves exact KPIs from six months of real rows, excluding void documents and transfers", async () => {
  const res = await call(`/api/insights/dashboard?${query}`, { cookie });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    totalBalance: 51500000,
    current: {
      sales: 5000000,
      invoiceSales: 4000000,
      posSales: 1000000,
      profit: 1250000,
      margin: 25,
      incoming: 3200000,
      outgoing: 3450000,
      net: -250000,
      receivables: 21000000,
      overdue: 21000000,
      duePayables: 17250000,
    },
    previous: {
      sales: 0,
      profit: 0,
      net: 0,
      receivables: 18000000,
      duePayables: 14750000,
    },
    deltas: {
      sales: { amount: 5000000, percent: null },
      net: { amount: -250000, percent: null },
      receivables: { amount: 3000000, percent: 16.7 },
    },
    balances: [
      { name: "Bank Operasional (demo)", balance: 33000000 },
      { name: "Kas Toko (demo)", balance: 18500000 },
    ],
  });
});
it("filters only cash flow by account, with transfers still excluded", async () => {
  const res = await call(
    `/api/insights/dashboard?${query}&account=${fixture.bankId}&weeks=26`,
    { cookie },
  );
  const body = (await res.json()) as Awaited<ReturnType<typeof dashboard>>;
  expect(body.current).toMatchObject({
    sales: 5000000,
    net: 0,
    incoming: 0,
    outgoing: 0,
    receivables: 21000000,
  });
  expect(body.chart).toHaveLength(26);
});
it("groups overdue receivables by customer, derives stock and returns ranked paginated actions", async () => {
  const res = await call("/api/insights/actions", { cookie });
  const body = (await res.json()) as Awaited<ReturnType<typeof listActions>>;
  expect(body.count).toBe(10);
  expect(body.rows.map((r: { kind: string }) => r.kind)).toEqual([
    "negative-stock",
    "receivable",
    "payable",
    "payable",
    "payable",
    "payable",
    "payable",
    "payable",
    "low-stock",
    "deposit",
  ]);
  expect(body.rows[1]).toMatchObject({
    amount: 21000000,
    count: 6,
    name: "PT Warna Imajinasi",
  });
  expect(body.rows[8]).toMatchObject({ stock: 15, minStock: 20 });
  expect(body.rows[9]).toMatchObject({ amount: 18500000 });
  expect(
    await (
      await call("/api/insights/actions?pageSize=1&page=2", { cookie })
    ).json(),
  ).toMatchObject({ count: 10, total: 10, rows: [{ kind: "receivable" }] });
  expect(
    await (await call("/api/insights/actions?q=imajinasi", { cookie })).json(),
  ).toMatchObject({ count: 10, total: 1 });
});
it("keeps fixture idempotent and reversals preserve exact ledger/stock totals", async () => {
  const staff = await signIn("staff", "fixture-staff");
  expect(await seedInsightDemo(db, staff.user.id)).toEqual({ inserted: false });
  expect(
    await db.$count(cashEntries, lte(cashEntries.date, "2026-11-13")),
  ).toBe(38);
  expect(
    await db
      .select({
        direction: cashEntries.direction,
        amount: cashEntries.amount,
        source: cashEntries.sourceType,
      })
      .from(cashEntries)
      .where(eq(cashEntries.category, "reversal")),
  ).toEqual(
    expect.arrayContaining([
      { direction: "out", amount: 500000, source: "sales_payment" },
      { direction: "out", amount: 600000, source: "pos_sale" },
      { direction: "in", amount: 100000, source: "expense" },
      { direction: "in", amount: 2000000, source: "transfer" },
      { direction: "out", amount: 2000000, source: "transfer" },
    ]),
  );
  expect(
    await db
      .select({ qty: stockMovements.qty, source: stockMovements.sourceType })
      .from(stockMovements)
      .where(eq(stockMovements.reason, "reversal")),
  ).toEqual(
    expect.arrayContaining([
      { qty: 3, source: "sales_invoice" },
      { qty: -3, source: "purchase_invoice" },
      { qty: 3, source: "pos_sale" },
    ]),
  );

  expect(
    (await stockAlerts(db, "2026-11-13")).find(
      (p) => p.id === fixture.productId,
    )?.stock,
  ).toBe(15);
});
it("matches dashboard aggregates recomputed row by row from the fixture", async () => {
  const today = "2026-11-13";
  const [invoices, purchases, pos, paid, cash, accountRows, lines, stock, items] =
    await Promise.all([
      db.select().from(salesInvoices),
      db.select().from(purchaseInvoices),
      db.select().from(posSales),
      db.select().from(payments),
      db.select().from(cashEntries),
      db.select().from(accounts),
      Promise.all([
        db
          .select({ doc: salesLines.invoiceId, line: salesLines })
          .from(salesLines),
        db.select({ doc: posLines.saleId, line: posLines }).from(posLines),
      ]).then((parts) => parts.flat()),
      db.select().from(stockMovements),
      db.select().from(products).where(eq(products.active, true)),
    ]);
  const voided = (at: Date | null) => (at ? businessDate(at) : null);
  const activeAt = (
    r: { date: string; voidedAt: Date | null },
    at: string,
  ) => r.date <= at && (!r.voidedAt || voided(r.voidedAt)! > at);
  const within = (date: string, w: DateWindow) =>
    date >= w.from && date <= w.to;
  const total = (values: number[]) => values.reduce((n, v) => n + v, 0);
  const open = <
    T extends {
      id: string;
      date: string;
      total: number;
      voidedAt: Date | null;
    },
  >(
    docs: T[],
    at: string,
  ) =>
    docs
      .filter((d) => activeAt(d, at))
      .map((d) => ({
        ...d,
        owed: Math.max(
          0,
          d.total -
            total(
              paid
                .filter(
                  (p) =>
                    (p.salesInvoiceId ?? p.purchaseInvoiceId) === d.id &&
                    activeAt(p, at),
                )
                .map((p) => p.amount),
            ),
        ),
      }))
      .filter((d) => d.owed > 0);
  const flow = (w: DateWindow, account?: string) =>
    cash.filter(
      (c) =>
        within(c.date, w) &&
        c.sourceType !== "transfer" &&
        (!account || c.accountId === account),
    );
  const sum = (rows: { amount: number }[]) => total(rows.map((r) => r.amount));
  const signed = (c: (typeof cash)[number]) =>
    c.direction === "in" ? c.amount : -c.amount;
  const expected = (w: DateWindow, account?: string) => {
    const sold = [...invoices, ...pos].filter(
      (d) => !d.voidedAt && within(d.date, w),
    );
    const soldIds = new Set(sold.map((d) => d.id));
    const invoiceSales = total(
      invoices.filter((d) => soldIds.has(d.id)).map((d) => d.total),
    );
    const sales = total(sold.map((d) => d.total));
    const profit = total(
      lines
        .filter((l) => soldIds.has(l.doc))
        .map((l) => l.line.lineTotal - l.line.qty * l.line.unitCost),
    );
    const rows = flow(w, account);
    const incoming = sum(rows.filter((c) => c.direction === "in"));
    const outgoing = sum(rows.filter((c) => c.direction === "out"));
    const receivable = open(invoices, w.to);
    return {
      sales,
      invoiceSales,
      posSales: sales - invoiceSales,
      profit,
      margin: sales ? Math.round((profit / sales) * 1000) / 10 : 0,
      incoming,
      outgoing,
      net: incoming - outgoing,
      receivables: total(receivable.map((d) => d.owed)),
      overdue: total(
        receivable.filter((d) => d.dueDate < w.to).map((d) => d.owed),
      ),
      duePayables: total(
        open(purchases, w.to)
          .filter((d) => d.dueDate <= addDays(w.to, 7))
          .map((d) => d.owed),
      ),
    };
  };
  const balances = accountRows.map((a) => {
    const rows = cash.filter((c) => c.accountId === a.id && c.date <= today);
    return {
      id: a.id,
      balance: total(rows.map(signed)),
      weeklyChange: total(
        rows.filter((c) => c.date >= weekStart(today)).map(signed),
      ),
    };
  });
  const stockOf = (id: string) =>
    total(stock.filter((m) => m.productId === id).map((m) => m.qty));
  const actionCount =
    new Set(
      open(invoices, today)
        .filter((d) => d.dueDate < today)
        .map((d) => d.customerId),
    ).size +
    open(purchases, today).filter((d) => d.dueDate <= addDays(today, 7))
      .length +
    items.filter((p) => stockOf(p.id) < Math.max(0, p.minStock)).length +
    balances.filter(
      (b) =>
        accountRows.find((a) => a.id === b.id)!.kind === "cash" &&
        b.balance > CASH_DEPOSIT_THRESHOLD,
    ).length;

  const voidDay = voided(paid.find((p) => p.voidedAt)!.voidedAt)!;
  const windows: [DateWindow, string | undefined][] = [
    [{ from: "2026-06-01", to: "2026-11-13" }, undefined],
    [{ from: "2026-09-15", to: "2026-10-20" }, fixture.cashId],
    [{ from: addDays(voidDay, -20), to: voidDay }, undefined],
  ];
  for (const [window, account] of windows) {
    const body = (await (
      await call(
        `/api/insights/dashboard?${new URLSearchParams({ ...window, weeks: "26", ...(account && { account }) })}`,
        { cookie },
      )
    ).json()) as Awaited<ReturnType<typeof dashboard>>;
    expect(body.current).toEqual(expected(window, account));
    expect(body.previous).toEqual(expected(previousWindow(window), account));
    expect(
      body.balances.map(({ id, balance, weeklyChange }) => ({
        id,
        balance,
        weeklyChange,
      })),
    ).toEqual(expect.arrayContaining(balances));
    expect(body.balances).toHaveLength(balances.length);
    expect(body.chart.some((w) => w.incoming > 0)).toBe(true);
    expect(body.chart.map((w) => [w.incoming, w.outgoing])).toEqual(
      body.chart.map((w) => {
        const rows = flow(w, account);
        return [
          sum(rows.filter((c) => c.direction === "in")),
          sum(rows.filter((c) => c.direction === "out")),
        ];
      }),
    );
    expect(body.actionCount).toBe(actionCount);
  }
});
it("exports numeric Excel cells and opening/running account balances", async () => {
  const sales = await call(`/api/reports/sales.xlsx?${query}`, { cookie });
  expect(sales.headers.get("content-type")).toContain("spreadsheetml");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await sales.arrayBuffer());
  const sheet = book.worksheets[0]!;
  expect(sheet.rowCount).toBe(3);
  expect([sheet.getCell("D2").value, sheet.getCell("D3").value]).toEqual([
    1000000, 4000000,
  ]);
  expect(sheet.getCell("D2").numFmt).toContain('"Rp"');
  const cash = await call(
    `/api/reports/cash-book.xlsx?${query}&account=${fixture.bankId}`,
    { cookie },
  );
  await book.xlsx.load(await cash.arrayBuffer());
  const cashSheet = book.worksheets[0]!;
  expect(cashSheet.getCell("G2").value).toBe(30000000);
  expect(cashSheet.getCell(`G${cashSheet.rowCount}`).value).toBe(33000000);
  expect(cashSheet.getCell("E3").type).toBe(ExcelJS.ValueType.Number);
});
it("rejects invalid dates, backwards windows and invalid accounts", async () => {
  for (const suffix of [
    "from=2026-02-30&to=2026-03-01",
    "from=2026-11-13&to=2026-11-01",
    `${query}&account=nope`,
  ]) {
    expect(
      (await call(`/api/insights/dashboard?${suffix}`, { cookie })).status,
    ).toBe(400);
    expect(
      (await call(`/api/reports/cash-book.xlsx?${suffix}`, { cookie })).status,
    ).toBe(400);
  }
});
it("counts what needs attention for the login notice and the sidebar badges", async () => {
  expect(await (await call("/api/insights/attention", { cookie })).json()).toEqual({
    negativeStock: 1,
    lowStock: 1,
    overdueInvoices: { count: 6, outstanding: 21_000_000 },
    pendingApprovals: null,
  });
  const admin = await signIn("admin");
  expect(await (await call("/api/insights/attention", { cookie: admin.cookie })).json()).toMatchObject({ pendingApprovals: 0 });
});
it("rejects kasir and unauthenticated reads of every endpoint", async () => {
  const kasir = await signIn("kasir");
  for (const path of [
    "/api/insights/attention",
    `/api/insights/dashboard?${query}`,
    "/api/insights/actions",
    `/api/reports/cash-book.xlsx?${query}`,
    `/api/reports/sales.xlsx?${query}`,
  ]) {
    expect((await call(path, { cookie: kasir.cookie })).status).toBe(403);
    expect((await call(path)).status).toBe(401);
  }
});

it("sums the last 12 months per month, matching the dashboard totals for the same window", async () => {
  const res = await call("/api/insights/yearly", { cookie });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Awaited<ReturnType<typeof yearlyOverview>>;
  expect(body.from).toBe("2025-12-01");
  expect(body.months.map((m) => m.month)).toEqual([
    "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05",
    "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11",
  ]);
  const kpi = (await (await call(`/api/insights/dashboard?from=${body.from}&to=${body.to}`, { cookie })).json()) as Awaited<
    ReturnType<typeof dashboard>
  >;
  expect(body.totals.sales).toBe(kpi.current.invoiceSales);
  expect(body.totals.pos).toBe(kpi.current.posSales);
  expect(body.totals.sales).toBeGreaterThan(0);
  const purchases = await db.select().from(purchaseInvoices);
  const expected = purchases
    .filter((p) => !p.voidedAt && p.date >= body.from && p.date <= body.to)
    .reduce((n, p) => n + p.total, 0);
  expect(body.totals.purchases).toBe(expected);
});
