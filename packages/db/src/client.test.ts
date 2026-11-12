import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { createDb } from "./client.ts";
import { products, settings, stockMovements } from "./schema.ts";
import { isEmpty, seed } from "./seed.ts";

it("migrates an in-memory database and seeds it once", async () => {
  const { db, migrate, close } = await createDb();
  await migrate();
  expect(await isEmpty(db)).toBe(true);

  await seed(db, { adminPasswordHash: "x" });
  expect(await isEmpty(db)).toBe(false);

  const [shop] = await db.select().from(settings);
  expect(shop!.posDeviceCode).toBe("K1");

  const [amplas] = await db
    .select({ sellPrice: products.sellPrice, stock: sql<number>`sum(${stockMovements.qty})::int` })
    .from(products)
    .innerJoin(stockMovements, eq(stockMovements.productId, products.id))
    .where(eq(products.code, "AL-003"))
    .groupBy(products.id);
  expect(amplas).toEqual({ sellPrice: 3_500, stock: 180 });

  await close();
});
