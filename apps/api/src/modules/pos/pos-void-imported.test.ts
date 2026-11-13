import { businessDate, rupiah, uuidv7 } from "@billy/core";
import { accounts, posLines, posSales, products, stockMovements } from "@billy/db";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { call, signIn, db } = await createTestApp();

const stock = async (productId: string) =>
  (await db.select({ qty: sql<number>`coalesce(sum(${stockMovements.qty}), 0)`.mapWith(Number) }).from(stockMovements).where(eq(stockMovements.productId, productId)))[0]!.qty;

it("voiding an imported receipt restores its goods and moves no stock on its Selisih impor line", async () => {
  const { cookie: admin, user } = await signIn("admin");
  const [{ id: kas }] = (await db.insert(accounts).values({ code: "KAS", name: "Kas Toko", kind: "cash" }).returning({ id: accounts.id })) as [{ id: string }];
  const [{ id: cat }, { id: selisih }] = (await db
    .insert(products)
    .values([
      { name: "Cat", unit: "kaleng", sellPrice: rupiah(10_000) },
      { code: "LEG-SELISIH", name: "Selisih impor (data lama)", unit: "LS", active: false },
    ])
    .returning({ id: products.id })) as [{ id: string }, { id: string }];
  const date = businessDate();
  await db.insert(stockMovements).values({ productId: cat, date, qty: 10, reason: "adjustment", unitCost: rupiah(0), createdBy: user.id });

  // Shaped like import:legacy-skipped writes it: two real units sold, plus a Rp 5.000 adjustment line without a movement.
  const id = uuidv7();
  await db.insert(posSales).values({
    id, number: "C-230101-0001", deviceCode: "C", soldAt: new Date(), date, cashierId: user.id,
    subtotal: rupiah(25_000), discountAmount: rupiah(0), total: rupiah(25_000), method: "cash", accountId: kas,
    tendered: rupiah(25_000), change: rupiah(0), shiftId: null,
  });
  await db.insert(posLines).values([
    { saleId: id, position: 0, productId: cat, qty: 2, unitPrice: rupiah(10_000), lineTotal: rupiah(20_000), unitCost: rupiah(0) },
    { saleId: id, position: 1, productId: selisih, note: "Selisih impor (data lama)", qty: 1, unitPrice: rupiah(5_000), lineTotal: rupiah(5_000), unitCost: rupiah(0) },
  ]);
  await db.insert(stockMovements).values({ productId: cat, date, qty: -2, reason: "pos", unitCost: rupiah(0), sourceType: "pos_sale", sourceId: id, createdBy: user.id });

  expect((await call(`/api/pos/sales/${id}/void`, { method: "POST", cookie: admin, body: { reason: "Uji" } })).status).toBe(200);
  expect(await stock(cat)).toBe(10);
  expect(await stock(selisih)).toBe(0);
});
