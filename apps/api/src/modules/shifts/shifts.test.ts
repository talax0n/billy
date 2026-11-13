import { businessDate, uuidv7 } from "@billy/core";
import { accounts, auditEvents, cashShifts, settings } from "@billy/db";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { call, signIn, db } = await createTestApp();
let admin: string;
let staff: string;
let kasir: string;
let kasirId: string;
let kas: string;
let bca: string;
let product: string;
let n = 0;

beforeAll(async () => {
  ({ cookie: admin } = await signIn("admin"));
  ({ cookie: staff } = await signIn("staff"));
  ({ cookie: kasir, user: { id: kasirId } } = await signIn("kasir"));
  await db.insert(settings).values({ shopName: "Toko Uji", receiptFooter: "", posDeviceCode: "K1" });
  [{ id: kas }, { id: bca }] = (await db
    .insert(accounts)
    .values([
      { code: "KAS", name: "Kas Toko", kind: "cash" },
      { code: "BCA", name: "Bank BCA", kind: "bank" },
    ])
    .returning({ id: accounts.id })) as [{ id: string }, { id: string }];
  const res = await call("/api/products", {
    method: "POST",
    cookie: staff,
    body: { code: "P1", barcode: null, name: "Cat", variant: "", unit: "kaleng", categoryId: null, sellPrice: 10_000, costPrice: 5_000, minStock: 0 },
  });
  product = ((await res.json()) as { id: string }).id;
  await call(`/api/products/${product}/adjustments`, { method: "POST", cookie: staff, body: { qty: 500, note: "Stok awal" } });
});

const json = async (res: Response) => [res.status, await res.json()] as const;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const openBody = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  deviceCode: "K1",
  accountId: kas,
  openedAt: minutesAgo(1),
  openingFloat: 200_000,
  ...overrides,
});
const open = (cookie: string, body: object) => call("/api/pos/shifts", { method: "POST", cookie, body });
const close = (cookie: string, id: string, countedCash: number, note = "") =>
  call(`/api/pos/shifts/${id}/close`, { method: "POST", cookie, body: { closedAt: new Date().toISOString(), countedCash, note } });

/** `qty` × Rp 10.000, paid in full. */
const sale = (shiftId: string | undefined, qty: number, method = "cash", accountId = kas) => ({
  id: uuidv7(),
  number: `K1-261113-${String(++n).padStart(4, "0")}`,
  soldAt: new Date().toISOString(),
  ...(shiftId && { shiftId }),
  lines: [{ productId: product, qty, unitPrice: 10_000 }],
  discount: { kind: "none", value: 0 },
  method,
  accountId,
  tendered: qty * 10_000,
  total: qty * 10_000,
});
const sell = (cookie: string, body: object) => call("/api/pos/sales", { method: "POST", cookie, body });
const stored = async (id: string) => (await db.select().from(cashShifts).where(eq(cashShifts.id, id)))[0]!;
const events = (id: string, action: string) => db.select().from(auditEvents).where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, action)));

describe("a Kasir sale needs an open shift", () => {
  it("refuses a sale without a shift, with someone else's shift, or with a closed one", async () => {
    expect(await json(await sell(kasir, sale(undefined, 1)))).toEqual([
      400,
      { error: "Periksa kembali isian", fields: { shiftId: "Buka shift dulu sebelum berjualan" } },
    ]);
    expect(await json(await sell(kasir, sale(uuidv7(), 1)))).toEqual([422, { error: "Shift kasir tidak ditemukan. Buka shift dulu sebelum berjualan." }]);

    const adminShift = openBody();
    expect((await open(admin, adminShift)).status).toBe(201);
    expect((await sell(kasir, sale(adminShift.id, 1))).status).toBe(422);

    expect((await close(admin, adminShift.id, 200_000)).status).toBe(200);
    expect(await json(await sell(admin, sale(adminShift.id, 1)))).toEqual([409, { error: "Shift untuk transaksi ini sudah ditutup" }]);
  });
});

describe("opening and closing replayed from the outbox", () => {
  it("records an open once, refuses a second open shift on the device, and closes once", async () => {
    const body = openBody({ openingFloat: 150_000 });
    expect(await json(await open(kasir, body))).toEqual([
      201,
      { id: body.id, deviceCode: "K1", accountId: kas, openedAt: expect.any(String), openingFloat: 150_000 },
    ]);
    expect((await open(kasir, body)).status).toBe(200);
    expect(await json(await open(kasir, openBody()))).toEqual([409, { error: "Masih ada shift terbuka di K1. Tutup shift itu dulu." }]);
    expect((await open(kasir, openBody({ deviceCode: "K2" }))).status).toBe(201);

    const first = await json(await close(kasir, body.id, 150_000));
    const replay = await json(await close(kasir, body.id, 1));
    expect(replay).toEqual(first);
    expect((await stored(body.id)).countedCash).toBe(150_000);
    expect(await events(body.id, "shift.open")).toHaveLength(1);
    expect(await events(body.id, "shift.close")).toHaveLength(1);
  });

  it("lets staff upload a kasir's queued open under that kasir, and logs a late one as offline", async () => {
    const queued = openBody({ deviceCode: "K3", cashierId: kasirId, openedAt: minutesAgo(60) });
    expect((await open(staff, queued)).status).toBe(201);
    expect((await stored(queued.id)).cashierId).toBe(kasirId);
    expect((await events(queued.id, "shift.open"))[0]).toMatchObject({ source: "kasir_offline", summary: "Buka shift K3 · modal Rp 200.000" });
  });
});

describe("the blind cash count", () => {
  it("computes the expected cash on the server and tells the kasir only that the shift closed", async () => {
    const shift = openBody({ deviceCode: "K4", openingFloat: 100_000 });
    await open(kasir, shift);
    expect((await sell(kasir, sale(shift.id, 3))).status).toBe(201);

    const current = await json(await call("/api/pos/shifts/current?deviceCode=K4", { cookie: kasir }));
    expect(current).toEqual([200, { shift: { id: shift.id, deviceCode: "K4", accountId: kas, openedAt: expect.any(String), openingFloat: 100_000 } }]);

    const [status, body] = await json(await close(kasir, shift.id, 125_000, "Uang kurang"));
    expect([status, Object.keys(body as object).sort()]).toEqual([200, ["closedAt", "id"]]);
    expect(await stored(shift.id)).toMatchObject({ expectedCash: 130_000, countedCash: 125_000, difference: -5_000, closeNote: "Uang kurang" });
    expect(await json(await call("/api/pos/shifts/current?deviceCode=K4", { cookie: kasir }))).toEqual([200, { shift: null }]);
  });

  it("adds cash sales and cash moved in, takes off cash voids and cash moved out, ignores QRIS and other accounts", async () => {
    const date = businessDate();
    const kasirShift = openBody({ deviceCode: "K5", openingFloat: 50_000 });
    const adminShift = openBody({ deviceCode: "K5", openingFloat: 200_000 });
    await open(kasir, kasirShift);
    await open(admin, adminShift);

    // Sold in the kasir's shift, voided later by admin at the counter: the refund leaves admin's drawer.
    const voided = sale(kasirShift.id, 8);
    expect((await sell(kasir, voided)).status).toBe(201);
    await close(kasir, kasirShift.id, 130_000);
    expect(await stored(kasirShift.id)).toMatchObject({ expectedCash: 130_000, difference: 0 });
    expect((await call(`/api/pos/sales/${voided.id}/void`, { method: "POST", cookie: admin, body: { reason: "Batal" } })).status).toBe(200);

    expect((await sell(admin, sale(adminShift.id, 10))).status).toBe(201);
    expect((await sell(admin, sale(adminShift.id, 5, "qris", bca))).status).toBe(201);
    const qrisVoided = sale(adminShift.id, 2, "qris", bca);
    await sell(admin, qrisVoided);
    await call(`/api/pos/sales/${qrisVoided.id}/void`, { method: "POST", cookie: admin, body: { reason: "Batal" } });
    const entry = (accountId: string, direction: string, amount: number) =>
      call("/api/cash/entries", { method: "POST", cookie: staff, body: { accountId, date, direction, amount, note: "Uji" } });
    await entry(kas, "in", 50_000);
    await entry(kas, "out", 30_000);
    await entry(bca, "out", 99_000);

    // 200.000 float + 100.000 cash sales − 80.000 voided + 50.000 in − 30.000 out = 240.000.
    expect((await close(admin, adminShift.id, 220_000)).status).toBe(200);
    expect(await stored(adminShift.id)).toMatchObject({ expectedCash: 240_000, countedCash: 220_000, difference: -20_000 });
    const [closed] = await events(adminShift.id, "shift.close");
    expect(closed).toMatchObject({
      summary: "Tutup shift K5 · selisih −Rp 20.000",
      after: expect.objectContaining({ cashSales: 100_000, cashVoids: 80_000, cashMoved: 20_000, expectedCash: 240_000, countedCash: 220_000, difference: -20_000 }),
    });
  });
});

describe("the Shift report", () => {
  it("is admin only, with the expected and counted cash and the difference", async () => {
    expect((await call("/api/shifts", { cookie: kasir })).status).toBe(403);
    expect((await call("/api/shifts", { cookie: staff })).status).toBe(403);
    const report = (await (await call(`/api/shifts?cashierId=${kasirId}&from=${businessDate()}`, { cookie: admin })).json()) as {
      rows: { cashierId: string; deviceCode: string; expectedCash: number | null; difference: number | null }[];
    };
    expect(report.rows.every((r) => r.cashierId === kasirId)).toBe(true);
    expect(report.rows.find((r) => r.deviceCode === "K4")).toMatchObject({ expectedCash: 130_000, difference: -5_000 });
  });
});
