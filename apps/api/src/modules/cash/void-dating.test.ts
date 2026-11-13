import { uuidv7 } from "@billy/core";
import { cashEntries, contacts, settings, stockMovements } from "@billy/db";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestApp } from "../../testing.ts";

/**
 * Void dating (data-model ground rule 3): every reversal row is dated on the business date of
 * the void, never on the original document, so periods already reported stay unchanged.
 * Every document here is dated 1 Nov and voided on 13 Nov.
 */
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-11-13T07:00:00Z"));
afterAll(() => vi.useRealTimers());

const { call, db, signIn, shiftFor } = await createTestApp();
let cookie: string;
let kas: string;
let bca: string;
let product: string;
let customerId: string;
let supplierId: string;
const past = "2026-11-01";

const post = async (path: string, body: object) => {
  const res = await call(path, { method: "POST", cookie, body });
  expect(res.status).toBeLessThan(300);
  return (await res.json()) as { id: string; payments?: { id: string }[] };
};
const voidIt = (path: string) => post(`${path}/void`, { reason: "Salah input" });

/** Dates of the reversal rows written for `sourceId`, cash and stock. */
const reversalDates = async (sourceIds: string[]) => [
  ...(await db
    .select({ date: cashEntries.date })
    .from(cashEntries)
    .where(and(inArray(cashEntries.sourceId, sourceIds), eq(cashEntries.category, "reversal")))).map((r) => `cash ${r.date}`),
  ...(await db
    .select({ date: stockMovements.date })
    .from(stockMovements)
    .where(and(inArray(stockMovements.sourceId, sourceIds), eq(stockMovements.reason, "reversal")))).map((r) => `stock ${r.date}`),
];

beforeAll(async () => {
  ({ cookie } = await signIn("admin"));
  await db.insert(settings).values({ shopName: "Toko Uji", receiptFooter: "", posDeviceCode: "K1" });
  kas = (await post("/api/accounts", { code: "KAS", name: "Kas", kind: "cash" })).id;
  bca = (await post("/api/accounts", { code: "BCA", name: "BCA", kind: "bank" })).id;
  [{ id: customerId }, { id: supplierId }] = (await db
    .insert(contacts)
    .values([
      { code: "P-1", name: "Pelanggan", kind: "customer" },
      { code: "S-1", name: "Pemasok", kind: "supplier" },
    ])
    .returning({ id: contacts.id })) as [{ id: string }, { id: string }];
  product = (
    await post("/api/products", { code: "P1", barcode: null, name: "Cat", variant: "", unit: "pail", categoryId: null, sellPrice: 100_000, costPrice: 60_000, minStock: 0 })
  ).id;
});

it("dates transfer reversals on the void date", async () => {
  const { id } = await post("/api/cash/transfers", { fromAccountId: kas, toAccountId: bca, date: past, amount: 10_000, note: "" });
  await voidIt(`/api/cash/transfers/${id}`);
  expect(await reversalDates([id])).toEqual(["cash 2026-11-13", "cash 2026-11-13"]);
});

it("dates expense reversals on the void date", async () => {
  const { id } = await post("/api/expenses", { date: past, accountId: kas, category: "Listrik", description: "", amount: 10_000 });
  await voidIt(`/api/expenses/${id}`);
  expect(await reversalDates([id])).toEqual(["cash 2026-11-13"]);
});

it("dates sales payment and sales invoice reversals on the void date", async () => {
  const invoice = await post("/api/sales", {
    customerId,
    date: past,
    termsDays: 0,
    discountKind: "none",
    discountValue: 0,
    note: "",
    lines: [{ productId: product, qty: 1, unitPrice: 100_000, note: "" }],
    payment: { accountId: kas, amount: 100_000, method: "cash", note: "" },
  });
  const paymentId = invoice.payments![0]!.id;
  await voidIt(`/api/sales/${invoice.id}/payments/${paymentId}`);
  await voidIt(`/api/sales/${invoice.id}`);
  expect(await reversalDates([paymentId, invoice.id])).toEqual(["cash 2026-11-13", "stock 2026-11-13"]);
});

it("dates purchase payment and purchase invoice reversals on the void date", async () => {
  const purchase = await post("/api/purchases", {
    supplierId,
    supplierInvoiceNumber: "",
    date: past,
    termsDays: 0,
    discountKind: "none",
    discountValue: 0,
    taxRateBp: 0,
    note: "",
    lines: [{ productId: product, qty: 1, unitCost: 60_000, discountAmount: 0, note: "" }],
    payment: { accountId: kas, date: past, amount: 60_000, method: "cash", note: "" },
  });
  const paymentId = purchase.payments![0]!.id;
  await voidIt(`/api/purchases/${purchase.id}/payments/${paymentId}`);
  await voidIt(`/api/purchases/${purchase.id}`);
  expect(await reversalDates([paymentId, purchase.id])).toEqual(["cash 2026-11-13", "stock 2026-11-13"]);
});

it("dates POS sale reversals on the void date", async () => {
  const id = uuidv7();
  await post("/api/pos/sales", {
    id,
    number: "K1-261101-0001",
    shiftId: await shiftFor(cookie),
    soldAt: "2026-11-01T02:00:00.000Z",
    lines: [{ productId: product, qty: 1, unitPrice: 100_000 }],
    discount: { kind: "none", value: 0 },
    method: "cash",
    accountId: kas,
    tendered: 100_000,
    total: 100_000,
  });
  await voidIt(`/api/pos/sales/${id}`);
  expect(await reversalDates([id])).toEqual(["cash 2026-11-13", "stock 2026-11-13"]);
});
