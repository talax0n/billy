import { uuidv7 } from "@billy/core";
import { accounts, cashEntries, contacts, posLines, posSales, products, settings, stockMovements } from "@billy/db";
import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { call, signIn, db, shiftFor } = await createTestApp();
let staff: string;
let admin: string;
let kasir: string;
let kasirId: string;
let otherKasir: string;
let cashAccount: string;
let enamel: string;
let thinner: string;

async function createProduct(code: string, name: string, sellPrice: number, costPrice: number, stock: number) {
  const res = await call("/api/products", {
    method: "POST",
    cookie: staff,
    body: { code, barcode: `899${code}`, name, variant: "1 L", unit: "kaleng", categoryId: null, sellPrice, costPrice, minStock: 2 },
  });
  const { id } = (await res.json()) as { id: string };
  await call(`/api/products/${id}/adjustments`, { method: "POST", cookie: staff, body: { qty: stock, note: "Stok awal" } });
  return id;
}

beforeAll(async () => {
  ({ cookie: staff } = await signIn("staff"));
  ({ cookie: admin } = await signIn("admin"));
  const k = await signIn("kasir");
  kasir = k.cookie;
  kasirId = k.user.id;
  ({ cookie: otherKasir } = await signIn("kasir", "kasir2"));
  // These tests cover totals and side effects; the discount cap has its own tests in approvals.test.ts.
  await db.insert(settings).values({ shopName: "Toko Uji", receiptFooter: "Terima kasih", posDeviceCode: "K1", kasirMaxDiscountBp: 10_000 });
  [{ id: cashAccount }] = (await db
    .insert(accounts)
    .values([
      { code: "KAS", name: "Kas Toko", kind: "cash" },
      { code: "OLD", name: "Kas Lama", kind: "cash", active: false },
    ])
    .returning({ id: accounts.id })) as [{ id: string }, { id: string }];
  enamel = await createProduct("KB-1", "Kilau Enamel", 78_000, 61_000, 10);
  thinner = await createProduct("TH-1", "Thinner Super", 32_000, 24_500, 40);
});

/** 2 × 78.000 − 6.000 line discount + 3 × 32.000 = 246.000; 10% off = 24.600 → 221.400. */
const saleBody = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  number: "K1-261113-0001",
  soldAt: "2026-11-13T02:15:00.000Z",
  lines: [
    { productId: enamel, qty: 2, unitPrice: 78_000, discountAmount: 6_000, note: "Kode warna: RAL 7035" },
    { productId: thinner, qty: 3, unitPrice: 32_000 },
  ],
  discount: { kind: "percent", value: 1_000 },
  method: "cash",
  accountId: cashAccount,
  tendered: 250_000,
  total: 221_400,
  ...overrides,
});

const post = async (cookie: string, body: object) => call("/api/pos/sales", { method: "POST", cookie, body: { shiftId: await shiftFor(cookie), ...body } });

const sideEffects = async (saleId: string) => ({
  lines: await db
    .select({ position: posLines.position, qty: posLines.qty, unitPrice: posLines.unitPrice, discountAmount: posLines.discountAmount, lineTotal: posLines.lineTotal, unitCost: posLines.unitCost, note: posLines.note })
    .from(posLines)
    .where(eq(posLines.saleId, saleId))
    .orderBy(asc(posLines.position)),
  movements: await db
    .select({ productId: stockMovements.productId, qty: stockMovements.qty, reason: stockMovements.reason, unitCost: stockMovements.unitCost, date: stockMovements.date })
    .from(stockMovements)
    .where(eq(stockMovements.sourceId, saleId))
    .orderBy(asc(stockMovements.createdAt), asc(stockMovements.qty)),
  cash: await db
    .select({ accountId: cashEntries.accountId, direction: cashEntries.direction, amount: cashEntries.amount, category: cashEntries.category, sourceType: cashEntries.sourceType, date: cashEntries.date })
    .from(cashEntries)
    .where(eq(cashEntries.sourceId, saleId))
    .orderBy(asc(cashEntries.createdAt)),
});

describe("POST /api/pos/sales", () => {
  let body: ReturnType<typeof saleBody>;
  beforeAll(() => {
    body = saleBody();
  });

  it("records the sale with server totals, lines, stock out and cash in", async () => {
    const res = await post(kasir, body);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      id: body.id,
      number: "K1-261113-0001",
      deviceCode: "K1",
      date: "2026-11-13",
      cashierId: kasirId,
      cashierName: "Uji kasir",
      accountName: "Kas Toko",
      subtotal: 246_000,
      discountKind: "percent",
      discountValue: 1_000,
      discountAmount: 24_600,
      total: 221_400,
      tendered: 250_000,
      change: 28_600,
      voidedAt: null,
    });

    expect(await sideEffects(body.id)).toEqual({
      lines: [
        { position: 0, qty: 2, unitPrice: 78_000, discountAmount: 6_000, lineTotal: 150_000, unitCost: 61_000, note: "Kode warna: RAL 7035" },
        { position: 1, qty: 3, unitPrice: 32_000, discountAmount: 0, lineTotal: 96_000, unitCost: 24_500, note: "" },
      ],
      movements: [
        { productId: thinner, qty: -3, reason: "pos", unitCost: 24_500, date: "2026-11-13" },
        { productId: enamel, qty: -2, reason: "pos", unitCost: 61_000, date: "2026-11-13" },
      ],
      cash: [{ accountId: cashAccount, direction: "in", amount: 221_400, category: "sale", sourceType: "pos_sale", date: "2026-11-13" }],
    });
  });

  it("replays an already stored id with 200 and writes nothing twice", async () => {
    const res = await post(kasir, { ...body, total: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: body.id, total: 221_400 });
    const effects = await sideEffects(body.id);
    expect([effects.lines.length, effects.movements.length, effects.cash.length]).toEqual([2, 2, 1]);
    expect(await db.select().from(posSales)).toHaveLength(1);
  });

  it("refuses a receipt number already used by another sale with 409", async () => {
    const res = await post(kasir, saleBody());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Nomor struk K1-261113-0001 sudah dipakai transaksi lain" });
  });

  it("refuses a total that disagrees with the server with 422", async () => {
    const res = await post(kasir, saleBody({ number: "K1-261113-0002", total: 221_000 }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Total struk Rp 221.000 tidak sama dengan hitungan server Rp 221.400" });
  });

  it("accepts a sale made at a stale price and stores the price actually charged", async () => {
    const stale = saleBody({
      number: "K1-261113-0005",
      lines: [{ productId: thinner, qty: 2, unitPrice: 30_000 }],
      discount: { kind: "none", value: 0 },
      tendered: 60_000,
      total: 60_000,
    });
    expect((await post(kasir, stale)).status).toBe(201);
    const effects = await sideEffects(stale.id);
    expect(effects.lines.map(({ unitPrice, lineTotal, unitCost }) => ({ unitPrice, lineTotal, unitCost }))).toEqual([
      { unitPrice: 30_000, lineTotal: 60_000, unitCost: 24_500 },
    ]);
    expect(effects.cash.map(({ amount }) => amount)).toEqual([60_000]);
  });

  it("stores the customer picked with F3 and refuses one that is not a customer", async () => {
    const [customer, supplier] = (await db
      .insert(contacts)
      .values([
        { code: "P-001", name: "CV Bangun Jaya", kind: "customer" },
        { code: "S-001", name: "PT Pemasok", kind: "supplier" },
      ])
      .returning({ id: contacts.id })) as [{ id: string }, { id: string }];
    const sale = saleBody({ number: "K1-261113-0007", customerId: customer.id });
    expect((await post(kasir, sale)).status).toBe(201);
    const [stored] = await db.select({ customerId: posSales.customerId }).from(posSales).where(eq(posSales.id, sale.id));
    expect(stored).toEqual({ customerId: customer.id });

    const wrong = await post(kasir, saleBody({ number: "K1-261113-0008", customerId: supplier.id }));
    expect([wrong.status, await wrong.json()]).toEqual([422, { error: "Pelanggan tidak ditemukan" }]);
  });

  it("refuses an inactive product with 422", async () => {
    const retired = await createProduct("OLD-1", "Cat Lama", 50_000, 40_000, 5);
    await db.update(products).set({ active: false }).where(eq(products.id, retired));
    const res = await post(
      kasir,
      saleBody({ number: "K1-261113-0006", lines: [{ productId: retired, qty: 1, unitPrice: 50_000 }], discount: { kind: "none", value: 0 }, total: 50_000 }),
    );
    expect([res.status, await res.json()]).toEqual([422, { error: "Produk di struk tidak ditemukan atau nonaktif" }]);
  });

  it("refuses short cash, an inactive account and invalid input", async () => {
    const short = await post(kasir, saleBody({ number: "K1-261113-0002", tendered: 200_000 }));
    expect([short.status, await short.json()]).toEqual([422, { error: "Uang diterima kurang dari total" }]);

    const [inactive] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.code, "OLD"));
    const old = await post(kasir, saleBody({ number: "K1-261113-0002", accountId: inactive!.id }));
    expect([old.status, await old.json()]).toEqual([422, { error: "Akun pembayaran tidak ditemukan atau nonaktif" }]);

    const bad = await post(kasir, saleBody({ number: "K1-1", lines: [] }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({
      error: "Periksa kembali isian",
      fields: { number: "Nomor struk tidak valid", lines: "Minimal satu barang" },
    });
  });

  it("writes no cash entry for a fully discounted sale", async () => {
    const free = saleBody({ number: "K1-261113-0003", discount: { kind: "percent", value: 10_000 }, total: 0, tendered: 0 });
    expect((await post(staff, free)).status).toBe(201);
    const effects = await sideEffects(free.id);
    expect([effects.movements.length, effects.cash]).toEqual([2, []]);
  });
});

describe("history, reprint and void", () => {
  let own: ReturnType<typeof saleBody>;
  let other: ReturnType<typeof saleBody>;

  beforeAll(async () => {
    own = saleBody({ number: "K1-261113-0010", method: "qris", tendered: 221_400 });
    other = saleBody({ number: "K1-261113-0011" });
    await post(kasir, own);
    await post(otherKasir, other);
  });

  it("shows a kasir only their own sales", async () => {
    const mine = (await (await call("/api/pos/sales?q=K1-261113-001", { cookie: kasir })).json()) as { total: number; rows: { number: string }[] };
    expect(mine).toMatchObject({ total: 1, rows: [{ number: "K1-261113-0010" }] });

    const forbidden = await call(`/api/pos/sales/${other.id}`, { cookie: kasir });
    expect(forbidden.status).toBe(404);

    const all = (await (await call("/api/pos/sales?q=K1-261113-001", { cookie: staff })).json()) as { total: number };
    expect(all.total).toBe(2);
  });

  it("answers a kasir replaying another cashier's sale id with 404, like GET", async () => {
    const res = await post(kasir, other);
    expect([res.status, await res.json()]).toEqual([404, { error: "Struk tidak ditemukan" }]);
  });

  it("never shows the cost price to a kasir", async () => {
    const fresh = saleBody({ number: "K1-261113-0012" });
    const created = (await (await post(kasir, fresh)).json()) as { lines: object[] };
    const replayed = (await (await post(kasir, fresh)).json()) as { lines: object[] };
    const fetched = (await (await call(`/api/pos/sales/${fresh.id}`, { cookie: kasir })).json()) as { lines: object[] };
    expect([created, replayed, fetched].flatMap((sale) => sale.lines.map((line) => "unitCost" in line))).toEqual([
      false, false, false, false, false, false,
    ]);
    await call(`/api/pos/sales/${fresh.id}/void`, { method: "POST", cookie: admin, body: { reason: "Uji" } });
  });

  it("returns a sale with its lines for reprint", async () => {
    const res = await call(`/api/pos/sales/${own.id}`, { cookie: kasir });
    expect(await res.json()).toMatchObject({
      number: "K1-261113-0010",
      method: "qris",
      change: 0,
      lines: [
        { productName: "Kilau Enamel", variant: "1 L", unit: "kaleng", qty: 2, lineTotal: 150_000, note: "Kode warna: RAL 7035" },
        { productName: "Thinner Super", qty: 3, lineTotal: 96_000 },
      ],
    });
  });

  it("refuses a kasir's or staff's void without an admin's approval", async () => {
    for (const cookie of [kasir, staff]) {
      const res = await call(`/api/pos/sales/${own.id}/void`, { method: "POST", cookie, body: { reason: "Salah input" } });
      expect([res.status, await res.json()]).toEqual([
        403,
        { error: "Void struk kasir butuh persetujuan admin. Minta persetujuan admin.", approval: { kind: "void" } },
      ]);
    }
    const foreign = await call(`/api/pos/sales/${other.id}/void`, { method: "POST", cookie: kasir, body: { reason: "Salah input" } });
    expect(foreign.status).toBe(404);
  });

  it("voids with reversal stock movements and a reversal cash entry, once", async () => {
    const res = await call(`/api/pos/sales/${own.id}/void`, { method: "POST", cookie: admin, body: { reason: "Salah input" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ voidReason: "Salah input", voidedAt: expect.any(String) });

    const effects = await sideEffects(own.id);
    expect(effects.movements.filter((m) => m.reason === "reversal").map(({ productId, qty, unitCost }) => ({ productId, qty, unitCost }))).toEqual(
      expect.arrayContaining([
        { productId: enamel, qty: 2, unitCost: 61_000 },
        { productId: thinner, qty: 3, unitCost: 24_500 },
      ]),
    );
    expect(effects.cash.map(({ direction, amount, category }) => ({ direction, amount, category }))).toEqual([
      { direction: "in", amount: 221_400, category: "sale" },
      { direction: "out", amount: 221_400, category: "reversal" },
    ]);

    const again = await call(`/api/pos/sales/${own.id}/void`, { method: "POST", cookie: admin, body: { reason: "Lagi" } });
    expect([again.status, await again.json()]).toEqual([409, { error: "Struk sudah di-void" }]);
  });
});

describe("sales queued offline by another cashier", () => {
  const voidAll = (ids: string[]) =>
    Promise.all(ids.map((id) => call(`/api/pos/sales/${id}/void`, { method: "POST", cookie: admin, body: { reason: "Uji" } })));

  it("records a sale uploaded by staff under the cashier who made it", async () => {
    const queued = saleBody({ number: "K1-261113-0020", cashierId: kasirId, shiftId: await shiftFor(kasir) });
    const res = await post(staff, queued);
    expect([res.status, ((await res.json()) as { cashierId: string }).cashierId]).toEqual([201, kasirId]);
    await voidAll([queued.id]);
  });

  it("refuses an unknown cashier id from staff with 422", async () => {
    const res = await post(staff, saleBody({ number: "K1-261113-0021", cashierId: "01a1d234-3800-7000-8000-000000000000" }));
    expect([res.status, await res.json()]).toEqual([422, { error: "Kasir tidak ditemukan" }]);
  });

  it("records a kasir's own sale under them and refuses another cashier's sale from a kasir", async () => {
    const own = saleBody({ number: "K1-261113-0022", cashierId: kasirId });
    const res = await post(kasir, own);
    expect([res.status, ((await res.json()) as { cashierId: string }).cashierId]).toEqual([201, kasirId]);
    await voidAll([own.id]);

    const foreign = await post(otherKasir, saleBody({ number: "K1-261113-0023", cashierId: kasirId }));
    expect([foreign.status, await foreign.json()]).toEqual([
      422,
      { error: "Transaksi ini milik kasir lain. Kirim dari akun kasir itu atau akun admin." },
    ]);
  });
});

describe("GET /api/pos/catalog", () => {
  it("returns sellable products with stock but no cost, accounts, shop and the last number today", async () => {
    await db.update(settings).set({ posDeviceCode: "K9" });
    const today = new Date();
    const period = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "2-digit", month: "2-digit", day: "2-digit" })
      .format(today)
      .replaceAll("-", "");
    await post(kasir, saleBody({ number: `K9-${period}-0007`, soldAt: today.toISOString() }));

    const res = await call("/api/pos/catalog", { cookie: kasir });
    const body = (await res.json()) as Record<string, unknown> & { products: Record<string, unknown>[] };
    expect(body.products[0]).toEqual({
      id: enamel,
      code: "KB-1",
      barcode: "899KB-1",
      name: "Kilau Enamel",
      variant: "1 L",
      unit: "kaleng",
      categoryName: null,
      sellPrice: 78_000,
      minStock: 2,
      // 10 opening − 2 × 6 sales + 2 back from the void
      stock: 0,
    });
    expect(body).toMatchObject({
      accounts: [{ id: cashAccount, name: "Kas Toko", kind: "cash" }],
      customers: [{ id: expect.any(String), code: "P-001", name: "CV Bangun Jaya" }],
      shop: { shopName: "Toko Uji", receiptFooter: "Terima kasih", deviceCode: "K9" },
      lastNumber: `K9-${period}-0007`,
      limits: { kasirMaxDiscountBp: 10_000, allowBelowCost: false },
    });
  });

  it("requires a session", async () => {
    expect((await call("/api/pos/catalog")).status).toBe(401);
  });
});
