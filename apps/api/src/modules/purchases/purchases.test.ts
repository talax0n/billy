import { addDays, businessDate, rupiah } from "@billy/core";
import { accounts, cashEntries, contacts, payments, products, stockMovements } from "@billy/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { db, call, signIn } = await createTestApp();
let cookie: string;
let supplierId: string;
let otherSupplierId: string;
let customerId: string;
let accountId: string;
let catId: string;
let thinnerId: string;

beforeAll(async () => {
  ({ cookie } = await signIn("staff"));
  const [supplier, other, customer] = await db
    .insert(contacts)
    .values([
      { code: "S-001", name: "PT Warna Sejati", kind: "supplier", paymentTermsDays: 60 },
      { code: "S-002", name: "CV Kuas Makmur", kind: "supplier", paymentTermsDays: 30 },
      { code: "C-001", name: "Pak Budi", kind: "customer" },
    ])
    .returning();
  const [cat, thinner] = await db
    .insert(products)
    .values([
      { name: "Warnaku Tembok", variant: "Putih 5 kg", unit: "pail", costPrice: rupiah(150_000) },
      { name: "Thinner Super", variant: "1 L", unit: "botol", costPrice: rupiah(24_000) },
    ])
    .returning();
  const [account] = await db.insert(accounts).values({ code: "KAS", name: "Kas Toko", kind: "cash" }).returning();
  supplierId = supplier!.id;
  otherSupplierId = other!.id;
  customerId = customer!.id;
  catId = cat!.id;
  thinnerId = thinner!.id;
  accountId = account!.id;
});

const today = businessDate();

/** 2 × 10.000 − 2.000 = 18.000 and 3 × 5.000 = 15.000; minus 3.000 document discount; 11% PPN. */
const purchase = () => ({
  supplierId,
  supplierInvoiceNumber: "INV/WS/1107",
  date: today,
  termsDays: 60,
  discountKind: "amount",
  discountValue: 3_000,
  taxRateBp: 1_100,
  note: "",
  lines: [
    { productId: catId, qty: 2, unitCost: 10_000, discountAmount: 2_000, note: "" },
    { productId: thinnerId, qty: 3, unitCost: 5_000, discountAmount: 0, note: "" },
  ],
});

interface Detail {
  id: string;
  number: string;
  total: number;
  paid: number;
  outstanding: number;
  status: string;
  payments: { id: string; amount: number; voidedAt: string | null }[];
}

async function create(body: object) {
  const res = await call("/api/purchases", { method: "POST", cookie, body });
  return { status: res.status, body: (await res.json()) as Detail & { error?: string } };
}

const payment = (amount: number) => ({ accountId, date: today, amount, method: "transfer", note: "" });
const pay = (id: string, amount: number) => call(`/api/purchases/${id}/payments`, { method: "POST", cookie, body: payment(amount) });

const cashFor = (paymentId: string) => db.select().from(cashEntries).where(eq(cashEntries.sourceId, paymentId));
const movementsFor = (invoiceId: string) =>
  db.select().from(stockMovements).where(eq(stockMovements.sourceId, invoiceId)).orderBy(stockMovements.createdAt);
const costOf = async (id: string) => (await db.select().from(products).where(eq(products.id, id)))[0]!.costPrice;

describe("create purchase", () => {
  it("recomputes totals with PPN on the discounted subtotal and numbers it PO-YYMMDD-NNNN", async () => {
    const { status, body } = await create({ ...purchase(), total: 1 });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      number: `PO-${today.slice(2, 4)}${today.slice(5, 7)}${today.slice(8, 10)}-0001`,
      supplierName: "PT Warna Sejati",
      subtotal: 33_000,
      discountAmount: 3_000,
      taxRateBp: 1_100,
      taxAmount: 3_300,
      total: 33_300,
      paid: 0,
      outstanding: 33_300,
      status: "unpaid",
      dueDate: addDays(today, 60),
      lines: [
        { productId: catId, qty: 2, unitCost: 10_000, discountAmount: 2_000, lineTotal: 18_000 },
        { productId: thinnerId, qty: 3, unitCost: 5_000, discountAmount: 0, lineTotal: 15_000 },
      ],
    });
  });

  it("adds stock at net unit cost and moves the products' cost price to it", async () => {
    const { body } = await create(purchase());
    expect(await movementsFor(body.id)).toMatchObject([
      { productId: catId, qty: 2, reason: "purchase", unitCost: 9_000, sourceType: "purchase_invoice" },
      { productId: thinnerId, qty: 3, reason: "purchase", unitCost: 5_000, sourceType: "purchase_invoice" },
    ]);
    expect(await costOf(catId)).toBe(9_000);
    expect(await costOf(thinnerId)).toBe(5_000);
  });

  it("allows 0% PPN", async () => {
    const { body } = await create({ ...purchase(), discountKind: "none", discountValue: 0, taxRateBp: 0 });
    expect(body).toMatchObject({ subtotal: 33_000, discountAmount: 0, taxAmount: 0, total: 33_000 });
  });

  it("applies a percent document discount before PPN", async () => {
    const { body } = await create({ ...purchase(), discountKind: "percent", discountValue: 1_000, taxRateBp: 1_200 });
    // 33.000 − 10% = 29.700; 12% PPN = 3.564
    expect(body).toMatchObject({ discountAmount: 3_300, taxAmount: 3_564, total: 33_264 });
  });

  it("records 'bayar sekarang' in the same transaction", async () => {
    const { status, body } = await create({ ...purchase(), payment: payment(33_300) });
    expect(status).toBe(201);
    expect(body).toMatchObject({ paid: 33_300, outstanding: 0, status: "paid" });
    expect(await cashFor(body.payments[0]!.id)).toMatchObject([
      { accountId, direction: "out", amount: 33_300, category: "purchase", sourceType: "purchase_payment" },
    ]);
  });

  it("rolls everything back when 'bayar sekarang' exceeds the total", async () => {
    const before = (await db.select().from(stockMovements)).length;
    const { status, body } = await create({ ...purchase(), payment: payment(33_301) });
    expect(status).toBe(422);
    expect(body.error).toBe("Pembayaran melebihi sisa hutang (Rp 33.300)");
    expect(await db.select().from(stockMovements)).toHaveLength(before);
  });

  it("refuses a contact that is not a supplier, and explains bad input per field", async () => {
    expect((await create({ ...purchase(), supplierId: customerId })).status).toBe(422);
    const bad = await create({ ...purchase(), lines: [] });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ fields: { lines: "Tambahkan minimal satu barang" } });
  });
});

describe("payments and voids", () => {
  it("writes cash out per payment, derives Sebagian then Lunas, and rejects overpayment", async () => {
    const { body: invoice } = await create(purchase());

    const first = await pay(invoice.id, 13_300);
    expect(first.status).toBe(201);
    const partial = (await first.json()) as Detail;
    expect(partial).toMatchObject({ paid: 13_300, outstanding: 20_000, status: "partial" });
    expect(await cashFor(partial.payments[0]!.id)).toMatchObject([
      { direction: "out", amount: 13_300, category: "purchase", sourceType: "purchase_payment" },
    ]);

    const over = await pay(invoice.id, 20_001);
    expect(over.status).toBe(422);
    expect(await over.json()).toEqual({ error: "Pembayaran melebihi sisa hutang (Rp 20.000)" });

    const rest = (await (await pay(invoice.id, 20_000)).json()) as Detail;
    expect(rest).toMatchObject({ paid: 33_300, outstanding: 0, status: "paid" });
  });

  it("blocks voiding a paid invoice, then reverses payment and stock once the payment is voided", async () => {
    const { body: invoice } = await create(purchase());
    const paid = (await (await pay(invoice.id, 10_000)).json()) as Detail;
    const paymentId = paid.payments[0]!.id;

    const blocked = await call(`/api/purchases/${invoice.id}/void`, { method: "POST", cookie, body: { reason: "Salah input" } });
    expect(blocked.status).toBe(422);
    expect(await blocked.json()).toEqual({ error: "Faktur masih punya pembayaran. Batalkan pembayarannya dulu." });

    const voidedPayment = await call(`/api/purchases/${invoice.id}/payments/${paymentId}/void`, {
      method: "POST",
      cookie,
      body: { reason: "Salah rekening" },
    });
    expect(await voidedPayment.json()).toMatchObject({ paid: 0, outstanding: 33_300, status: "unpaid" });
    expect(await cashFor(paymentId)).toMatchObject([
      { direction: "out", amount: 10_000, category: "purchase" },
      { direction: "in", amount: 10_000, category: "reversal", sourceType: "purchase_payment", note: "Salah rekening" },
    ]);
    const [stored] = await db.select().from(payments).where(eq(payments.id, paymentId));
    expect(stored).toMatchObject({ voidReason: "Salah rekening" });
    expect(stored!.voidedAt).not.toBeNull();

    // A later purchase sets a newer cost that the void must not rewind.
    await create({ ...purchase(), lines: [{ productId: catId, qty: 1, unitCost: 9_500, discountAmount: 0, note: "" }] });

    const voided = await call(`/api/purchases/${invoice.id}/void`, { method: "POST", cookie, body: { reason: "Faktur ganda" } });
    expect(await voided.json()).toMatchObject({ status: "void", outstanding: 0, voidReason: "Faktur ganda" });
    expect(await movementsFor(invoice.id)).toMatchObject([
      { productId: catId, qty: 2, reason: "purchase" },
      { productId: thinnerId, qty: 3, reason: "purchase" },
      { productId: catId, qty: -2, reason: "reversal", unitCost: 9_000, note: "Faktur ganda" },
      { productId: thinnerId, qty: -3, reason: "reversal", unitCost: 5_000, note: "Faktur ganda" },
    ]);
    expect(await costOf(catId)).toBe(9_500);

    const again = await call(`/api/purchases/${invoice.id}/void`, { method: "POST", cookie, body: { reason: "Lagi" } });
    expect(again.status).toBe(422);
    expect((await pay(invoice.id, 1_000)).status).toBe(422);
  });

  it("needs a reason to void", async () => {
    const { body: invoice } = await create(purchase());
    const res = await call(`/api/purchases/${invoice.id}/void`, { method: "POST", cookie, body: { reason: " " } });
    expect(res.status).toBe(400);
  });
});

describe("list", () => {
  it("filters by supplier, status and search, with a summary over the filtered set", async () => {
    await create({ ...purchase(), supplierId: otherSupplierId, supplierInvoiceNumber: "KM-77", termsDays: 30, taxRateBp: 0 });
    const res = await call(`/api/purchases?supplierId=${otherSupplierId}&status=unpaid&from=${today}&to=${today}`, { cookie });
    expect(await res.json()).toMatchObject({
      total: 1,
      rows: [{ supplierName: "CV Kuas Makmur", supplierInvoiceNumber: "KM-77", total: 30_000, status: "unpaid" }],
      summary: { purchased: 30_000, paid: 0, outstanding: 30_000, overdue: 0, dueSoon: 0 },
    });
    const { body: partly } = await create({ ...purchase(), supplierId: otherSupplierId, supplierInvoiceNumber: "KM-78", taxRateBp: 0 });
    await pay(partly.id, 10_000);
    const both = await call(`/api/purchases?supplierId=${otherSupplierId}&from=${today}&to=${today}`, { cookie });
    expect(((await both.json()) as { summary: unknown }).summary).toEqual({ purchased: 60_000, paid: 10_000, outstanding: 50_000, overdue: 0, dueSoon: 0 });
    const search = await call("/api/purchases?q=kuas%20km-77", { cookie });
    expect(await search.json()).toMatchObject({ total: 1 });
    const voids = (await (await call("/api/purchases?status=void", { cookie })).json()) as { rows: Detail[] };
    expect(voids.rows.map((row) => row.status)).toEqual(["void"]);
  });

  it("shows overdue bills as Telat, not Belum bayar", async () => {
    const { body } = await create({ ...purchase(), supplierId: otherSupplierId, date: addDays(today, -40), termsDays: 30 });
    const overdue = (await (await call(`/api/purchases?status=overdue`, { cookie })).json()) as { rows: Detail[] };
    expect(overdue.rows.map((row) => row.id)).toEqual([body.id]);
    const unpaid = (await (await call(`/api/purchases?status=unpaid`, { cookie })).json()) as { rows: Detail[] };
    expect(unpaid.rows.map((row) => row.id)).not.toContain(body.id);
  });

  it("sums Telat and jatuh tempo ≤7 hari over the filtered period only", async () => {
    const [supplier] = await db.insert(contacts).values({ code: "S-TLT", name: "PT Telat", kind: "supplier" }).returning();
    const make = (date: string, termsDays: number) => create({ ...purchase(), supplierId: supplier!.id, date, termsDays, taxRateBp: 0 });
    await make(addDays(today, -40), 30); // due −10: Telat
    await make(addDays(today, -25), 30); // due +5: ≤7 hari
    await make(addDays(today, -20), 30); // due +10: later
    await make(addDays(today, -100), 30); // due −70: Telat, outside the period below
    const summary = async (from: string) =>
      ((await (await call(`/api/purchases?supplierId=${supplier!.id}&from=${from}&to=${today}`, { cookie })).json()) as { summary: unknown }).summary;
    expect(await summary(addDays(today, -60))).toMatchObject({ overdue: 30_000, dueSoon: 30_000, outstanding: 90_000 });
    expect(await summary(addDays(today, -30))).toMatchObject({ overdue: 0, dueSoon: 30_000, outstanding: 60_000 });
  });
});

describe("payables", () => {
  it("buckets open bills per supplier by due date", async () => {
    const { db: fresh, call: freshCall, signIn: freshSignIn } = await createTestApp();
    const { cookie: staff } = await freshSignIn("staff");
    const [a, b] = await fresh
      .insert(contacts)
      .values([
        { code: "S-A", name: "Pemasok A", kind: "supplier" },
        { code: "S-B", name: "Pemasok B", kind: "supplier" },
      ])
      .returning();
    const [product] = await fresh.insert(products).values({ name: "Cat", unit: "kaleng" }).returning();
    const [account] = await fresh.insert(accounts).values({ code: "KAS", name: "Kas", kind: "cash" }).returning();
    const post = async (supplier: string, date: string, termsDays: number, unitCost: number) => {
      const res = await freshCall("/api/purchases", {
        method: "POST",
        cookie: staff,
        body: {
          supplierId: supplier,
          date,
          termsDays,
          discountKind: "none",
          discountValue: 0,
          taxRateBp: 0,
          lines: [{ productId: product!.id, qty: 1, unitCost, discountAmount: 0 }],
        },
      });
      return ((await res.json()) as Detail).id;
    };
    await post(a!.id, addDays(today, -10), 5, 100_000); // due 5 days ago: late
    const partlyPaid = await post(a!.id, today, 7, 200_000); // due in 7 days
    await post(a!.id, today, 8, 300_000); // due in 8 days: 8–30
    await post(b!.id, today, 31, 400_000); // due in 31 days: later
    await post(b!.id, today, 0, 50_000); // due today: within 7
    const paidOff = await post(b!.id, today, 0, 70_000);
    await freshCall(`/api/purchases/${partlyPaid}/payments`, {
      method: "POST",
      cookie: staff,
      body: { accountId: account!.id, date: today, amount: 150_000, method: "cash" },
    });
    await freshCall(`/api/purchases/${paidOff}/payments`, {
      method: "POST",
      cookie: staff,
      body: { accountId: account!.id, date: today, amount: 70_000, method: "cash" },
    });

    const res = await freshCall("/api/purchases/payables", { cookie: staff });
    expect(await res.json()).toEqual({
      asOf: today,
      total: 2,
      totals: { late: 100_000, within7: 100_000, within30: 300_000, later: 400_000, total: 900_000 },
      rows: [
        {
          id: a!.id,
          supplierName: "Pemasok A",
          invoiceCount: 3,
          nextDueDate: addDays(today, -5),
          late: 100_000,
          within7: 50_000,
          within30: 300_000,
          later: 0,
          total: 450_000,
        },
        {
          id: b!.id,
          supplierName: "Pemasok B",
          invoiceCount: 2,
          nextDueDate: today,
          late: 0,
          within7: 50_000,
          within30: 0,
          later: 400_000,
          total: 450_000,
        },
      ],
    });

    const drill = await freshCall(`/api/purchases/payables/${a!.id}`, { cookie: staff });
    expect(await drill.json()).toMatchObject({
      total: 3,
      rows: [
        { bucket: "late", outstanding: 100_000, status: "unpaid", overdue: true },
        { bucket: "within7", outstanding: 50_000, status: "partial" },
        { bucket: "within30", outstanding: 300_000 },
      ],
    });
  });
});

describe("roles", () => {
  it("is closed to kasir", async () => {
    const { cookie: kasir } = await signIn("kasir");
    expect((await call("/api/purchases", { cookie: kasir })).status).toBe(403);
    expect((await call("/api/purchases/payables", { cookie: kasir })).status).toBe(403);
    const post = await call("/api/purchases", { method: "POST", cookie: kasir, body: purchase() });
    expect(post.status).toBe(403);
  });
});
