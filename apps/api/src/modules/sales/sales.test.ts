import { addDays, businessDate, rupiah } from "@billy/core";
import { accounts, cashEntries, contacts, products, stockMovements } from "@billy/db";
import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { db, call, signIn } = await createTestApp();
let cookie: string;
let customerId: string;
let accountId: string;
let paintId: string;
let thinnerId: string;
const today = businessDate();

beforeAll(async () => {
  ({ cookie } = await signIn("staff"));
  const [customer] = await db
    .insert(contacts)
    .values({ code: "P-001", name: "CV Bangun Jaya", kind: "customer", paymentTermsDays: 30 })
    .returning();
  await db.insert(contacts).values({ code: "S-001", name: "PT Pemasok Cat", kind: "supplier" });
  const [account] = await db.insert(accounts).values({ code: "BCA", name: "BCA Operasional", kind: "bank" }).returning();
  const [paint, thinner] = await db
    .insert(products)
    .values([
      { name: "Warnaku Tembok", variant: "Putih 5 kg", unit: "pail", sellPrice: rupiah(185_000), costPrice: rupiah(152_000) },
      { name: "Thinner Super", variant: "1 L", unit: "botol", sellPrice: rupiah(32_000), costPrice: rupiah(24_500) },
    ])
    .returning();
  customerId = customer!.id;
  accountId = account!.id;
  paintId = paint!.id;
  thinnerId = thinner!.id;
});

type Json = Record<string, any>;

async function post(path: string, body: object) {
  const res = await call(path, { method: "POST", cookie, body });
  return { status: res.status, body: (await res.json()) as Json };
}

const invoiceBody = (overrides: object = {}) => ({
  customerId,
  date: today,
  termsDays: 30,
  discountKind: "percent",
  discountValue: 500, // 5%
  note: "",
  lines: [
    { productId: paintId, qty: 4, unitPrice: 185_000, discountAmount: 20_000, note: "Tinting NW-1023" },
    { productId: thinnerId, qty: 3, unitPrice: 32_000 },
  ],
  ...overrides,
});

const stockOf = (sourceId: string) =>
  db
    .select({ productId: stockMovements.productId, qty: stockMovements.qty, reason: stockMovements.reason, unitCost: stockMovements.unitCost })
    .from(stockMovements)
    .where(eq(stockMovements.sourceId, sourceId))
    .orderBy(asc(stockMovements.createdAt), asc(stockMovements.qty));

const cashOf = (sourceId: string) =>
  db
    .select({
      accountId: cashEntries.accountId,
      direction: cashEntries.direction,
      amount: cashEntries.amount,
      category: cashEntries.category,
      sourceType: cashEntries.sourceType,
    })
    .from(cashEntries)
    .where(eq(cashEntries.sourceId, sourceId))
    .orderBy(asc(cashEntries.createdAt));

describe("create sales invoice", () => {
  it("recomputes totals with line and document discounts and snapshots cost", async () => {
    const { status, body } = await post("/api/sales", invoiceBody());
    expect(status).toBe(201);
    // 4 × 185.000 − 20.000 = 720.000; 3 × 32.000 = 96.000; subtotal 816.000; 5% = 40.800
    expect(body).toMatchObject({
      number: expect.stringMatching(/^SO-\d{6}-0001$/),
      dueDate: addDays(today, 30),
      subtotal: 816_000,
      discountKind: "percent",
      discountValue: 500,
      discountAmount: 40_800,
      total: 775_200,
      paid: 0,
      state: { status: "unpaid", outstanding: 775_200, overdue: false },
      customer: { name: "CV Bangun Jaya" },
      lines: [
        { position: 0, qty: 4, unitPrice: 185_000, discountAmount: 20_000, lineTotal: 720_000, note: "Tinting NW-1023" },
        { position: 1, qty: 3, unitPrice: 32_000, discountAmount: 0, lineTotal: 96_000 },
      ],
    });
  });

  it("writes one sale stock movement per line at the cost price", async () => {
    const { body } = await post("/api/sales", invoiceBody({ discountKind: "amount", discountValue: 16_000 }));
    expect(body.total).toBe(800_000);
    expect(await stockOf(body.id)).toEqual([
      { productId: paintId, qty: -4, reason: "sale", unitCost: 152_000 },
      { productId: thinnerId, qty: -3, reason: "sale", unitCost: 24_500 },
    ]);
  });

  it("records a pay-now payment and its cash entry in the same command", async () => {
    const { status, body } = await post(
      "/api/sales",
      invoiceBody({ discountKind: "none", discountValue: 0, payment: { accountId, amount: 816_000, method: "transfer" } }),
    );
    expect(status).toBe(201);
    expect(body).toMatchObject({ total: 816_000, paid: 816_000, state: { status: "paid", outstanding: 0 } });
    expect(await cashOf(body.payments[0].id)).toEqual([
      { accountId, direction: "in", amount: 816_000, category: "sale", sourceType: "sales_payment" },
    ]);
  });

  it("rejects a supplier as customer and a document discount above the subtotal", async () => {
    const [supplier] = await db.select().from(contacts).where(eq(contacts.code, "S-001"));
    expect((await post("/api/sales", invoiceBody({ customerId: supplier!.id }))).status).toBe(422);
    const res = await post("/api/sales", invoiceBody({ discountKind: "amount", discountValue: 816_001 }));
    expect(res).toEqual({ status: 422, body: { error: "Diskon melebihi subtotal" } });
  });
});

describe("payments", () => {
  let invoiceId: string;

  beforeAll(async () => {
    invoiceId = (await post("/api/sales", invoiceBody({ discountKind: "none", discountValue: 0 }))).body.id;
  });

  it("records a partial payment with a cash entry in / sale", async () => {
    const { status, body } = await post(`/api/sales/${invoiceId}/payments`, {
      accountId,
      amount: 300_000,
      method: "cash",
      date: today,
      proofUrl: "https://contoh.id/bukti.jpg",
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({ paid: 300_000, state: { status: "partial", outstanding: 516_000 } });
    expect(body.payments[0]).toMatchObject({ amount: 300_000, method: "cash", proofUrl: "https://contoh.id/bukti.jpg" });
    expect(await cashOf(body.payments[0].id)).toEqual([
      { accountId, direction: "in", amount: 300_000, category: "sale", sourceType: "sales_payment" },
    ]);
  });

  it("rejects overpayment", async () => {
    const res = await post(`/api/sales/${invoiceId}/payments`, { accountId, amount: 516_001, method: "cash", date: today });
    expect(res).toEqual({ status: 422, body: { error: "Pembayaran melebihi sisa tagihan Rp 516.000" } });
  });

  it("refuses to void the invoice while a payment stands", async () => {
    const res = await post(`/api/sales/${invoiceId}/void`, { reason: "Salah input" });
    expect(res).toEqual({ status: 409, body: { error: "Void dulu semua pembayaran faktur ini" } });
  });

  it("voids the payment with a reversal cash entry, then the invoice with reversal stock rows", async () => {
    const detail = (await (await call(`/api/sales/${invoiceId}`, { cookie })).json()) as Json;
    const paymentId = detail.payments[0].id as string;

    const voided = await post(`/api/sales/${invoiceId}/payments/${paymentId}/void`, { reason: "Transfer batal" });
    expect(voided.status).toBe(200);
    expect(voided.body).toMatchObject({ paid: 0, state: { status: "unpaid", outstanding: 816_000 } });
    expect(await cashOf(paymentId)).toEqual([
      { accountId, direction: "in", amount: 300_000, category: "sale", sourceType: "sales_payment" },
      { accountId, direction: "out", amount: 300_000, category: "reversal", sourceType: "sales_payment" },
    ]);
    expect((await post(`/api/sales/${invoiceId}/payments/${paymentId}/void`, { reason: "lagi" })).status).toBe(409);

    const res = await post(`/api/sales/${invoiceId}/void`, { reason: "Salah input" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ voidReason: "Salah input", state: { status: "void", outstanding: 0 } });
    expect(await stockOf(invoiceId)).toEqual([
      { productId: paintId, qty: -4, reason: "sale", unitCost: 152_000 },
      { productId: thinnerId, qty: -3, reason: "sale", unitCost: 24_500 },
      { productId: thinnerId, qty: 3, reason: "reversal", unitCost: 24_500 },
      { productId: paintId, qty: 4, reason: "reversal", unitCost: 152_000 },
    ]);
    expect((await post(`/api/sales/${invoiceId}/void`, { reason: "lagi" })).status).toBe(409);
    expect((await post(`/api/sales/${invoiceId}/payments`, { accountId, amount: 1, method: "cash", date: today })).status).toBe(409);
  });
});

describe("lists", () => {
  it("filters by status and summarises the filtered set", async () => {
    const res = await call(`/api/sales?status=open&from=${today}&to=${today}`, { cookie });
    const body = (await res.json()) as Json;
    expect(body.total).toBe(2);
    expect(body.summary).toEqual({ count: 2, total: 1_575_200, paid: 0, outstanding: 1_575_200, overdue: 0 });
    expect(body.rows.map((r: Json) => r.state.status)).toEqual(["unpaid", "unpaid"]);

    const all = (await (await call("/api/sales?q=bangun", { cookie })).json()) as Json;
    expect(all.total).toBe(4);
    expect(all.summary).toMatchObject({ count: 3, paid: 816_000 });
  });

  it("ages receivables per customer", async () => {
    const body = (await (await call("/api/sales/receivables", { cookie })).json()) as Json;
    expect(body.rows).toEqual([
      {
        id: customerId,
        customerName: "CV Bangun Jaya",
        current: 1_575_200,
        d1_30: 0,
        d31_60: 0,
        d61_90: 0,
        d90_plus: 0,
        total: 1_575_200,
        invoiceCount: 2,
      },
    ]);
  });

  it("returns exactly the rows whose status tag matches each filter", async () => {
    const late = await post("/api/sales", invoiceBody({ date: addDays(today, -40), termsDays: 30 }));
    const partial = await post("/api/sales", invoiceBody());
    await post(`/api/sales/${partial.body.id}/payments`, { accountId, amount: 100_000, method: "cash", date: today });
    const tag = (state: Json) => (state.overdue ? "overdue" : state.status);

    const tags: Record<string, string[]> = {};
    for (const status of ["unpaid", "partial", "overdue", "paid", "void"]) {
      const body = (await (await call(`/api/sales?status=${status}`, { cookie })).json()) as Json;
      tags[status] = body.rows.map((r: Json) => tag(r.state));
      expect(body.total).toBe(body.rows.length);
    }
    expect(tags).toEqual({
      unpaid: ["unpaid", "unpaid"],
      partial: ["partial"],
      overdue: ["overdue"],
      paid: ["paid"],
      void: ["void"],
    });
    expect(late.status).toBe(201);
  });
});

it("refuses the kasir role", async () => {
  const kasir = await signIn("kasir");
  for (const path of ["/api/sales", "/api/sales/receivables"]) {
    expect((await call(path, { cookie: kasir.cookie })).status).toBe(403);
  }
  const res = await call("/api/sales", { method: "POST", cookie: kasir.cookie, body: invoiceBody() });
  expect(res.status).toBe(403);
});
