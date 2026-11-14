import { addDays, businessDate, docPeriod, rupiah, uuidv7 } from "@billy/core";
import { accounts, approvals, auditEvents, cashEntries, cashShifts, posDrafts, posSales, products, settings, stockMovements } from "@billy/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { call, signIn, db } = await createTestApp();
const PIN = "135790";
let admin: string;
let adminId: string;
let kasir: string;
let kasir2: string;
let kas: string;
let qris: string;
let cat: string;
let n = 0;

beforeAll(async () => {
  ({ cookie: admin, user: { id: adminId } } = await signIn("admin"));
  ({ cookie: kasir } = await signIn("kasir"));
  ({ cookie: kasir2 } = await signIn("kasir", "kasir2"));
  await db.insert(settings).values({ shopName: "Toko Uji", receiptFooter: "", posDeviceCode: "K1" });
  [{ id: kas }, { id: qris }] = (await db
    .insert(accounts)
    .values([
      { code: "KAS", name: "Kas Toko", kind: "cash" },
      { code: "QR", name: "QRIS", kind: "ewallet" },
    ])
    .returning({ id: accounts.id })) as [{ id: string }, { id: string }];
  [{ id: cat }] = (await db
    .insert(products)
    .values({ name: "Cat", variant: "1 L", unit: "kaleng", sellPrice: rupiah(10_000), costPrice: rupiah(5_000) })
    .returning({ id: products.id })) as [{ id: string }];
  await db.insert(stockMovements).values({ productId: cat, date: businessDate(), qty: 1_000, reason: "adjustment", unitCost: rupiah(5_000), createdBy: adminId });
  expect((await call("/api/approvals/pin", { method: "PUT", cookie: admin, body: { password: "rahasia123", pin: PIN } })).status).toBe(200);
});

const json = async (res: Response) => [res.status, await res.json()] as const;
const post = (path: string, cookie: string, body: unknown = {}) => call(path, { method: "POST", cookie, body });

async function openShift(cookie: string, openingFloat: number) {
  const id = uuidv7();
  const res = await post("/api/pos/shifts", cookie, { id, deviceCode: "K1", accountId: kas, openedAt: new Date().toISOString(), openingFloat });
  expect(res.status).toBe(201);
  return id;
}
const closeShift = async (cookie: string, id: string) => {
  expect((await post(`/api/pos/shifts/${id}/close`, cookie, { closedAt: new Date().toISOString(), countedCash: 0, note: "" })).status).toBe(200);
  return (await db.select().from(cashShifts).where(eq(cashShifts.id, id)))[0]!.expectedCash;
};

const nextNumber = () => `K1-261113-${String(++n).padStart(4, "0")}`;
/** `qty` × Rp 10.000, paid in full. */
const sale = (shiftId: string, qty: number, method = "cash", accountId = kas) => ({
  id: uuidv7(),
  number: nextNumber(),
  soldAt: new Date().toISOString(),
  shiftId,
  lines: [{ productId: cat, qty, unitPrice: 10_000 }],
  discount: { kind: "none", value: 0 },
  method,
  accountId,
  tendered: qty * 10_000,
  total: qty * 10_000,
});
async function sell(cookie: string, body: ReturnType<typeof sale>) {
  const res = await post("/api/pos/sales", cookie, body);
  expect(res.status).toBe(201);
  return body.id;
}

/** The new nota for a revisi to `qty` × Rp 10.000; `tendered` defaults to the difference collected. */
const revision = (shiftId: string, qty: number, extra: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  number: nextNumber(),
  shiftId,
  lines: [{ productId: cat, qty, unitPrice: 10_000 }],
  discount: { kind: "none", value: 0 },
  method: "cash",
  accountId: kas,
  tendered: 0,
  total: qty * 10_000,
  reason: "Salah jumlah",
  ...extra,
});
const revise = (cookie: string, originalId: string, body: object) => post(`/api/pos/sales/${originalId}/revise`, cookie, body);
const getSale = async (id: string, cookie = admin) => (await (await call(`/api/pos/sales/${id}`, { cookie })).json()) as Record<string, unknown>;
const stockOf = async () =>
  (await db.select({ qty: sql<number>`sum(${stockMovements.qty})::int` }).from(stockMovements).where(eq(stockMovements.productId, cat)))[0]!.qty;
const cashOf = async (sourceIds: string[]) =>
  db
    .select({ accountId: cashEntries.accountId, direction: cashEntries.direction, amount: cashEntries.amount })
    .from(cashEntries)
    .where(inArray(cashEntries.sourceId, sourceIds));
const audits = (entityId: string, action: string) => db.select().from(auditEvents).where(and(eq(auditEvents.entityId, entityId), eq(auditEvents.action, action)));

describe("revisi nota kasir", () => {
  it("cash → cash, up then down: only the difference moves and the shift tally matches the drawer", async () => {
    const shift = await openShift(kasir, 100_000);
    const stockBefore = await stockOf();
    const first = await sell(kasir, sale(shift, 3));

    const up = revision(shift, 5, { tendered: 50_000 });
    expect((await revise(kasir, first, up)).status).toBe(201);
    expect(await getSale(first)).toMatchObject({ voidReason: "Revisi " + up.number + ": Salah jumlah", revisedById: up.id, revisedByNumber: up.number });
    expect(await getSale(up.id)).toMatchObject({ revisionOf: first, total: 50_000, tendered: 50_000, change: 30_000, method: "cash" });

    const down = revision(shift, 2);
    expect(await json(await revise(kasir, up.id, down))).toEqual([
      403,
      { error: "Revisi yang menurunkan total butuh persetujuan admin. Minta persetujuan admin.", approval: { kind: "revisi_lower" } },
    ]);
    expect((await revise(kasir, up.id, { ...down, approval: { pin: PIN } })).status).toBe(201);
    expect(await getSale(down.id)).toMatchObject({ revisionOfNumber: up.number, total: 20_000, change: 30_000 });

    // 30.000 in, 20.000 more in, 30.000 back out: the drawer holds 100.000 + 20.000.
    expect(await cashOf([first, up.id, down.id])).toEqual([
      { accountId: kas, direction: "in", amount: 30_000 },
      { accountId: kas, direction: "in", amount: 20_000 },
      { accountId: kas, direction: "out", amount: 30_000 },
    ]);
    expect(await stockOf()).toBe(stockBefore - 2);
    expect(await closeShift(kasir, shift)).toBe(120_000);

    const [event] = await audits(down.id, "pos.sale.revise");
    expect(event).toMatchObject({ reason: "Salah jumlah", before: expect.objectContaining({ total: 50_000 }), after: expect.objectContaining({ total: 20_000, difference: -30_000 }) });
    expect(event!.approvalId).not.toBeNull();
  });

  it("a QRIS original: the difference is collected as chosen, a refund always comes out of the drawer in cash", async () => {
    const shift = await openShift(kasir, 50_000);
    const first = await sell(kasir, sale(shift, 4, "qris", qris));

    const up = revision(shift, 5, { tendered: 10_000 });
    expect((await revise(kasir, first, up)).status).toBe(201);
    const down = revision(shift, 3, { method: "qris", accountId: qris, approval: { pin: PIN } });
    expect((await revise(kasir, up.id, down)).status).toBe(201);
    expect(await getSale(down.id)).toMatchObject({ method: "cash", accountId: kas, change: 20_000 });

    // The QRIS account keeps the 40.000 paid there; the drawer takes 10.000 and pays back 20.000.
    expect(await cashOf([first, up.id, down.id])).toEqual([
      { accountId: qris, direction: "in", amount: 40_000 },
      { accountId: kas, direction: "in", amount: 10_000 },
      { accountId: kas, direction: "out", amount: 20_000 },
    ]);
    expect(await closeShift(kasir, shift)).toBe(40_000);
  });

  it("binds a remote approval to the original and the new total, and spends it once", async () => {
    const shift = await openShift(kasir, 0);
    const first = await sell(kasir, sale(shift, 3));
    const second = await sell(kasir, sale(shift, 3));
    const lower = revision(shift, 1);
    const asked = (await (await post("/api/approvals", kasir, { action: "pos.revise", originalId: first, revision: lower })).json()) as { id: string; summary: string };
    expect(asked.summary).toContain("Revisi K1-");
    expect((await post(`/api/approvals/${asked.id}/approve`, admin)).status).toBe(200);

    expect(await json(await revise(kasir, first, { ...revision(shift, 2), approval: { id: asked.id } }))).toEqual([
      403,
      { error: "Persetujuan ini untuk transaksi lain. Minta persetujuan baru.", approval: { kind: "revisi_lower" } },
    ]);
    expect(await json(await revise(kasir, second, { ...lower, approval: { id: asked.id } }))).toEqual([
      403,
      { error: "Persetujuan ini untuk transaksi lain. Minta persetujuan baru.", approval: { kind: "revisi_lower" } },
    ]);
    expect((await revise(kasir, first, { ...lower, approval: { id: asked.id } })).status).toBe(201);
    expect((await db.select().from(approvals).where(eq(approvals.id, asked.id)))[0]!.status).toBe("used");
    expect(await json(await revise(kasir, second, { ...revision(shift, 1), approval: { id: asked.id } }))).toEqual([
      403,
      { error: "Persetujuan ini sudah dipakai.", approval: { kind: "revisi_lower" } },
    ]);
    expect(await json(await revise(kasir, first, revision(shift, 3)))).toEqual([409, { error: "Struk ini sudah dibatalkan atau direvisi" }]);
    await closeShift(kasir, shift);
  });

  it("needs approval for another cashier's nota or a past day's, but not from the admin", async () => {
    const shift = await openShift(kasir, 0);
    const shift2 = await openShift(kasir2, 0);
    const adminShift = await openShift(admin, 0);
    const mine = await sell(kasir, sale(shift, 2));
    const yesterday = await sell(kasir, sale(shift, 2));
    await db.update(posSales).set({ date: addDays(businessDate(), -1) }).where(eq(posSales.id, yesterday));

    const foreign = await json(await revise(kasir2, mine, revision(shift2, 3, { tendered: 10_000 })));
    expect(foreign).toEqual([
      403,
      { error: "Revisi nota kasir lain atau nota hari sebelumnya butuh persetujuan admin. Minta persetujuan admin.", approval: { kind: "foreign_or_past_revisi" } },
    ]);
    expect((await revise(kasir, yesterday, revision(shift, 3, { tendered: 10_000 }))).status).toBe(403);
    expect((await revise(kasir, yesterday, revision(shift, 3, { tendered: 10_000, approval: { pin: PIN } }))).status).toBe(201);

    expect((await revise(admin, mine, revision(adminShift, 1))).status).toBe(201);
    for (const [cookie, id] of [[kasir, shift], [kasir2, shift2], [admin, adminShift]] as const) await closeShift(cookie, id);
  });

  it("counts every reprint, and a kasir reprints only their own", async () => {
    const shift = await openShift(kasir, 0);
    const id = await sell(kasir, sale(shift, 1));
    expect(await getSale(id)).toMatchObject({ printCount: 1 });
    expect(await json(await post(`/api/pos/sales/${id}/print`, kasir))).toEqual([200, expect.objectContaining({ printCount: 2 })]);
    expect((await post(`/api/pos/sales/${id}/print`, kasir2)).status).toBe(404);
    expect(await audits(id, "pos.sale.print")).toHaveLength(1);
    await closeShift(kasir, shift);
  });
});

describe("nota sementara", () => {
  const draftBody = (qty: number, discount = { kind: "none", value: 0 }) => ({
    customerId: null,
    lines: [{ productId: cat, qty, unitPrice: 10_000 }],
    discount,
  });
  const createDraft = async (cookie: string, qty: number) => {
    const [status, draft] = await json(await post("/api/pos/drafts", cookie, draftBody(qty)));
    expect(status).toBe(201);
    return draft as { id: string; number: string; total: number };
  };

  it("is numbered on the server, shared across cashiers, edited with an audit trail, and moves nothing", async () => {
    const stockBefore = await stockOf();
    const draft = await createDraft(kasir, 2);
    expect(draft).toMatchObject({ number: expect.stringMatching(new RegExp(`^S-${docPeriod(businessDate())}-\\d{4}$`)), status: "open", total: 20_000, printCount: 0 });

    const list = (await (await call("/api/pos/drafts", { cookie: kasir2 })).json()) as { rows: { id: string }[] };
    expect(list.rows.map((d) => d.id)).toContain(draft.id);
    expect(await json(await call(`/api/pos/drafts/${draft.id}`, { cookie: kasir2 }))).toEqual([
      200,
      expect.objectContaining({ lines: [expect.objectContaining({ productId: cat, qty: 2, name: "Cat", variant: "1 L", lineTotal: 20_000 })] }),
    ]);

    expect((await call(`/api/pos/drafts/${draft.id}`, { method: "PUT", cookie: kasir2, body: draftBody(3) })).status).toBe(200);
    const [edit] = await audits(draft.id, "pos.draft.update");
    expect(edit).toMatchObject({ before: { total: 20_000, subtotal: 20_000, lines: [expect.objectContaining({ qty: 2 })] }, after: { total: 30_000, subtotal: 30_000, lines: [expect.objectContaining({ qty: 3 })] } });

    expect(await stockOf()).toBe(stockBefore);
    expect(await cashOf([draft.id])).toEqual([]);
    expect((await call(`/api/pos/drafts/${draft.id}`, { method: "DELETE", cookie: admin })).status).toBe(404);
  });

  it("cancels with a reason; once printed, a non-admin needs approval", async () => {
    const plain = await createDraft(kasir, 1);
    expect((await post(`/api/pos/drafts/${plain.id}/cancel`, kasir, { reason: "" })).status).toBe(400);
    expect(await json(await post(`/api/pos/drafts/${plain.id}/cancel`, kasir, { reason: "Pelanggan batal" }))).toEqual([
      200,
      expect.objectContaining({ status: "cancelled", cancelReason: "Pelanggan batal" }),
    ]);

    const printed = await createDraft(kasir, 1);
    expect(await json(await post(`/api/pos/drafts/${printed.id}/print`, kasir))).toEqual([200, expect.objectContaining({ printCount: 1 })]);
    expect(await json(await post(`/api/pos/drafts/${printed.id}/cancel`, kasir, { reason: "Pelanggan batal" }))).toEqual([
      403,
      { error: "Nota sementara yang sudah dicetak hanya bisa dibatalkan dengan persetujuan admin. Minta persetujuan admin.", approval: { kind: "cancel_printed_draft" } },
    ]);
    expect((await post(`/api/pos/drafts/${printed.id}/cancel`, kasir, { reason: "Pelanggan batal", approval: { pin: PIN } })).status).toBe(200);
    const [cancel] = await audits(printed.id, "pos.draft.cancel");
    expect(cancel).toMatchObject({ reason: "Pelanggan batal", after: { status: "cancelled", printCount: 1 } });
    expect(cancel!.approvalId).not.toBeNull();
    expect(await json(await post(`/api/pos/drafts/${printed.id}/cancel`, admin, { reason: "Lagi" }))).toEqual([409, { error: `Nota sementara ${printed.number} sudah dibatalkan` }]);

    const unprinted = await createDraft(kasir, 1);
    expect(await json(await post("/api/approvals", kasir, { action: "pos.draft.cancel", draftId: unprinted.id }))).toEqual([
      422,
      { error: "Transaksi ini tidak butuh persetujuan admin" },
    ]);
  });

  it("is paid as a normal sale under the payer's shift and limits, and turns paid once", async () => {
    const draft = await createDraft(kasir, 2);
    const shift2 = await openShift(kasir2, 0);
    const stockBefore = await stockOf();

    const overCap = { ...sale(shift2, 2), discount: { kind: "percent", value: 1_000 }, total: 18_000, tendered: 18_000 };
    expect(await json(await post(`/api/pos/drafts/${draft.id}/pay`, kasir2, overCap))).toEqual([
      403,
      { error: "Diskon 10% melebihi batas kasir 5% per nota. Minta persetujuan admin.", approval: { kind: "discount" } },
    ]);

    const paid = sale(shift2, 4);
    expect((await post(`/api/pos/drafts/${draft.id}/pay`, kasir2, paid)).status).toBe(201);
    expect(await json(await call(`/api/pos/drafts/${draft.id}`, { cookie: kasir }))).toEqual([
      200,
      expect.objectContaining({ status: "paid", saleId: paid.id, saleNumber: paid.number, total: 40_000 }),
    ]);
    expect(await getSale(paid.id)).toMatchObject({ draftNumber: draft.number, shiftId: shift2 });
    expect(await stockOf()).toBe(stockBefore - 4);
    expect(await audits(draft.id, "pos.draft.update")).toHaveLength(1);
    expect(await audits(draft.id, "pos.draft.pay")).toHaveLength(1);

    const again = sale(shift2, 4);
    expect(await json(await post(`/api/pos/drafts/${draft.id}/pay`, kasir2, again))).toEqual([409, { error: `Nota sementara ${draft.number} sudah dibayar` }]);
    expect(await db.select().from(posSales).where(eq(posSales.id, again.id))).toEqual([]);
    expect((await db.select().from(posDrafts).where(eq(posDrafts.id, draft.id)))[0]!.status).toBe("paid");
    expect((await post(`/api/pos/drafts/${draft.id}/cancel`, kasir, { reason: "x" })).status).toBe(409);
    await closeShift(kasir2, shift2);
  });
});
