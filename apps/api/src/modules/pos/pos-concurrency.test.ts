import { uuidv7 } from "@billy/core";
import { accounts, approvals, auditEvents, cashEntries, settings, stockMovements } from "@billy/db";
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
  let admin: string;
  let kasir: string;
  let account: string;
  let shiftId: string;
  let product: string;

  beforeAll(async () => {
    t = await createTestApp({ postgres: server });
    ({ cookie: staff } = await t.signIn("staff"));
    ({ cookie: admin } = await t.signIn("admin"));
    ({ cookie: kasir } = await t.signIn("kasir"));
    await t.db.insert(settings).values({ shopName: "Toko Uji", receiptFooter: "", posDeviceCode: "K1" });
    [{ id: account }] = (await t.db.insert(accounts).values({ code: "KAS", name: "Kas", kind: "cash" }).returning({ id: accounts.id })) as [{ id: string }];
    shiftId = await t.shiftFor(kasir);
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
    shiftId,
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
    const voidIt = () => t.call(`/api/pos/sales/${body.id}/void`, { method: "POST", cookie: admin, body: { reason: "Salah" } });
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

  it("spends one approved request once when a kasir's voids race with it", async () => {
    const body = sale();
    await post(body);
    const request = (await (
      await t.call("/api/approvals", { method: "POST", cookie: kasir, body: { action: "pos.void", saleId: body.id } })
    ).json()) as { id: string };
    await t.call(`/api/approvals/${request.id}/approve`, { method: "POST", cookie: admin });
    const voidIt = () =>
      t.call(`/api/pos/sales/${body.id}/void`, { method: "POST", cookie: kasir, body: { reason: "Salah", approval: { id: request.id } } });
    const statuses = (await Promise.all([voidIt(), voidIt(), voidIt()])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);
    const [row] = await t.db.select({ status: approvals.status }).from(approvals).where(eq(approvals.id, request.id));
    expect(row).toEqual({ status: "used" });
    const logged = await t.db.select().from(auditEvents).where(and(eq(auditEvents.approvalId, request.id), eq(auditEvents.action, "pos.sale.void")));
    expect(logged).toHaveLength(1);
  });

  it("spends a remote approval at most once when the same approved sale is uploaded three times at once", async () => {
    const body = { ...sale(), discount: { kind: "percent", value: 2_000 }, total: 40_000, tendered: 40_000 };
    const request = (await (await t.call("/api/approvals", { method: "POST", cookie: kasir, body: { action: "pos.sale", sale: body } })).json()) as {
      id: string;
    };
    await t.call(`/api/approvals/${request.id}/approve`, { method: "POST", cookie: admin });
    const statuses = (await Promise.all([1, 2, 3].map(() => post({ ...body, approval: { id: request.id } })))).map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.every((s) => [200, 201, 403].includes(s))).toBe(true);
    const cash = await t.db.select().from(cashEntries).where(eq(cashEntries.sourceId, body.id));
    expect(cash).toHaveLength(1);
    const logged = await t.db.select().from(auditEvents).where(eq(auditEvents.approvalId, request.id));
    expect(logged.filter((e) => e.action === "pos.sale.create")).toHaveLength(1);
  });
});
