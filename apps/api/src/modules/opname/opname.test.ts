import { businessDate, rupiah, uuidv7 } from "@billy/core";
import { accounts, auditEvents, categories, products, settings, stockMovements } from "@billy/db";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { call, signIn, db } = await createTestApp();
let admin: string;
let adminId: string;
let staff: string;
let kas: string;
let paint: string;
let brushes: string;
let thinner: string;
let rollers: string;

beforeAll(async () => {
  ({ cookie: admin, user: { id: adminId } } = await signIn("admin"));
  ({ cookie: staff } = await signIn("staff"));
  await db.insert(settings).values({ shopName: "Toko Uji", receiptFooter: "", posDeviceCode: "K1" });
  [{ id: kas }] = (await db.insert(accounts).values({ code: "KAS", name: "Kas Toko", kind: "cash" }).returning({ id: accounts.id })) as [{ id: string }];
  const [cat, tools] = await db.insert(categories).values([{ name: "Cat" }, { name: "Alat" }]).returning({ id: categories.id });
  [{ id: paint }, { id: thinner }, { id: brushes }, { id: rollers }] = (await db
    .insert(products)
    .values([
      { name: "Cat Tembok", unit: "kaleng", categoryId: cat!.id, sellPrice: rupiah(100_000), costPrice: rupiah(70_000) },
      { name: "Thinner", unit: "liter", categoryId: cat!.id, sellPrice: rupiah(30_000), costPrice: rupiah(20_000) },
      { name: "Kuas", unit: "pcs", categoryId: tools!.id, sellPrice: rupiah(15_000), costPrice: rupiah(10_000) },
      { name: "Roll", unit: "pcs", categoryId: tools!.id, sellPrice: rupiah(25_000), costPrice: rupiah(15_000) },
    ])
    .returning({ id: products.id })) as [{ id: string }, { id: string }, { id: string }, { id: string }];
  await db.insert(stockMovements).values(
    [paint, thinner, brushes, rollers].map((productId) => ({ productId, date: businessDate(), qty: 10, reason: "adjustment" as const, unitCost: rupiah(0), createdBy: adminId })),
  );
});

const json = async (res: Response) => [res.status, await res.json()] as const;
const post = (path: string, cookie: string, body: unknown = {}) => call(path, { method: "POST", cookie, body });
const count = (id: string, cookie: string, lines: { productId: string; countedQty: number | null }[]) =>
  call(`/api/opnames/${id}/lines`, { method: "PUT", cookie, body: { lines } });
const start = async (cookie: string, categoryId: string | null = null) => {
  const [status, opname] = await json(await post("/api/opnames", cookie, { categoryId, note: "" }));
  expect(status).toBe(201);
  return opname as { id: string; number: string };
};
const stockOf = async (productId: string) => ((await (await call(`/api/products/${productId}`, { cookie: admin })).json()) as { stock: number }).stock;
const lines = async (id: string, filter = "all") =>
  ((await (await call(`/api/opnames/${id}/lines?filter=${filter}`, { cookie: staff })).json()) as { rows: Record<string, unknown>[] }).rows;

describe("stok opname", () => {
  it("staff counts a draft; admin posts it against the stock at posting time", async () => {
    const opname = await start(staff);
    expect(opname.number).toMatch(/^OP-\d{6}-0001$/);
    expect((await count(opname.id, staff, [{ productId: paint, countedQty: 7 }, { productId: brushes, countedQty: 99 }])).status).toBe(200);
    // Saved as a draft and continued: Kuas is corrected, Thinner counted, Kuas cleared again.
    expect((await count(opname.id, staff, [{ productId: thinner, countedQty: 12 }, { productId: brushes, countedQty: null }])).status).toBe(200);
    expect((await lines(opname.id, "counted")).map((l) => [l.name, l.systemQty, l.countedQty, l.difference, l.value])).toEqual([
      ["Cat Tembok", 10, 7, -3, -210_000],
      ["Thinner", 10, 12, 2, 40_000],
    ]);
    expect((await lines(opname.id)).length).toBe(4);
    expect((await lines(opname.id, "uncounted")).map((l) => l.name)).toEqual(["Kuas", "Roll"]);

    // Two cans sell while the count goes on: posting compares the count with 8, not 10.
    const sale = {
      id: uuidv7(),
      number: "K1-261113-0001",
      soldAt: new Date().toISOString(),
      lines: [{ productId: paint, qty: 2, unitPrice: 100_000 }],
      discount: { kind: "none", value: 0 },
      method: "cash",
      accountId: kas,
      tendered: 200_000,
      total: 200_000,
    };
    expect((await post("/api/pos/sales", admin, sale)).status).toBe(201);

    expect((await post(`/api/opnames/${opname.id}/post`, staff)).status).toBe(403);
    const [status, posted] = await json(await post(`/api/opnames/${opname.id}/post`, admin));
    expect(status).toBe(200);
    expect(posted).toMatchObject({ status: "posted", counted: 2, changed: 2, net: -30_000, postedByName: "Uji admin" });
    expect([await stockOf(paint), await stockOf(thinner), await stockOf(brushes)]).toEqual([7, 12, 10]);

    const movements = await db.select().from(stockMovements).where(and(eq(stockMovements.sourceType, "stock_opname"), eq(stockMovements.sourceId, opname.id)));
    expect(movements.map((m) => [m.productId, m.qty, m.reason, m.unitCost, m.note]).sort()).toEqual(
      [
        [paint, -1, "adjustment", 70_000, `Opname ${opname.number}`],
        [thinner, 2, "adjustment", 20_000, `Opname ${opname.number}`],
      ].sort(),
    );
    const [event] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, opname.id), eq(auditEvents.action, "stock.opname.post")));
    expect(event!.summary).toBe(`Opname ${opname.number} · 2 barang selisih · −Rp 30.000`);
    // Frozen: the lines keep the stock at posting, whatever sells later.
    expect((await lines(opname.id)).map((l) => [l.name, l.systemQty, l.countedQty, l.difference])).toEqual([
      ["Cat Tembok", 8, 7, -1],
      ["Thinner", 10, 12, 2],
    ]);
  });

  it("is read-only once posted", async () => {
    const opname = await start(admin);
    expect((await count(opname.id, admin, [{ productId: rollers, countedQty: 10 }])).status).toBe(200);
    expect((await post(`/api/opnames/${opname.id}/post`, admin)).status).toBe(200);
    expect(await json(await count(opname.id, admin, [{ productId: rollers, countedQty: 3 }]))).toEqual([
      409,
      { error: `Opname ${opname.number} sudah diposting dan tidak bisa diubah` },
    ]);
    expect((await post(`/api/opnames/${opname.id}/post`, admin)).status).toBe(409);
    expect(await stockOf(rollers)).toBe(10);
  });

  it("counts only products in its category and refuses to post an empty count", async () => {
    const opname = await start(staff, (await db.select().from(categories).where(eq(categories.name, "Alat")))[0]!.id);
    expect((await lines(opname.id)).map((l) => l.name)).toEqual(["Kuas", "Roll"]);
    expect((await count(opname.id, staff, [{ productId: paint, countedQty: 1 }])).status).toBe(422);
    expect(await json(await post(`/api/opnames/${opname.id}/post`, admin))).toEqual([422, { error: "Belum ada barang yang dihitung" }]);
    expect((await count(opname.id, staff, [{ productId: brushes, countedQty: -1 }])).status).toBe(400);
  });

  it("is not open to a kasir", async () => {
    const { cookie: kasir } = await signIn("kasir");
    expect((await call("/api/opnames", { cookie: kasir })).status).toBe(403);
  });
});
