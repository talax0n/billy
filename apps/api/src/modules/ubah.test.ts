import { businessDate, rupiah } from "@billy/core";
import { auditEvents, contacts, products, settings } from "@billy/db";
import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../testing.ts";

type Json = Record<string, any>;
const today = businessDate();
const PIN = "246810";

/**
 * A fresh shop: two accounts, two customers, a supplier and two products. Two shops built
 * the same way can be compared by account code and product name, never by id.
 */
async function shop() {
  const app = await createTestApp();
  const { cookie: admin } = await app.signIn("admin");
  const { cookie: staff } = await app.signIn("staff");
  const call = async (method: string, path: string, body?: object, cookie = admin) => {
    const res = await app.call(path, { method, cookie, ...(body && { body }) });
    return { status: res.status, body: (await res.json()) as Json };
  };
  const post = (path: string, body: object = {}, cookie = admin) => call("POST", path, body, cookie);
  const get = async (path: string, cookie = admin) => (await call("GET", path, undefined, cookie)).body;

  await app.db.insert(settings).values({ shopName: "Toko Uji", receiptFooter: "", posDeviceCode: "K1" });
  await call("PUT", "/api/approvals/pin", { password: "rahasia123", pin: PIN });
  const kas = (await post("/api/accounts", { code: "KAS", name: "Kas", kind: "cash" })).body.id as string;
  const bca = (await post("/api/accounts", { code: "BCA", name: "BCA", kind: "bank" })).body.id as string;
  const [customer, otherCustomer, supplier] = (await app.db
    .insert(contacts)
    .values([
      { code: "P-001", name: "Pelanggan Satu", kind: "customer" },
      { code: "P-002", name: "Pelanggan Dua", kind: "customer" },
      { code: "S-001", name: "Pemasok Satu", kind: "supplier" },
    ])
    .returning({ id: contacts.id })) as [{ id: string }, { id: string }, { id: string }];
  const [paint, thinner] = (await app.db
    .insert(products)
    .values([
      { name: "Cat Tembok", variant: "5 kg", unit: "pail", sellPrice: rupiah(185_000), costPrice: rupiah(150_000) },
      { name: "Thinner", variant: "1 L", unit: "botol", sellPrice: rupiah(32_000), costPrice: rupiah(24_000) },
    ])
    .returning({ id: products.id })) as [{ id: string }, { id: string }];

  /** What a user can see of stock, costs and money: per product name and account code. */
  async function books() {
    const productRows = (await get("/api/products?pageSize=100")).rows as { name: string; stock: number; costPrice: number }[];
    const accountRows = (await get("/api/accounts?pageSize=100")).rows as { code: string; balance: number }[];
    return {
      stock: Object.fromEntries(productRows.map((p) => [p.name, p.stock])),
      cost: Object.fromEntries(productRows.map((p) => [p.name, p.costPrice])),
      balance: Object.fromEntries(accountRows.map((a) => [a.code, a.balance])),
    };
  }

  const auditCount = async (actions: string[]) =>
    (await app.db.select({ id: auditEvents.id }).from(auditEvents).where(inArray(auditEvents.action, actions))).length;

  return {
    db: app.db,
    admin,
    staff,
    post,
    get,
    books,
    auditCount,
    ids: { kas, bca, customer: customer.id, otherCustomer: otherCustomer.id, supplier: supplier.id, paint: paint.id, thinner: thinner.id },
  };
}

type Shop = Awaited<ReturnType<typeof shop>>;

const invoice = (s: Shop, lines: { product: "paint" | "thinner"; qty: number; unitPrice: number }[], extra: object = {}) => ({
  customerId: s.ids.customer,
  date: today,
  termsDays: 30,
  discountKind: "none",
  discountValue: 0,
  note: "",
  lines: lines.map((l) => ({ productId: s.ids[l.product], qty: l.qty, unitPrice: l.unitPrice })),
  ...extra,
});
const payment = (s: Shop, amount: number) => ({ accountId: s.ids.kas, amount, method: "cash" });

const before = [
  { product: "paint", qty: 4, unitPrice: 185_000 },
  { product: "thinner", qty: 3, unitPrice: 32_000 },
] as const;
const after = [
  { product: "paint", qty: 2, unitPrice: 180_000 },
  { product: "thinner", qty: 6, unitPrice: 32_000 },
] as const;

// Each test builds one or two fresh databases.
describe("Ubah faktur penjualan", { timeout: 30_000 }, () => {
  it("ends with the stock and cash of entering the corrected invoice directly", async () => {
    const [edited, direct] = await Promise.all([shop(), shop()]);
    const original = await edited.post("/api/sales", invoice(edited, [...before], { payment: payment(edited, 300_000) }));
    expect(original.status).toBe(201);
    const res = await edited.post(`/api/sales/${original.body.id}/edit`, { ...invoice(edited, [...after]), reason: "Salah qty" });
    expect(res.status).toBe(201);

    expect((await direct.post("/api/sales", invoice(direct, [...after], { payment: payment(direct, 300_000) }))).status).toBe(201);

    expect(await edited.books()).toEqual(await direct.books());
    expect(res.body).toMatchObject({
      number: `${original.body.number}/R1`,
      total: 2 * 180_000 + 6 * 32_000,
      paid: 300_000,
      revisionOf: { id: original.body.id, number: original.body.number },
      revisedBy: null,
    });
    expect(res.body.payments).toHaveLength(1);

    const old = await edited.get(`/api/sales/${original.body.id}`);
    expect(old).toMatchObject({
      voidReason: "Diubah: Salah qty",
      paid: 0,
      payments: [],
      revisedBy: { id: res.body.id, number: res.body.number },
    });
    expect(old.voidedAt).not.toBeNull();
    // One audit event for the edit; no separate void or create was logged for it.
    expect(await edited.auditCount(["sales.invoice.edit"])).toBe(1);
    expect(await edited.auditCount(["sales.invoice.void", "sales.invoice.create"])).toBe(1);
  });

  it("numbers a further edit /R2 and refuses to edit the replaced invoice again", async () => {
    const s = await shop();
    const original = await s.post("/api/sales", invoice(s, [...before]));
    const r1 = await s.post(`/api/sales/${original.body.id}/edit`, { ...invoice(s, [...after]), reason: "Harga" });
    const r2 = await s.post(`/api/sales/${r1.body.id}/edit`, { ...invoice(s, [...before]), reason: "Balik lagi" });
    expect(r2.status).toBe(201);
    expect(r2.body.number).toBe(`${original.body.number}/R2`);
    expect((await s.post(`/api/sales/${original.body.id}/edit`, { ...invoice(s, [...after]), reason: "Lagi" })).status).toBe(409);
  });

  it("refuses when the payments already made exceed the new total", async () => {
    const s = await shop();
    const original = await s.post("/api/sales", invoice(s, [...before], { payment: payment(s, 836_000) }));
    const res = await s.post(`/api/sales/${original.body.id}/edit`, {
      ...invoice(s, [{ product: "thinner", qty: 1, unitPrice: 32_000 }]),
      reason: "Batal sebagian",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("lebih dari total baru");
    expect((await s.get(`/api/sales/${original.body.id}`)).voidedAt).toBeNull();
  });

  it("needs a revisi_lower approval, bound to the original and the new total, when staff lowers the total", async () => {
    const s = await shop();
    const original = await s.post("/api/sales", invoice(s, [...before]));
    const lower = { ...invoice(s, [{ product: "paint", qty: 4, unitPrice: 150_000 }]), reason: "Harga khusus" };

    const refused = await s.post(`/api/sales/${original.body.id}/edit`, lower, s.staff);
    expect(refused.status).toBe(403);
    expect(refused.body.approval).toEqual({ kind: "revisi_lower" });

    const request = await s.post("/api/approvals", { action: "sales.invoice.edit", originalId: original.body.id, edit: lower }, s.staff);
    expect(request.status).toBe(201);
    expect(request.body.kind).toBe("revisi_lower");
    expect((await s.post(`/api/approvals/${request.body.id}/approve`)).status).toBe(200);

    // The approval fits only the total it was given for.
    const otherTotal = { ...lower, lines: [{ productId: s.ids.paint, qty: 4, unitPrice: 140_000 }] };
    expect((await s.post(`/api/sales/${original.body.id}/edit`, { ...otherTotal, approval: { id: request.body.id } }, s.staff)).status).toBe(403);

    const approved = await s.post(`/api/sales/${original.body.id}/edit`, { ...lower, approval: { id: request.body.id } }, s.staff);
    expect(approved.status).toBe(201);
    expect(approved.body.total).toBe(600_000);
    const [event] = await s.db.select().from(auditEvents).where(eq(auditEvents.action, "sales.invoice.edit"));
    expect(event!.approvalId).toBe(request.body.id);
  });

  it("lets staff raise the total without approval, and accepts the admin PIN for a lower one", async () => {
    const s = await shop();
    const original = await s.post("/api/sales", invoice(s, [...before]));
    const higher = await s.post(`/api/sales/${original.body.id}/edit`, { ...invoice(s, [...before, { product: "thinner", qty: 1, unitPrice: 32_000 }]), reason: "Tambah" }, s.staff);
    expect(higher.status).toBe(201);
    const lower = await s.post(`/api/sales/${higher.body.id}/edit`, { ...invoice(s, [...after]), reason: "Kurang", approval: { pin: PIN } }, s.staff);
    expect(lower.status).toBe(201);
  });

  it("moves an open tukar faktur to the new invoice and keeps its customer", async () => {
    const s = await shop();
    const original = await s.post("/api/sales", invoice(s, [...before]));
    const bundle = await s.post("/api/invoice-bundles", { customerId: s.ids.customer, date: today, note: "", invoiceIds: [original.body.id] });
    expect(bundle.status).toBe(201);

    const otherCustomer = await s.post(`/api/sales/${original.body.id}/edit`, { ...invoice(s, [...after]), customerId: s.ids.otherCustomer, reason: "Salah pelanggan" });
    expect(otherCustomer.status).toBe(422);

    const res = await s.post(`/api/sales/${original.body.id}/edit`, { ...invoice(s, [...after]), reason: "Salah qty" });
    expect(res.status).toBe(201);
    const relinked = await s.get(`/api/invoice-bundles/${bundle.body.id}`);
    expect(relinked.invoices.map((i: Json) => i.id)).toEqual([res.body.id]);
    expect(relinked.total).toBe(res.body.total);
  });
});

describe("Ubah faktur pembelian", { timeout: 30_000 }, () => {
  const purchase = (s: Shop, lines: { product: "paint" | "thinner"; qty: number; unitCost: number }[]) => ({
    supplierId: s.ids.supplier,
    supplierInvoiceNumber: "INV-9",
    date: today,
    termsDays: 30,
    discountKind: "none",
    discountValue: 0,
    taxRateBp: 1_100,
    note: "",
    lines: lines.map((l) => ({ productId: s.ids[l.product], qty: l.qty, unitCost: l.unitCost, discountAmount: 0, note: "" })),
  });
  const pay = (s: Shop, amount: number) => ({ accountId: s.ids.bca, date: today, amount, method: "transfer", note: "" });
  const wrong = [
    { product: "paint", qty: 10, unitCost: 140_000 },
    { product: "thinner", qty: 24, unitCost: 22_000 },
  ] as const;
  const right = [
    { product: "paint", qty: 12, unitCost: 138_000 },
    { product: "thinner", qty: 20, unitCost: 22_000 },
  ] as const;

  it("ends with the stock, costs and cash of entering the corrected invoice directly", async () => {
    const [edited, direct] = await Promise.all([shop(), shop()]);
    const original = await edited.post("/api/purchases", { ...purchase(edited, [...wrong]), payment: pay(edited, 1_000_000) });
    expect(original.status).toBe(201);
    const res = await edited.post(`/api/purchases/${original.body.id}/edit`, { ...purchase(edited, [...right]), reason: "Qty salah" });
    expect(res.status).toBe(201);

    await direct.post("/api/purchases", { ...purchase(direct, [...right]), payment: pay(direct, 1_000_000) });

    expect(await edited.books()).toEqual(await direct.books());
    expect(res.body).toMatchObject({ number: `${original.body.number}/R1`, paid: 1_000_000, revisionOf: { id: original.body.id } });
    expect(await edited.get(`/api/purchases/${original.body.id}`)).toMatchObject({
      status: "void",
      voidReason: "Diubah: Qty salah",
      revisedBy: { id: res.body.id, number: res.body.number },
    });
    expect(await edited.auditCount(["purchase.invoice.edit"])).toBe(1);
  });

  it("refuses when the payments already made exceed the new total", async () => {
    const s = await shop();
    const original = await s.post("/api/purchases", { ...purchase(s, [...wrong]), payment: pay(s, 1_500_000) });
    const res = await s.post(`/api/purchases/${original.body.id}/edit`, { ...purchase(s, [{ product: "thinner", qty: 1, unitCost: 22_000 }]), reason: "Retur" });
    expect(res.status).toBe(422);
    expect((await s.get(`/api/purchases/${original.body.id}`)).voidedAt).toBeNull();
  });
});

describe("Ubah biaya", { timeout: 30_000 }, () => {
  it("ends with the balances of entering the corrected expense directly", async () => {
    const expense = (s: Shop, accountId: string, amount: number) => ({ date: today, accountId, category: "Listrik", description: "", amount, proofUrl: "" });
    const [edited, direct] = await Promise.all([shop(), shop()]);
    const original = await edited.post("/api/expenses", expense(edited, edited.ids.kas, 450_000));
    const res = await edited.post(`/api/expenses/${original.body.id}/edit`, { ...expense(edited, edited.ids.bca, 405_000), reason: "Dibayar dari BCA" });
    expect(res.status).toBe(201);

    await direct.post("/api/expenses", expense(direct, direct.ids.bca, 405_000));

    expect(await edited.books()).toEqual(await direct.books());
    expect(res.body).toMatchObject({ number: `${original.body.number}/R1`, amount: 405_000, revisionOf: { id: original.body.id } });
    expect(await edited.get(`/api/expenses/${original.body.id}`)).toMatchObject({
      voidReason: "Diubah: Dibayar dari BCA",
      revisedBy: { id: res.body.id },
    });
    expect(await edited.auditCount(["expense.edit"])).toBe(1);
  });
});

describe("Ubah tukar faktur", { timeout: 30_000 }, () => {
  it("voids the bundle, frees its invoices and records the corrected one", async () => {
    const s = await shop();
    const first = await s.post("/api/sales", invoice(s, [...before]));
    const second = await s.post("/api/sales", invoice(s, [...after]));
    const bundle = await s.post("/api/invoice-bundles", { customerId: s.ids.customer, date: today, note: "", invoiceIds: [first.body.id] });
    const res = await s.post(`/api/invoice-bundles/${bundle.body.id}/edit`, {
      customerId: s.ids.customer,
      date: today,
      note: "Tambah faktur",
      invoiceIds: [first.body.id, second.body.id],
      reason: "Lupa satu faktur",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ number: `${bundle.body.number}/R1`, revisionOf: { id: bundle.body.id } });
    expect(res.body.invoices).toHaveLength(2);
    const old = await s.get(`/api/invoice-bundles/${bundle.body.id}`);
    expect(old).toMatchObject({ voidReason: "Diubah: Lupa satu faktur", revisedBy: { id: res.body.id } });
    expect(old.voidedAt).not.toBeNull();
  });
});
