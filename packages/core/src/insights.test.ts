import { expect, it } from "vitest";
import {
  accountBalances,
  actionItems,
  cashFlow,
  delta,
  documentProfits,
  kpis,
  outstanding,
  periodWindow,
  previousWindow,
  rankActions,
  weeklyCashFlow,
  type InsightData,
  type InsightInvoice,
} from "./insights.ts";
import { rupiah as r } from "./money.ts";

it("uses inclusive Jakarta business dates and equal previous windows across leap years", () => {
  expect(periodWindow("month", "2024-03-03")).toEqual({
    from: "2024-03-01",
    to: "2024-03-03",
  });
  expect(previousWindow({ from: "2024-03-01", to: "2024-03-03" })).toEqual({
    from: "2024-02-27",
    to: "2024-02-29",
  });
  expect(periodWindow("last-month", "2024-03-03")).toEqual({
    from: "2024-02-01",
    to: "2024-02-29",
  });
  expect(periodWindow("30-days", "2024-03-03")).toEqual({
    from: "2024-02-03",
    to: "2024-03-03",
  });
  expect(() =>
    periodWindow("custom", "2024-03-03", {
      from: "2024-03-02",
      to: "2024-03-01",
    }),
  ).toThrow();
});
it("keeps delta amounts exact, handles zero and negative baselines", () => {
  expect(delta(1200, 1000)).toEqual({ amount: 200, percent: 20 });
  expect(delta(-100, -200)).toEqual({ amount: 100, percent: 50 });
  expect(delta(100, 0)).toEqual({ amount: 100, percent: null });
  expect(delta(0, 0)).toEqual({ amount: 0, percent: 0 });
});
const invoice: InsightInvoice = {
  id: "i",
  number: "SO-1",
  contactId: "c",
  contactName: "Contoh",
  date: "2026-11-01",
  dueDate: "2026-11-05",
  total: r(1000),
  profit: r(300),
  voidedDate: null,
};
const data: InsightData = {
  invoices: [invoice, { ...invoice, id: "void", voidedDate: "2026-11-02" }],
  purchases: [{ ...invoice, id: "p", dueDate: "2026-11-20" }],
  pos: [
    {
      id: "pos",
      number: "K1",
      date: "2026-11-02",
      total: r(500),
      profit: r(100),
      voidedDate: null,
    },
  ],
  payments: [
    { invoiceId: "i", date: "2026-11-02", amount: r(200), voidedDate: null },
    {
      invoiceId: "i",
      date: "2026-11-02",
      amount: r(300),
      voidedDate: "2026-11-03",
    },
  ],
  accounts: [{ id: "cash", kind: "cash", name: "Kas" }],
  cash: [
    {
      id: "1",
      accountId: "cash",
      date: "2026-11-10",
      direction: "in",
      amount: r(500),
      sourceType: "pos_sale",
      note: "",
    },
    {
      id: "2",
      accountId: "cash",
      date: "2026-11-11",
      direction: "out",
      amount: r(100),
      sourceType: "expense",
      note: "",
    },
    {
      id: "3",
      accountId: "cash",
      date: "2026-11-12",
      direction: "out",
      amount: r(200),
      sourceType: "transfer",
      note: "",
    },
  ],
  products: [
    { id: "negative", name: "Negatif", stock: -1, minStock: 0 },
    { id: "low", name: "Rendah", stock: 1, minStock: 2 },
    { id: "enough", name: "Cukup", stock: 2, minStock: 2 },
  ],
};
it("computes literal KPI values and excludes voided sales and payments", () => {
  expect(kpis(data, { from: "2026-11-01", to: "2026-11-13" })).toEqual({
    sales: 1500,
    invoiceSales: 1000,
    posSales: 500,
    profit: 400,
    margin: 26.7,
    incoming: 500,
    outgoing: 100,
    net: 400,
    receivables: 800,
    overdue: 800,
    duePayables: 1000,
  });
  expect(outstanding(invoice, data.payments, "2026-11-01")).toBe(1000);
  expect(outstanding(invoice, data.payments, "2026-11-02")).toBe(500);
  expect(outstanding(invoice, data.payments, "2026-11-03")).toBe(800);
});
it("includes transfer movements in balances but excludes them from flow and weekly series", () => {
  expect(accountBalances(data, "2026-11-13")).toEqual([
    { id: "cash", name: "Kas", kind: "cash", balance: 200, weeklyChange: 200 },
  ]);
  expect(
    cashFlow(data.cash, { from: "2026-11-01", to: "2026-11-13" }, "missing"),
  ).toEqual({ incoming: 0, outgoing: 0, net: 0 });
  expect(weeklyCashFlow(data.cash, "2026-11-13", 2)).toEqual([
    { from: "2026-11-02", to: "2026-11-08", incoming: 0, outgoing: 0, net: 0 },
    {
      from: "2026-11-09",
      to: "2026-11-13",
      incoming: 500,
      outgoing: 100,
      net: 400,
    },
  ]);
});
it("ranks deterministic actionable groups and includes the seven-day boundary", () => {
  const items = actionItems(data, "2026-11-13");
  expect(items.map((i) => i.kind)).toEqual([
    "negative-stock",
    "receivable",
    "payable",
    "low-stock",
  ]);
  expect(items[1]).toEqual({
    kind: "receivable",
    id: "receivable:c",
    customerId: "c",
    name: "Contoh",
    amount: 800,
    count: 1,
    dueDate: "2026-11-05",
  });
  expect(rankActions([...items].reverse())).toEqual(items);
  expect(actionItems(data, "2026-11-12").map((i) => i.kind)).toEqual([
    "negative-stock",
    "receivable",
    "low-stock",
  ]);
});

it("uses line cost snapshots and line discounts for gross profit", () => {
  expect([
    ...documentProfits([
      { documentId: "invoice", lineTotal: r(900), qty: 2, unitCost: r(300) },
      { documentId: "invoice", lineTotal: r(400), qty: 1, unitCost: r(500) },
      { documentId: "pos", lineTotal: r(1000), qty: 3, unitCost: r(200) },
    ]),
  ]).toEqual([
    ["invoice", 200],
    ["pos", 400],
  ]);
});
it("suggests deposits strictly above the cash threshold and never for bank accounts", () => {
  const cash = { ...data.cash[0]!, amount: r(10000000) };
  expect(
    actionItems({ ...data, cash: [cash] }, "2026-11-13").some(
      (a) => a.kind === "deposit",
    ),
  ).toBe(false);
  expect(
    actionItems(
      { ...data, cash: [{ ...cash, amount: r(10000001) }] },
      "2026-11-13",
    ).at(-1),
  ).toMatchObject({ kind: "deposit", amount: 10000001 });
  expect(
    actionItems(
      {
        ...data,
        accounts: [{ id: "cash", name: "Bank", kind: "bank" }],
        cash: [{ ...cash, amount: r(10000001) }],
      },
      "2026-11-13",
    ).some((a) => a.kind === "deposit"),
  ).toBe(false);
});
