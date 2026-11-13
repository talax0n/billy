import { rupiah, uuidv7 } from "@billy/core";
import { accounts, approvals, auditEvents, contacts, posSales, products, settings, stockMovements } from "@billy/db";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { call, signIn, db } = await createTestApp();
let admin: string;
let adminId: string;
let staff: string;
let kasir: string;
let kasirId: string;
let account: string;
let enamel: string;
let thinner: string;
const PIN = "246810";

beforeAll(async () => {
  ({ cookie: admin, user: { id: adminId } } = await signIn("admin"));
  ({ cookie: staff } = await signIn("staff"));
  ({ cookie: kasir, user: { id: kasirId } } = await signIn("kasir"));
  await db.insert(settings).values({ shopName: "Toko Uji", receiptFooter: "", posDeviceCode: "K1" });
  [{ id: account }] = (await db.insert(accounts).values({ code: "KAS", name: "Kas Toko", kind: "cash" }).returning({ id: accounts.id })) as [{ id: string }];
  [{ id: enamel }, { id: thinner }] = (await db
    .insert(products)
    .values([
      { name: "Kilau Enamel", variant: "1 L", unit: "kaleng", sellPrice: rupiah(78_000), costPrice: rupiah(61_000) },
      { name: "Thinner Super", variant: "1 L", unit: "botol", sellPrice: rupiah(32_000), costPrice: rupiah(24_500) },
    ])
    .returning({ id: products.id })) as [{ id: string }, { id: string }];
  await db.insert(stockMovements).values(
    [enamel, thinner].map((productId) => ({
      productId,
      date: "2026-11-13",
      qty: 100,
      reason: "adjustment" as const,
      unitCost: rupiah(0),
      createdBy: adminId,
    })),
  );
  const pin = await call("/api/approvals/pin", { method: "PUT", cookie: admin, body: { password: "rahasia123", pin: PIN } });
  expect(pin.status).toBe(200);
});

let n = 0;
/** 2 × 78.000 at `bp` off the whole nota. */
function sale(bp: number, overrides: Record<string, unknown> = {}) {
  const gross = 156_000;
  const total = gross - Math.round((gross * bp) / 10_000);
  return {
    id: uuidv7(),
    number: `K1-261113-${String(++n).padStart(4, "0")}`,
    soldAt: new Date().toISOString(),
    lines: [{ productId: enamel, qty: 2, unitPrice: 78_000 }],
    discount: bp ? { kind: "percent", value: bp } : { kind: "none", value: 0 },
    method: "cash",
    accountId: account,
    tendered: total,
    total,
    ...overrides,
  };
}

const post = (cookie: string, body: object) => call("/api/pos/sales", { method: "POST", cookie, body });
const json = async (res: Response) => [res.status, await res.json()] as const;
const requestRemote = async (cookie: string, body: object) => (await (await call("/api/approvals", { method: "POST", cookie, body })).json()) as { id: string; status: string };
const decide = (id: string, decision: "approve" | "reject", cookie = admin) => call(`/api/approvals/${id}/${decision}`, { method: "POST", cookie });
const approvalRow = async (id: string) => (await db.select().from(approvals).where(eq(approvals.id, id)))[0]!;
const auditOf = (entityId: string) => db.select().from(auditEvents).where(eq(auditEvents.entityId, entityId));

describe("discount cap and below-cost lines on POS sales", () => {
  it("refuses a kasir's 10% discount over the 5% cap with 403 naming the limit", async () => {
    expect(await json(await post(kasir, sale(1_000)))).toEqual([
      403,
      { error: "Diskon 10% melebihi batas kasir 5% per nota. Minta persetujuan admin.", approval: { kind: "discount" } },
    ]);
  });

  it("counts line and document discounts together", async () => {
    const lineAndDoc = sale(300, { lines: [{ productId: enamel, qty: 2, unitPrice: 78_000, discountAmount: 6_000 }] });
    // 6.000 line + 3% of 150.000 = 10.500 off 156.000 = 6,74%
    lineAndDoc.total = lineAndDoc.tendered = 145_500;
    const [status, body] = await json(await post(kasir, lineAndDoc));
    expect([status, (body as { error: string }).error]).toEqual([403, "Diskon 6,74% melebihi batas kasir 5% per nota. Minta persetujuan admin."]);
    expect((await post(kasir, sale(500))).status).toBe(201);
  });

  it("refuses a line priced below cost, unless the shop allows it", async () => {
    const cheap = sale(0, { lines: [{ productId: enamel, qty: 1, unitPrice: 60_000 }], total: 60_000, tendered: 60_000 });
    expect(await json(await post(kasir, cheap))).toEqual([
      403,
      { error: "Harga jual di bawah modal tidak diizinkan. Minta persetujuan admin.", approval: { kind: "below_cost" } },
    ]);
    await db.update(settings).set({ allowBelowCost: true });
    expect((await post(kasir, cheap)).status).toBe(201);
    await db.update(settings).set({ allowBelowCost: false });
  });

  it("never limits admin", async () => {
    const res = await post(admin, sale(5_000, { lines: [{ productId: enamel, qty: 2, unitPrice: 50_000 }], total: 50_000, tendered: 50_000 }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const [event] = await auditOf(id);
    expect(event).toMatchObject({ action: "pos.sale.create", actorId: adminId, approvalId: null });
  });

  it("applies the cap to staff on a back-office invoice too, and lets admin through", async () => {
    const [customer] = await db.insert(contacts).values({ code: "P-001", name: "CV Bangun Jaya", kind: "customer" }).returning();
    const invoice = {
      customerId: customer!.id,
      date: "2026-11-13",
      termsDays: 0,
      discountKind: "percent",
      discountValue: 1_000,
      lines: [{ productId: thinner, qty: 10, unitPrice: 32_000 }],
    };
    expect(await json(await call("/api/sales", { method: "POST", cookie: staff, body: invoice }))).toEqual([
      403,
      { error: "Diskon 10% melebihi batas kasir 5% per nota. Minta persetujuan admin.", approval: { kind: "discount" } },
    ]);
    expect((await call("/api/sales", { method: "POST", cookie: staff, body: { ...invoice, approval: { pin: PIN } } })).status).toBe(201);
    expect((await call("/api/sales", { method: "POST", cookie: admin, body: invoice })).status).toBe(201);
  });
});

describe("approval by admin PIN", () => {
  it("records the sale, a used PIN approval by the admin, and an audit row that points at it", async () => {
    const body = sale(1_000, { approval: { pin: PIN } });
    expect((await post(kasir, body)).status).toBe(201);
    const [event] = await auditOf(body.id);
    expect(event).toMatchObject({ action: "pos.sale.create", actorId: kasirId, source: "kasir", approvalId: expect.any(String) });
    expect(await approvalRow(event!.approvalId!)).toMatchObject({
      kind: "discount",
      status: "used",
      method: "pin",
      requestedBy: kasirId,
      decidedBy: adminId,
      subject: { saleId: body.id, total: 140_400, discount: { kind: "percent", value: 1_000 } },
    });
  });

  it("locks PIN approval for 15 minutes after five wrong PINs, and logs each one", async () => {
    const { cookie, user } = await signIn("kasir", "kasir-lock");
    const messages: string[] = [];
    for (let i = 0; i < 5; i++) {
      messages.push(((await (await post(cookie, sale(1_000, { approval: { pin: "000000" } }))).json()) as { error: string }).error);
    }
    expect(messages).toEqual([
      "PIN admin salah. Sisa 4 percobaan.",
      "PIN admin salah. Sisa 3 percobaan.",
      "PIN admin salah. Sisa 2 percobaan.",
      "PIN admin salah. Sisa 1 percobaan.",
      "PIN admin salah 5 kali. PIN dikunci 15 menit; minta persetujuan dari jauh.",
    ]);
    const right = await post(cookie, sale(1_000, { approval: { pin: PIN } }));
    expect(right.status).toBe(403);
    expect(((await right.json()) as { error: string }).error).toMatch(/^PIN admin dikunci sampai \d\d\.\d\d karena salah 5 kali/);

    const logged = await db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.actorId, user.id));
    expect(logged.filter((e) => e.action === "approval.pin_failed")).toHaveLength(5);
    expect(logged.filter((e) => e.action === "approval.pin_locked")).toHaveLength(1);
    expect(logged.some((e) => e.action === "pos.sale.create")).toBe(false);
  });

  it("never sends a PIN hash to a client", async () => {
    expect(await json(await call("/api/approvals/pin", { cookie: admin }))).toEqual([200, { set: true }]);
    for (const path of ["/api/users", "/api/auth/me", "/api/pos/catalog", "/api/settings"]) {
      const text = await (await call(path, { cookie: admin })).text();
      expect(text).not.toMatch(/scrypt|approvalPin|approval_pin/);
    }
    expect((await call("/api/approvals/pin", { cookie: kasir })).status).toBe(403);
  });

  it("asks for the admin's password before setting a PIN", async () => {
    const res = await call("/api/approvals/pin", { method: "PUT", cookie: admin, body: { password: "salah", pin: "111111" } });
    expect(await json(res)).toEqual([422, { error: "Kata sandi salah" }]);
  });
});

describe("remote approval", () => {
  it("is approved from the bell, then spent by the sale it was asked for, once", async () => {
    const body = sale(1_000);
    const request = await requestRemote(kasir, { action: "pos.sale", sale: body });
    expect(request).toMatchObject({ status: "pending", kind: "discount", summary: `Diskon 10% · ${body.number} · Rp 140.400` });

    const pending = (await (await call("/api/approvals/pending", { cookie: admin })).json()) as { rows: { id: string; requestedByName: string }[] };
    expect(pending.rows).toContainEqual(expect.objectContaining({ id: request.id, requestedByName: "Uji kasir" }));
    expect((await call("/api/approvals/pending", { cookie: kasir })).status).toBe(403);
    expect((await decide(request.id, "approve", kasir)).status).toBe(403);

    expect(await json(await post(kasir, { ...body, approval: { id: request.id } }))).toEqual([
      403,
      { error: "Persetujuan belum diberikan admin.", approval: { kind: "discount" } },
    ]);
    expect((await decide(request.id, "approve")).status).toBe(200);
    expect(((await (await call(`/api/approvals/${request.id}`, { cookie: kasir })).json()) as { status: string }).status).toBe("approved");

    expect((await post(kasir, { ...body, approval: { id: request.id } })).status).toBe(201);
    expect(await approvalRow(request.id)).toMatchObject({ status: "used", method: "remote", decidedBy: adminId });
    const [event] = await auditOf(body.id);
    expect(event!.approvalId).toBe(request.id);

    const again = sale(1_000, { approval: { id: request.id } });
    expect(await json(await post(kasir, again))).toEqual([403, { error: "Persetujuan ini sudah dipakai.", approval: { kind: "discount" } }]);
    expect((await decide(request.id, "approve")).status).toBe(409);
  });

  it("does not fit a bigger discount, another sale, or another cashier", async () => {
    const asked = sale(800);
    const request = await requestRemote(kasir, { action: "pos.sale", sale: asked });
    await decide(request.id, "approve");

    const bigger = { ...sale(1_500), id: asked.id, number: asked.number, approval: { id: request.id } };
    expect(await json(await post(kasir, bigger))).toEqual([
      403,
      { error: "Persetujuan ini untuk transaksi lain. Minta persetujuan baru.", approval: { kind: "discount" } },
    ]);
    const other = sale(800, { approval: { id: request.id } });
    expect((await post(kasir, other)).status).toBe(403);
    const { cookie: otherKasir } = await signIn("kasir", "kasir-lain");
    expect(await json(await post(otherKasir, { ...asked, approval: { id: request.id } }))).toEqual([
      403,
      { error: "Persetujuan tidak ditemukan.", approval: { kind: "discount" } },
    ]);
    expect((await call(`/api/approvals/${request.id}`, { cookie: otherKasir })).status).toBe(404);
    expect((await post(kasir, { ...asked, approval: { id: request.id } })).status).toBe(201);
  });

  it("refuses an expired approval, and an admin cannot approve it late", async () => {
    const body = sale(1_000);
    const late = await requestRemote(kasir, { action: "pos.sale", sale: body });
    await db.update(approvals).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(approvals.id, late.id));
    expect((await decide(late.id, "approve")).status).toBe(409);

    const approvedThenExpired = await requestRemote(kasir, { action: "pos.sale", sale: body });
    await decide(approvedThenExpired.id, "approve");
    await db.update(approvals).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(approvals.id, approvedThenExpired.id));
    expect(((await (await call(`/api/approvals/${approvedThenExpired.id}`, { cookie: kasir })).json()) as { status: string }).status).toBe("expired");
    expect(await json(await post(kasir, { ...body, approval: { id: approvedThenExpired.id } }))).toEqual([
      403,
      { error: "Persetujuan sudah kedaluwarsa. Minta persetujuan lagi.", approval: { kind: "discount" } },
    ]);
  });

  it("tells the kasir when the admin rejected the request", async () => {
    const body = sale(1_000);
    const request = await requestRemote(kasir, { action: "pos.sale", sale: body });
    expect((await decide(request.id, "reject")).status).toBe(200);
    expect(await json(await post(kasir, { ...body, approval: { id: request.id } }))).toEqual([
      403,
      { error: "Permintaan persetujuan ditolak admin.", approval: { kind: "discount" } },
    ]);
    const decisions = await db
      .select({ action: auditEvents.action, actorId: auditEvents.actorId })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, request.id)));
    expect(decisions).toEqual([
      { action: "approval.request", actorId: kasirId },
      { action: "approval.reject", actorId: adminId },
    ]);
  });

  it("refuses a request for a sale that needs no approval", async () => {
    const res = await call("/api/approvals", { method: "POST", cookie: kasir, body: { action: "pos.sale", sale: sale(500) } });
    expect(await json(res)).toEqual([422, { error: "Transaksi ini tidak butuh persetujuan admin" }]);
  });
});

describe("void by a kasir", () => {
  it("needs approval, then voids with the approval logged", async () => {
    const body = sale(0);
    await post(kasir, body);
    const voidIt = (extra: object = {}) => call(`/api/pos/sales/${body.id}/void`, { method: "POST", cookie: kasir, body: { reason: "Salah input", ...extra } });
    expect(await json(await voidIt())).toEqual([403, { error: "Void struk kasir butuh persetujuan admin. Minta persetujuan admin.", approval: { kind: "void" } }]);
    const [stillLive] = await db.select({ voidedAt: posSales.voidedAt }).from(posSales).where(eq(posSales.id, body.id));
    expect(stillLive!.voidedAt).toBeNull();

    const request = await requestRemote(kasir, { action: "pos.void", saleId: body.id });
    expect(request).toMatchObject({ kind: "void", summary: `Void ${body.number} · Rp 156.000` });
    await decide(request.id, "approve");
    expect((await voidIt({ approval: { id: request.id } })).status).toBe(200);
    const events = await auditOf(body.id);
    expect(events.find((e) => e.action === "pos.sale.void")).toMatchObject({ actorId: kasirId, reason: "Salah input", approvalId: request.id });
  });

  it("accepts the admin PIN for a void", async () => {
    const body = sale(0);
    await post(kasir, body);
    const res = await call(`/api/pos/sales/${body.id}/void`, { method: "POST", cookie: kasir, body: { reason: "Batal beli", approval: { pin: PIN } } });
    expect(res.status).toBe(200);
  });
});

describe("Pengaturan: batas kasir", () => {
  it("is read and changed by admin only, logged, and shown to the cashier in its catalog", async () => {
    expect(await json(await call("/api/settings/limits", { cookie: admin }))).toEqual([200, { kasirMaxDiscountBp: 500, allowBelowCost: false }]);
    expect((await call("/api/settings/limits", { cookie: staff })).status).toBe(403);
    const body = { kasirMaxDiscountBp: 1_000, allowBelowCost: false };
    expect((await call("/api/settings/limits", { method: "PUT", cookie: staff, body })).status).toBe(403);
    expect(await json(await call("/api/settings/limits", { method: "PUT", cookie: admin, body }))).toEqual([200, body]);
    expect(((await (await call("/api/pos/catalog", { cookie: kasir })).json()) as { limits: object }).limits).toEqual(body);
    expect((await post(kasir, sale(1_000))).status).toBe(201);

    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.action, "settings.limits.update"));
    expect(event).toMatchObject({
      actorId: adminId,
      summary: "Batas kasir: diskon maks 10%, tidak boleh di bawah modal",
      before: { kasirMaxDiscountBp: 500 },
      after: { kasirMaxDiscountBp: 1_000 },
    });
    await call("/api/settings/limits", { method: "PUT", cookie: admin, body: { kasirMaxDiscountBp: 500, allowBelowCost: false } });
  });
});
