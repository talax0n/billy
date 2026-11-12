import { addDays, businessDate, rupiah } from "@billy/core";
import { contacts, products } from "@billy/db";
import { beforeAll, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { db, call, signIn } = await createTestApp();
const today = businessDate();
let cookie: string;
let catId: string;
let invoiceNumber: string;

beforeAll(async () => {
  ({ cookie } = await signIn("staff"));
  const [supplier] = await db.insert(contacts).values({ code: "S-1", name: "Pemasok", kind: "supplier" }).returning();
  const [cat, kuas, thinner] = await db
    .insert(products)
    .values([
      { name: "Warnaku Tembok", variant: "Putih", unit: "pail", costPrice: rupiah(150_000), minStock: 5 },
      { name: "Kuas", unit: "pcs", minStock: 10 },
      { name: "Thinner", unit: "botol", minStock: 0 },
    ])
    .returning();
  catId = cat!.id;
  const adjust = (id: string, qty: number, note: string, date = today) =>
    call(`/api/products/${id}/adjustments`, { method: "POST", cookie, body: { qty, note, date } });
  await adjust(catId, 10, "Stok awal", addDays(today, -3));
  await adjust(kuas!.id, 12, "Stok awal");
  await adjust(thinner!.id, -2, "Terjual tanpa catatan");
  const res = await call("/api/purchases", {
    method: "POST",
    cookie,
    body: {
      supplierId: supplier!.id,
      date: addDays(today, -1),
      termsDays: 30,
      discountKind: "none",
      discountValue: 0,
      taxRateBp: 1_100,
      lines: [{ productId: catId, qty: 4, unitCost: 140_000, discountAmount: 0 }],
    },
  });
  invoiceNumber = ((await res.json()) as { number: string }).number;
  await adjust(catId, -9, "Kaleng penyok");
});

it("lists every movement newest first with its source document", async () => {
  const res = await call("/api/stock/movements", { cookie });
  const body = (await res.json()) as { total: number; rows: Record<string, unknown>[] };
  expect(body.total).toBe(5);
  expect(body.rows[0]).toMatchObject({ productName: "Warnaku Tembok", qty: -9, reason: "adjustment", sourceType: null, runningStock: null });
  expect(body.rows.find((row) => row.reason === "purchase")).toMatchObject({
    qty: 4,
    unitCost: 140_000,
    sourceType: "purchase_invoice",
    sourceNumber: invoiceNumber,
    createdByName: "Uji staff",
  });
});

it("carries running stock for one product, unaffected by date and reason filters", async () => {
  const all = await call(`/api/stock/movements?productId=${catId}`, { cookie });
  expect(await all.json()).toMatchObject({
    total: 3,
    rows: [
      { qty: -9, runningStock: 5 },
      { qty: 4, runningStock: 14 },
      { qty: 10, runningStock: 10 },
    ],
  });
  const filtered = await call(`/api/stock/movements?productId=${catId}&reason=purchase&from=${addDays(today, -1)}`, { cookie });
  expect(await filtered.json()).toMatchObject({ total: 1, rows: [{ qty: 4, runningStock: 14 }] });
});

it("lists negative stock and stock under its minimum, worst first", async () => {
  const alerts = async () => (await call("/api/stock/alerts", { cookie })).json();
  expect(await alerts()).toMatchObject({ total: 1, rows: [{ name: "Thinner", stock: -2, minStock: 0 }] });

  await call(`/api/products/${catId}/adjustments`, { method: "POST", cookie, body: { qty: -1, note: "Rusak", date: today } });
  expect(await alerts()).toMatchObject({
    total: 2,
    rows: [
      { name: "Thinner", stock: -2, minStock: 0 },
      { name: "Warnaku Tembok", stock: 4, minStock: 5 },
    ],
  });
});

it("is closed to kasir", async () => {
  const { cookie: kasir } = await signIn("kasir");
  expect((await call("/api/stock/movements", { cookie: kasir })).status).toBe(403);
  expect((await call("/api/stock/alerts", { cookie: kasir })).status).toBe(403);
});
