import { expect, it } from "vitest";
import {
  actionItems,
  delta,
  kpis,
  periodWindow,
  previousWindow,
  rankActions,
  weeklyCashFlow,
  type AccountBalance,
  type OpenInvoice,
  type OpenInvoices,
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
const receivable: OpenInvoice = {
  id: "i",
  number: "SO-1",
  contactId: "c",
  contactName: "Contoh",
  dueDate: "2026-11-05",
  total: r(1000),
  outstanding: r(800),
};
const open: OpenInvoices = {
  receivables: [receivable],
  payables: [
    { ...receivable, id: "p", dueDate: "2026-11-20", outstanding: r(1000) },
  ],
};
const cash: AccountBalance = {
  id: "cash",
  name: "Kas",
  kind: "cash",
  balance: r(200),
  weeklyChange: r(200),
};
const actionInput = {
  ...open,
  balances: [cash],
  products: [
    { id: "negative", name: "Negatif", stock: -1, minStock: 0 },
    { id: "low", name: "Rendah", stock: 1, minStock: 2 },
    { id: "enough", name: "Cukup", stock: 2, minStock: 2 },
  ],
};
it("derives literal KPI values from period totals and open invoices", () => {
  expect(
    kpis(
      {
        invoiceSales: r(1000),
        posSales: r(500),
        profit: r(400),
        incoming: r(500),
        outgoing: r(100),
      },
      open,
      "2026-11-13",
    ),
  ).toEqual({
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
  expect(
    kpis(
      {
        invoiceSales: r(0),
        posSales: r(0),
        profit: r(0),
        incoming: r(0),
        outgoing: r(0),
      },
      open,
      "2026-11-05",
    ),
  ).toMatchObject({ margin: 0, receivables: 800, overdue: 0, duePayables: 0 });
});
it("fills weeks without cash movement with zeros", () => {
  expect(
    weeklyCashFlow(
      [{ from: "2026-11-09", incoming: r(500), outgoing: r(100) }],
      "2026-11-13",
      2,
    ),
  ).toEqual([
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
  const items = actionItems(actionInput, "2026-11-13");
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
  expect(actionItems(actionInput, "2026-11-12").map((i) => i.kind)).toEqual([
    "negative-stock",
    "receivable",
    "low-stock",
  ]);
});
it("groups a customer's overdue invoices with the oldest due date", () => {
  expect(
    actionItems(
      {
        ...actionInput,
        receivables: [
          receivable,
          { ...receivable, id: "j", dueDate: "2026-11-01", outstanding: r(300) },
          { ...receivable, id: "k", dueDate: "2026-11-13", outstanding: r(50) },
        ],
      },
      "2026-11-13",
    )[1],
  ).toMatchObject({ amount: 1100, count: 2, dueDate: "2026-11-01" });
});
it("suggests deposits strictly above the cash threshold and never for bank accounts", () => {
  const balance = (b: Partial<AccountBalance>) => ({
    ...actionInput,
    balances: [{ ...cash, ...b }],
  });
  expect(
    actionItems(balance({ balance: r(10000000) }), "2026-11-13").some(
      (a) => a.kind === "deposit",
    ),
  ).toBe(false);
  expect(
    actionItems(balance({ balance: r(10000001) }), "2026-11-13").at(-1),
  ).toMatchObject({ kind: "deposit", amount: 10000001 });
  expect(
    actionItems(
      balance({ name: "Bank", kind: "bank", balance: r(10000001) }),
      "2026-11-13",
    ).some((a) => a.kind === "deposit"),
  ).toBe(false);
});
