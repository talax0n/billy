import { uuidv7 } from "@billy/core";
import { accounts, auditEvents, contacts, deliveries, products, salesInvoices, salesLines, settings } from "@billy/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { call, signIn, db } = await createTestApp();
let staff: string;
let staffId: string;
let kasir: string;
let cashAccount: string;
let enamel: string;
let customer: string;

type Board = {
  deliveries: { id: string; status: string; customerName: string; driverName: string | null; items: string[]; posSaleNumber: string | null; salesInvoiceNumber: string | null; queuedAt: string }[];
  drivers: { id: string; name: string; busy: boolean; turn: number | null }[];
  nextDriverId: string | null;
};
const board = async (cookie = staff) => (await (await call("/api/deliveries", { cookie })).json()) as Board;
const act = (id: string, action: string, body: object = {}, cookie = staff) => call(`/api/deliveries/${id}/${action}`, { method: "POST", cookie, body });
const addDriver = async (name: string) =>
  ((await (await call("/api/deliveries/drivers", { method: "POST", cookie: staff, body: { name } })).json()) as { id: string }).id;
const addDelivery = async (customerName: string, extra: object = {}) => {
  const res = await call("/api/deliveries", { method: "POST", cookie: staff, body: { customerName, address: `Jl. ${customerName} 1`, ...extra } });
  return { res, id: ((await res.clone().json()) as { id: string }).id };
};
const turnOrder = (b: Board) => b.drivers.filter((d) => d.turn).sort((x, y) => x.turn! - y.turn!).map((d) => d.name);
const nextName = (b: Board) => b.drivers.find((d) => d.id === b.nextDriverId)?.name ?? null;

beforeAll(async () => {
  ({ cookie: staff, user: { id: staffId } } = await signIn("staff"));
  ({ cookie: kasir } = await signIn("kasir"));
  await db.insert(settings).values({ shopName: "Toko Uji", posDeviceCode: "K1" });
  [{ id: cashAccount }] = (await db.insert(accounts).values({ code: "KAS", name: "Kas Toko", kind: "cash" }).returning({ id: accounts.id })) as [{ id: string }];
  [{ id: enamel }] = (await db
    .insert(products)
    .values({ name: "Kilau Enamel", variant: "1 L", unit: "kaleng", sellPrice: 78_000 as never, costPrice: 61_000 as never })
    .returning({ id: products.id })) as [{ id: string }];
  [{ id: customer }] = (await db
    .insert(contacts)
    .values({ code: "P-001", name: "CV Bangun Jaya", kind: "customer", address: "Jl. Merdeka 5" })
    .returning({ id: contacts.id })) as [{ id: string }];
});

describe("delivery lifecycle", () => {
  it("moves only along the transition table and keeps the queue place on Kembali ke antrian", async () => {
    const driver = await addDriver("Andi");
    const first = await addDelivery("Bu Sari");
    const second = await addDelivery("Pak Joko");
    expect(first.res.status).toBe(201);

    // waiting → delivered is not allowed
    const skipped = await act(first.id, "deliver");
    expect(skipped.status).toBe(409);
    expect(await skipped.json()).toEqual({ error: 'Tidak bisa "Sudah sampai": antaran ini statusnya menunggu' });
    expect((await act(first.id, "depart", {})).status).toBe(400);

    expect(await (await act(first.id, "depart", { driverId: driver })).json()).toEqual({ id: first.id, status: "on_the_way" });
    expect((await act(first.id, "depart", { driverId: driver })).status).toBe(409);
    expect(await (await act(first.id, "requeue")).json()).toEqual({ id: first.id, status: "waiting" });

    let b = await board();
    expect(b.deliveries.map((d) => [d.customerName, d.status, d.driverName])).toEqual([
      ["Bu Sari", "waiting", null],
      ["Pak Joko", "waiting", null],
    ]);

    await act(first.id, "depart", { driverId: driver });
    expect(await (await act(first.id, "deliver")).json()).toEqual({ id: first.id, status: "delivered" });
    expect((await act(first.id, "cancel", { reason: "Salah alamat" })).status).toBe(409);
    expect((await act(second.id, "cancel", { reason: " " })).status).toBe(400);
    expect(await (await act(second.id, "cancel", { reason: "Pelanggan ambil sendiri" })).json()).toEqual({ id: second.id, status: "cancelled" });

    b = await board();
    expect(b.deliveries.map((d) => [d.customerName, d.status])).toEqual([
      ["Bu Sari", "delivered"],
      ["Pak Joko", "cancelled"],
    ]);
    const actions = await db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.entityId, first.id));
    expect(actions.map((a) => a.action)).toEqual(["delivery.create", "delivery.depart", "delivery.requeue", "delivery.depart", "delivery.deliver"]);
  });

  it("refuses an inactive driver", async () => {
    const driver = await addDriver("Tono");
    await call(`/api/deliveries/drivers/${driver}`, { method: "PUT", cookie: staff, body: { name: "Tono", phone: "", active: false } });
    const { id } = await addDelivery("Bu Rina");
    const res = await act(id, "depart", { driverId: driver });
    expect(res.status).toBe(422);
    await act(id, "cancel", { reason: "Uji" });
  });
});

describe("driver turn order", () => {
  it("suggests the driver back longest, never-delivered first, and skips busy ones", async () => {
    // Andi delivered in the test above; Tono is inactive.
    const budi = await addDriver("Budi");
    const citra = await addDriver("Citra");
    expect(nextName(await board())).toBe("Budi");

    const a = await addDelivery("Satu");
    await act(a.id, "depart", { driverId: budi });
    let b = await board();
    expect(turnOrder(b)).toEqual(["Citra", "Andi"]);
    expect(b.drivers.find((d) => d.name === "Budi")!.busy).toBe(true);

    await act(a.id, "deliver");
    const c = await addDelivery("Dua");
    await act(c.id, "depart", { driverId: citra });
    await act(c.id, "deliver");
    // Andi delivered first, then Budi, then Citra.
    b = await board();
    expect(turnOrder(b)).toEqual(["Andi", "Budi", "Citra"]);
    expect(nextName(b)).toBe("Andi");
  });
});

describe("POS sale with Diantar ke alamat", () => {
  it("queues once, in the same transaction as the sale, even when the upload is retried", async () => {
    const sale = {
      id: uuidv7(),
      number: "K1-261114-0001",
      soldAt: new Date().toISOString(),
      customerId: customer,
      lines: [{ productId: enamel, qty: 2, unitPrice: 78_000 }],
      discount: { kind: "none", value: 0 },
      method: "cash",
      accountId: cashAccount,
      tendered: 156_000,
      total: 156_000,
      delivery: { address: "Jl. Merdeka 5", phone: "0812", note: "Pagar hijau" },
    };
    const send = () => call("/api/pos/sales", { method: "POST", cookie: kasir, body: sale });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(200);

    const rows = await db.select().from(deliveries).where(eq(deliveries.posSaleId, sale.id));
    expect(rows.map((r) => [r.customerName, r.address, r.phone, r.note, r.status])).toEqual([["CV Bangun Jaya", "Jl. Merdeka 5", "0812", "Pagar hijau", "waiting"]]);

    // The kasir sees the queue with what to bring, and can send it off.
    const b = await board(kasir);
    const queued = b.deliveries.find((d) => d.posSaleNumber === "K1-261114-0001")!;
    expect(queued.items).toEqual(["2× Kilau Enamel 1 L"]);
    expect((await act(queued.id, "depart", { driverId: b.nextDriverId }, kasir)).status).toBe(200);
  });

  it("does not queue a sale without delivery", async () => {
    const before = (await db.select().from(deliveries)).length;
    const res = await call("/api/pos/sales", {
      method: "POST",
      cookie: kasir,
      body: {
        id: uuidv7(),
        number: "K1-261114-0002",
        soldAt: new Date().toISOString(),
        lines: [{ productId: enamel, qty: 1, unitPrice: 78_000 }],
        discount: { kind: "none", value: 0 },
        method: "cash",
        accountId: cashAccount,
        tendered: 78_000,
        total: 78_000,
      },
    });
    expect(res.status).toBe(201);
    expect(await db.select().from(deliveries)).toHaveLength(before);
  });
});

describe("Tambah antaran and permissions", () => {
  it("links a faktur by number and lists its items", async () => {
    const [invoice] = await db
      .insert(salesInvoices)
      .values({ number: "SO-261114-0001", customerId: customer, date: "2026-11-14", dueDate: "2026-11-14", subtotal: 78_000 as never, discountAmount: 0 as never, total: 78_000 as never, createdBy: staffId })
      .returning({ id: salesInvoices.id });
    await db.insert(salesLines).values({ invoiceId: invoice!.id, position: 0, productId: enamel, qty: 3, unitPrice: 26_000 as never, lineTotal: 78_000 as never, unitCost: 20_000 as never });

    expect((await addDelivery("", { invoiceNumber: "SO-999" })).res.status).toBe(422);
    const { res } = await addDelivery("", { invoiceNumber: "so-261114-0001" });
    expect(res.status).toBe(201);
    const row = (await board()).deliveries.find((d) => d.salesInvoiceNumber === "SO-261114-0001")!;
    expect([row.customerName, row.items]).toEqual(["CV Bangun Jaya", ["3× Kilau Enamel 1 L"]]);
  });

  it("keeps driver management and manual entries in the back office", async () => {
    expect((await call("/api/deliveries/drivers", { method: "POST", cookie: kasir, body: { name: "X" } })).status).toBe(403);
    expect((await call("/api/deliveries", { method: "POST", cookie: kasir, body: { customerName: "X", address: "Y" } })).status).toBe(403);
    expect((await call("/api/deliveries")).status).toBe(401);
  });
});
