import { type AuditAction, businessDate, rupiah, uuidv7 } from "@billy/core";
import { accounts, auditEvents, contacts, settings } from "@billy/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { systemActor } from "../../lib/audit.ts";
import { createTestApp } from "../../testing.ts";
import { createExpense } from "../expenses/service.ts";

const { call, signIn, db, shiftFor } = await createTestApp();
let admin: string;
let adminId: string;
let staff: string;
let staffId: string;
let kasir: string;
let account: string;
let bank: string;
let customer: string;
let supplier: string;
let product: string;
const today = businessDate();

type Json = Record<string, any>;
const send = async (cookie: string, path: string, body?: object, method = "POST") => {
  const res = await call(path, { method, cookie, ...(body && { body }) });
  const json = (await res.json()) as Json;
  expect(res.status, `${method} ${path}: ${JSON.stringify(json)}`).toBeLessThan(300);
  return json;
};
const eventsOf = (action: AuditAction) => db.select().from(auditEvents).where(eq(auditEvents.action, action));

beforeAll(async () => {
  ({ cookie: admin, user: { id: adminId } } = await signIn("admin"));
  ({ cookie: staff, user: { id: staffId } } = await signIn("staff"));
  ({ cookie: kasir } = await signIn("kasir"));
  await db.insert(settings).values({ shopName: "Toko Uji", receiptFooter: "", posDeviceCode: "K1" });
  [{ id: account }, { id: bank }] = (await db
    .insert(accounts)
    .values([
      { code: "KAS", name: "Kas Toko", kind: "cash" },
      { code: "BCA", name: "BCA", kind: "bank" },
    ])
    .returning({ id: accounts.id })) as [{ id: string }, { id: string }];
  [{ id: customer }, { id: supplier }] = (await db
    .insert(contacts)
    .values([
      { code: "P-001", name: "CV Bangun Jaya", kind: "customer" },
      { code: "S-001", name: "PT Pemasok", kind: "supplier" },
    ])
    .returning({ id: contacts.id })) as [{ id: string }, { id: string }];
});

describe("every data-changing action writes one audit event", () => {
  it("logs logins, failed logins and logouts", async () => {
    await call("/api/auth/login", { method: "POST", body: { username: "staff", password: "salah-sekali" } });
    await call("/api/auth/login", { method: "POST", body: { username: "tidakada", password: "salah-sekali" } });
    const { cookie } = await signIn("staff", "pergi");
    await call("/api/auth/logout", { method: "POST", cookie });

    expect((await eventsOf("auth.login_failed")).map(({ actorId, entityId, summary }) => ({ actorId, entityId, summary }))).toEqual([
      { actorId: staffId, entityId: staffId, summary: "Gagal masuk sebagai staff" },
      { actorId: null, entityId: "tidakada", summary: "Gagal masuk sebagai tidakada" },
    ]);
    expect((await eventsOf("auth.login")).length).toBeGreaterThanOrEqual(4);
    expect(await eventsOf("auth.logout")).toEqual([expect.objectContaining({ summary: "Uji staff keluar", source: "web" })]);
  });

  it("logs users and roles without passwords", async () => {
    const user = await send(admin, "/api/users", { username: "budi", name: "Budi", role: "kasir", password: "rahasia123" });
    await send(admin, `/api/users/${user.id}`, { name: "Budi", role: "staff", active: true, password: "rahasia456" }, "PUT");
    const [updated] = await eventsOf("user.update");
    expect(updated).toMatchObject({
      actorId: adminId,
      summary: "Pengguna budi diubah: peran Staf",
      before: { role: "kasir", passwordChanged: false },
      after: { role: "staff", passwordChanged: true },
    });
    expect(JSON.stringify(await eventsOf("user.create"))).not.toContain("rahasia");
  });

  it("logs settings with only the changed fields", async () => {
    await send(admin, "/api/settings", { shopName: "Toko Uji Baru", receiptFooter: "", posDeviceCode: "K1" }, "PUT");
    const [event] = await eventsOf("settings.update");
    expect(event).toMatchObject({ before: { shopName: "Toko Uji" }, after: { shopName: "Toko Uji Baru" } });
  });

  it("logs products, a price and cost change with old and new values, and stock adjustments", async () => {
    const body = { code: "KB-1", barcode: null, name: "Kilau Enamel", variant: "1 L", unit: "kaleng", categoryId: null, sellPrice: 78_000, costPrice: 61_000, minStock: 2 };
    product = (await send(staff, "/api/products", body)).id;
    await send(staff, `/api/products/${product}`, { ...body, sellPrice: 80_000, costPrice: 62_000 }, "PUT");
    await send(staff, `/api/products/${product}/adjustments`, { qty: 50, note: "Stok awal" });

    expect(await eventsOf("product.create")).toEqual([expect.objectContaining({ actorId: staffId, entityId: product, summary: "Produk Kilau Enamel 1 L" })]);
    expect(await eventsOf("product.update")).toEqual([
      expect.objectContaining({
        summary: "Harga Kilau Enamel 1 L diubah",
        before: { sellPrice: 78_000, costPrice: 61_000 },
        after: { sellPrice: 80_000, costPrice: 62_000 },
      }),
    ]);
    expect(await eventsOf("stock.adjust")).toEqual([
      expect.objectContaining({ summary: "Stok Kilau Enamel 1 L +50", before: { stock: 0 }, reason: "Stok awal" }),
    ]);
  });

  it("logs categories, contacts and accounts", async () => {
    const category = await send(staff, "/api/categories", { name: "Cat Kayu", description: "" });
    await send(staff, `/api/categories/${category.id}`, { name: "Cat Kayu & Besi", description: "" }, "PUT");
    const contact = await send(staff, "/api/contacts", { code: "P-002", name: "Toko Maju", kind: "customer" });
    await send(staff, `/api/contacts/${contact.id}`, { code: "P-002", name: "Toko Maju Jaya", kind: "customer" }, "PUT");
    const created = await send(staff, "/api/accounts", { code: "BRI", name: "BRI", kind: "bank" });
    await send(staff, `/api/accounts/${created.id}`, { code: "BRI", name: "BRI", kind: "bank", active: false }, "PUT");

    for (const action of ["category.create", "category.update", "contact.create", "contact.update", "account.create", "account.update"] as const) {
      expect(await eventsOf(action), action).toHaveLength(1);
    }
    expect((await eventsOf("account.update"))[0]).toMatchObject({ before: { active: true }, after: { active: false } });
  });

  it("logs cash entries, transfers and their voids, expenses and their voids", async () => {
    await send(staff, "/api/cash/entries", { accountId: account, date: today, direction: "in", amount: 500_000, note: "Modal" });
    const transfer = await send(staff, "/api/cash/transfers", { date: today, fromAccountId: account, toAccountId: bank, amount: 100_000, note: "" });
    await send(staff, `/api/cash/transfers/${transfer.id}/void`, { reason: "Salah akun" });
    const expense = await send(staff, "/api/expenses", { date: today, accountId: account, category: "Listrik", amount: 50_000 });
    await send(staff, `/api/expenses/${expense.id}/void`, { reason: "Dobel" });

    expect((await eventsOf("cash.entry.create"))[0]).toMatchObject({ summary: "Uang masuk Rp 500.000: Modal" });
    expect((await eventsOf("cash.transfer.create"))[0]).toMatchObject({ summary: "Transfer Rp 100.000" });
    expect((await eventsOf("cash.transfer.void"))[0]).toMatchObject({ reason: "Salah akun", entityId: transfer.id });
    expect((await eventsOf("expense.create"))[0]).toMatchObject({ summary: `Biaya ${expense.number} Listrik Rp 50.000` });
    expect((await eventsOf("expense.void"))[0]).toMatchObject({ reason: "Dobel" });
  });

  it("logs purchases with the cost they set, their payments and voids", async () => {
    const purchase = await send(staff, "/api/purchases", {
      supplierId: supplier,
      date: today,
      termsDays: 0,
      discountKind: "none",
      discountValue: 0,
      taxRateBp: 0,
      lines: [{ productId: product, qty: 10, unitCost: 65_000, discountAmount: 0 }],
      payment: { accountId: account, date: today, amount: 100_000, method: "cash" },
    });
    const [payment] = purchase.payments as Json[];
    await send(staff, `/api/purchases/${purchase.id}/payments/${payment!.id}/void`, { reason: "Salah nominal" });
    await send(staff, `/api/purchases/${purchase.id}/void`, { reason: "Retur" });

    expect((await eventsOf("purchase.invoice.create"))[0]).toMatchObject({
      before: { costPrice: { [product]: 62_000 } },
      after: { total: 650_000, costPrice: { [product]: 65_000 } },
    });
    expect(await eventsOf("purchase.payment.create")).toHaveLength(1);
    expect((await eventsOf("purchase.payment.void"))[0]).toMatchObject({ reason: "Salah nominal" });
    // No other purchase of the product remains, so its cost stays at 65.000 (rule 8) and the void logs no cost change.
    const [voided] = await eventsOf("purchase.invoice.void");
    expect(voided).toMatchObject({ before: { voidedAt: null }, reason: "Retur" });
    expect(voided!.after).not.toHaveProperty("costPrice");
  });

  it("logs sales invoices, their payments, voids and tukar faktur", async () => {
    const invoice = await send(staff, "/api/sales", {
      customerId: customer,
      date: today,
      termsDays: 30,
      discountKind: "none",
      discountValue: 0,
      lines: [{ productId: product, qty: 1, unitPrice: 80_000 }],
    });
    const bundle = await send(staff, "/api/invoice-bundles", { customerId: customer, date: today, invoiceIds: [invoice.id] });
    await send(staff, `/api/invoice-bundles/${bundle.id}/void`);
    const paid = await send(staff, `/api/sales/${invoice.id}/payments`, { accountId: account, date: today, amount: 80_000, method: "cash" });
    await send(staff, `/api/sales/${invoice.id}/payments/${(paid.payments as Json[])[0]!.id}/void`, { reason: "Cek kosong" });
    await send(staff, `/api/sales/${invoice.id}/void`, { reason: "Batal" });

    expect((await eventsOf("sales.invoice.create"))[0]).toMatchObject({ summary: `Faktur ${invoice.number} Rp 80.000`, approvalId: null });
    for (const action of ["sales.payment.create", "sales.payment.void", "sales.invoice.void", "invoice_bundle.create", "invoice_bundle.void"] as const) {
      expect(await eventsOf(action), action).toHaveLength(1);
    }
  });

  it("logs a Kasir sale as kasir, and one synced long after it was made as kasir_offline", async () => {
    const shiftId = await shiftFor(kasir);
    const sale = (soldAt: Date, number: string) => ({
      id: uuidv7(),
      shiftId,
      number,
      soldAt: soldAt.toISOString(),
      lines: [{ productId: product, qty: 1, unitPrice: 80_000 }],
      discount: { kind: "none", value: 0 },
      method: "cash",
      accountId: account,
      tendered: 80_000,
      total: 80_000,
    });
    const online = sale(new Date(), "K1-261113-0001");
    const offline = sale(new Date(Date.now() - 60 * 60_000), "K1-261113-0002");
    await send(kasir, "/api/pos/sales", online);
    await send(kasir, "/api/pos/sales", offline);
    const sources = new Map((await eventsOf("pos.sale.create")).map((e) => [e.entityId, e]));
    expect(sources.get(online.id)).toMatchObject({ source: "kasir", deviceCode: "K1" });
    expect(sources.get(offline.id)).toMatchObject({ source: "kasir_offline", after: expect.objectContaining({ soldAt: offline.soldAt }) });
  });

  it("logs a script's work as source system", async () => {
    const expense = await createExpense(
      db,
      { date: today, accountId: account, category: "Lain-lain", description: "Impor", amount: rupiah(1_000), proofUrl: null },
      systemActor(adminId),
    );
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.entityId, expense.id));
    expect(event).toMatchObject({ source: "system", actorId: adminId, actorRole: "admin" });
  });

  it("rolls the change back when its audit row cannot be written", async () => {
    const before = (await (await call("/api/products?pageSize=100", { cookie: staff })).json()) as { total: number };
    await db.execute(`create or replace function audit_events_refuse_insert() returns trigger language plpgsql as $$ begin raise exception 'no'; end $$`);
    await db.execute(`create trigger refuse_insert before insert on audit_events for each row execute function audit_events_refuse_insert()`);
    const res = await call("/api/products", {
      method: "POST",
      cookie: staff,
      body: { code: "X-1", barcode: null, name: "Tanpa log", variant: "", unit: "pcs", categoryId: null, sellPrice: 1, costPrice: 1, minStock: 0 },
    });
    await db.execute(`drop trigger refuse_insert on audit_events`);
    expect(res.status).toBe(500);
    const after = (await (await call("/api/products?pageSize=100", { cookie: staff })).json()) as { total: number };
    expect(after.total).toBe(before.total);
  });
});

describe("GET /api/audit (Log Aktivitas)", () => {
  type Page = { total: number; rows: Json[] };
  const list = async (query: string) => (await (await call(`/api/audit?${query}`, { cookie: admin })).json()) as Page;

  it("is admin-only", async () => {
    expect((await call("/api/audit", { cookie: staff })).status).toBe(403);
    expect((await call("/api/audit", { cookie: kasir })).status).toBe(403);
    expect((await call("/api/audit")).status).toBe(401);
  });

  it("filters by person, action, date and words in the summary, newest first, paged", async () => {
    const byStaff = await list(`actorId=${staffId}&pageSize=100`);
    expect(byStaff.rows.every((r) => r.actorId === staffId && r.actorName === "Uji staff")).toBe(true);
    expect(byStaff.rows.map((r) => r.at)).toEqual([...byStaff.rows.map((r) => r.at)].sort().reverse());

    const voids = await list("action=expense.void");
    expect(voids).toMatchObject({ total: 1, rows: [{ action: "expense.void", reason: "Dobel", source: "web" }] });

    expect((await list("q=K1-261113-0002")).rows.map((r) => r.summary)).toEqual(["Penjualan K1-261113-0002 Rp 80.000"]);
    expect((await list(`from=${today}&to=${today}&pageSize=1`)).rows).toHaveLength(1);
    expect((await list("from=2020-01-01&to=2020-01-31")).total).toBe(0);
    expect((await call("/api/audit?action=tidak.ada", { cookie: admin })).status).toBe(400);
  });
});
