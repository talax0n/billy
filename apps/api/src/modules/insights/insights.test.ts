import { cashEntries, stockMovements } from "@billy/db";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestApp } from "../../testing.ts";
import { seedInsightDemo } from "./fixture.ts";
import { dashboard, listActions, readInsightData } from "./service.ts";

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
  const data = await readInsightData(db, "2026-11-13");
  expect(data.cash).toHaveLength(38);
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

  expect(data.products.find((p) => p.id === fixture.productId)?.stock).toBe(15);
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
it("rejects kasir and unauthenticated reads of every endpoint", async () => {
  const kasir = await signIn("kasir");
  for (const path of [
    `/api/insights/dashboard?${query}`,
    "/api/insights/actions",
    `/api/reports/cash-book.xlsx?${query}`,
    `/api/reports/sales.xlsx?${query}`,
  ]) {
    expect((await call(path, { cookie: kasir.cookie })).status).toBe(403);
    expect((await call(path)).status).toBe(401);
  }
});
