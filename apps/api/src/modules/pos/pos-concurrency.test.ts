import { uuidv7 } from "@billy/core";
import { accounts, cashEntries, settings, stockMovements } from "@billy/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

/**
 * Races that PGlite cannot show: it runs one transaction at a time. Runs against a real
 * Postgres server when TEST_POSTGRES_URL is set, e.g. postgres://postgres@127.0.0.1:5432/postgres.
 */
const server = process.env.TEST_POSTGRES_URL;

describe.skipIf(!server)("POS under concurrent requests (real Postgres)", () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let staff: string;
  let kasir: string;
  let account: string;
  let product: string;

  beforeAll(async () => {
    t = await createTestApp({ postgres: server });
    ({ cookie: staff } = await t.signIn("staff"));
    ({ cookie: kasir } = await t.signIn("kasir"));
    await t.db.insert(settings).values({ shopName: "Toko Uji", receiptFooter: "", posDeviceCode: "K1" });
    [{ id: account }] = (await t.db.insert(accounts).values({ code: "KAS", name: "Kas", kind: "cash" }).returning({ id: accounts.id })) as [{ id: string }];
    const res = await t.call("/api/products", {
      method: "POST",
      cookie: staff,
      body: { code: "P1", barcode: null, name: "Cat", variant: "", unit: "kaleng", categoryId: null, sellPrice: 50_000, costPrice: 40_000, minStock: 0 },
    });
    product = ((await res.json()) as { id: string }).id;
  });
  afterAll(() => t?.close());

  let n = 0;
  const sale = () => ({
    id: uuidv7(),
    number: `K1-261113-${String(++n).padStart(4, "0")}`,
    soldAt: "2026-11-13T02:15:00.000Z",
    lines: [{ productId: product, qty: 1, unitPrice: 50_000 }],
    discount: { kind: "none", value: 0 },
    method: "cash",
    accountId: account,
    tendered: 50_000,
    total: 50_000,
  });
  const post = (body: object) => t.call("/api/pos/sales", { method: "POST", cookie: kasir, body });

  it("answers both concurrent uploads of one new sale with 201 / 200, recording it once", async () => {
    const body = sale();
    const statuses = (await Promise.all([post(body), post(body), post(body)])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 201]);
    const cash = await t.db.select().from(cashEntries).where(eq(cashEntries.sourceId, body.id));
    expect(cash).toHaveLength(1);
  });

  it("voids a sale once when two voids race", async () => {
    const body = sale();
    await post(body);
    const voidIt = () => t.call(`/api/pos/sales/${body.id}/void`, { method: "POST", cookie: staff, body: { reason: "Salah" } });
    const statuses = (await Promise.all([voidIt(), voidIt(), voidIt()])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);
    const reversals = await t.db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.sourceId, body.id), eq(stockMovements.reason, "reversal")));
    const cashOut = await t.db
      .select()
      .from(cashEntries)
      .where(and(eq(cashEntries.sourceId, body.id), eq(cashEntries.category, "reversal")));
    expect([reversals.length, cashOut.length]).toEqual([1, 1]);
  });
});
