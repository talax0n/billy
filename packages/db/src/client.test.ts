import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { createDb } from "./client.ts";
import { auditEvents, products, settings, stockMovements } from "./schema.ts";
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

it("keeps audit_events append-only, even for direct SQL", async () => {
  const { db, migrate, close } = await createDb();
  await migrate();
  await db.execute(sql`insert into audit_events (id, source, action, entity_type, entity_id, summary)
    values ('01a1d234-3800-7000-8000-000000000001', 'system', 'settings.update', 'settings', '1', 'Uji')`);

  const refusal = (query: Promise<unknown>) =>
    query.then(
      () => "allowed",
      (err: Error) => (err.cause as Error | undefined)?.message ?? err.message,
    );
  expect(await refusal(db.execute(sql`update audit_events set summary = 'Diubah'`))).toBe("audit_events is append-only: UPDATE is not allowed");
  expect(await refusal(db.execute(sql`delete from audit_events`))).toBe("audit_events is append-only: DELETE is not allowed");
  expect(await refusal(db.execute(sql`truncate audit_events`))).toBe("audit_events is append-only: TRUNCATE is not allowed");
  expect(await db.select({ summary: auditEvents.summary }).from(auditEvents)).toEqual([{ summary: "Uji" }]);
  await close();
});

it("allows one open shift per cashier per device", async () => {
  const { db, migrate, close } = await createDb();
  await migrate();
  await seed(db, { adminPasswordHash: "x" });
  const shift = (id: string, deviceCode: string, closed = false) =>
    db.execute(sql`insert into cash_shifts (id, cashier_id, device_code, account_id, opened_at, opening_float, closed_at)
      select ${id}::uuid, u.id, ${deviceCode}, a.id, now(), 0, ${closed ? sql`now()` : sql`null`}
      from users u, accounts a where a.kind = 'cash' limit 1`);
  await shift("01a1d234-3800-7000-8000-000000000001", "K1", true);
  await shift("01a1d234-3800-7000-8000-000000000002", "K1");
  await shift("01a1d234-3800-7000-8000-000000000003", "K2");
  const second = await shift("01a1d234-3800-7000-8000-000000000004", "K1").then(
    () => "allowed",
    (err: Error) => (err.cause as { constraint?: string } | undefined)?.constraint ?? err.message,
  );
  expect(second).toBe("cash_shifts_one_open");
  await close();
});
