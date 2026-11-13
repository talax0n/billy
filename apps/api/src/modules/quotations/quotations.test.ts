import { addDays, businessDate, docPeriod, rupiah } from "@billy/core";
import { auditEvents, cashEntries, contacts, products, quotations, settings, stockMovements } from "@billy/db";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";
import { periodTotals } from "../insights/service.ts";

const { call, signIn, db } = await createTestApp();
const PIN = "975310";
let admin: string;
let staff: string;
let kasir: string;
let customer: string;
let cat: string;
const today = businessDate();

beforeAll(async () => {
  ({ cookie: admin } = await signIn("admin"));
  ({ cookie: staff } = await signIn("staff"));
  ({ cookie: kasir } = await signIn("kasir"));
  await db.insert(settings).values({ shopName: "Toko Uji", receiptFooter: "", posDeviceCode: "K1" });
  [{ id: customer }] = (await db.insert(contacts).values({ code: "C1", name: "Pelanggan Uji", kind: "customer" }).returning({ id: contacts.id })) as [{ id: string }];
  [{ id: cat }] = (await db
    .insert(products)
    .values({ name: "Cat", variant: "1 L", unit: "kaleng", sellPrice: rupiah(10_000), costPrice: rupiah(6_000) })
    .returning({ id: products.id })) as [{ id: string }];
  expect((await call("/api/approvals/pin", { method: "PUT", cookie: admin, body: { password: "rahasia123", pin: PIN } })).status).toBe(200);
});

const json = async (res: Response) => [res.status, await res.json()] as const;
const post = (path: string, cookie: string, body: unknown = {}) => call(path, { method: "POST", cookie, body });
const quote = (unitPrice: number, overrides: Record<string, unknown> = {}) => ({
  customerId: customer,
  date: today,
  validUntil: addDays(today, 14),
  discountKind: "none",
  discountValue: 0,
  note: "",
  lines: [{ productId: cat, qty: 5, unitPrice }],
  ...overrides,
});
async function create(body: object) {
  const [status, row] = await json(await post("/api/quotations", staff, body));
  expect(status).toBe(201);
  return row as { id: string; number: string; total: number; status: string };
}
const convert = (id: string, cookie: string, extra: Record<string, unknown> = {}) =>
  post(`/api/quotations/${id}/convert`, cookie, { date: today, termsDays: 14, ...extra });

describe("penawaran harga", () => {
  it("is numbered Q-, moves no stock or money, and is in no total", async () => {
    const before = await periodTotals(db, { from: today, to: today });
    const q = await create(quote(10_000));
    expect(q).toMatchObject({ number: `Q-${docPeriod(today)}-0001`, status: "draft", total: 50_000 });

    expect(await db.select().from(stockMovements).where(eq(stockMovements.sourceId, q.id))).toEqual([]);
    expect(await db.select().from(cashEntries).where(eq(cashEntries.sourceId, q.id))).toEqual([]);
    expect(await periodTotals(db, { from: today, to: today })).toEqual(before);
    expect(await json(await call("/api/sales", { cookie: staff }))).toEqual([200, expect.objectContaining({ total: 0 })]);
    expect(await json(await call("/api/sales/receivables", { cookie: staff }))).toEqual([200, expect.objectContaining({ rows: [] })]);
    expect((await call("/api/quotations", { cookie: kasir })).status).toBe(403);
  });

  it("derives expired from the valid-until date and refuses to convert it", async () => {
    const q = await create(quote(10_000));
    await db.update(quotations).set({ date: addDays(today, -20), validUntil: addDays(today, -1) }).where(eq(quotations.id, q.id));
    expect(await json(await call(`/api/quotations/${q.id}`, { cookie: staff }))).toEqual([200, expect.objectContaining({ status: "expired" })]);
    const list = (await (await call("/api/quotations?status=expired", { cookie: staff })).json()) as { rows: { id: string }[] };
    expect(list.rows.map((r) => r.id)).toEqual([q.id]);
    expect(await json(await convert(q.id, admin))).toEqual([409, { error: `Penawaran ${q.number} sudah kedaluwarsa` }]);
  });

  it("converts to a faktur linked both ways; a price below normal needs approval for staff", async () => {
    const cheap = await create(quote(9_000));
    expect(await json(await convert(cheap.id, staff))).toEqual([
      403,
      { error: "Harga penawaran di bawah harga jual normal atau modal butuh persetujuan admin. Minta persetujuan admin.", approval: { kind: "below_cost" } },
    ]);
    const res = await convert(cheap.id, staff, { approval: { pin: PIN } });
    const [status, invoice] = [res.status, (await res.json()) as { id: string; number: string }];
    expect(status).toBe(201);
    expect(invoice).toMatchObject({ number: expect.stringMatching(/^SO-/), total: 45_000, quotation: { id: cheap.id, number: cheap.number } });
    expect(await json(await call(`/api/quotations/${cheap.id}`, { cookie: staff }))).toEqual([
      200,
      expect.objectContaining({ status: "accepted", invoiceId: invoice.id, invoiceNumber: invoice.number }),
    ]);
    const [event] = await db.select().from(auditEvents).where(and(eq(auditEvents.entityId, cheap.id), eq(auditEvents.action, "quotation.convert")));
    expect(event!.approvalId).not.toBeNull();
    expect(await json(await convert(cheap.id, admin))).toEqual([409, { error: `Penawaran ${cheap.number} sudah dijadikan faktur` }]);

    const normal = await create(quote(10_000));
    expect((await convert(normal.id, staff)).status).toBe(201);
    const byAdmin = await create(quote(5_000));
    expect((await convert(byAdmin.id, admin)).status).toBe(201);
  });

  it("binds a remote approval to the quote's lines", async () => {
    const q = await create(quote(8_000));
    const asked = (await (await post("/api/approvals", staff, { action: "quotation.convert", quotationId: q.id, convert: { date: today, termsDays: 14 } })).json()) as { id: string };
    expect((await post(`/api/approvals/${asked.id}/approve`, admin)).status).toBe(200);
    await db.update(quotations).set({ lines: [{ productId: cat, qty: 5, unitPrice: rupiah(7_000), discountAmount: rupiah(0), note: "" }] }).where(eq(quotations.id, q.id));
    expect((await convert(q.id, staff, { approval: { id: asked.id } })).status).toBe(403);
  });

  it("moves draft → sent → rejected and then stays", async () => {
    const q = await create(quote(10_000));
    expect(await json(await post(`/api/quotations/${q.id}/status`, staff, { status: "sent" }))).toEqual([200, expect.objectContaining({ status: "sent" })]);
    expect(await json(await post(`/api/quotations/${q.id}/status`, staff, { status: "rejected" }))).toEqual([200, expect.objectContaining({ status: "rejected" })]);
    expect((await convert(q.id, admin)).status).toBe(409);
  });
});
