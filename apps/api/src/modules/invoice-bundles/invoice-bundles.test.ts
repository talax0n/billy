import { businessDate, rupiah } from "@billy/core";
import { accounts, contacts, products } from "@billy/db";
import { beforeAll, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { db, call, signIn } = await createTestApp();
const today = businessDate();
let cookie: string;
let customerId: string;
let otherCustomerId: string;
let accountId: string;
let productId: string;

type Json = Record<string, any>;

async function post(path: string, body: object = {}) {
  const res = await call(path, { method: "POST", cookie, body });
  return { status: res.status, body: (await res.json()) as Json };
}

const sell = async (customer: string, qty: number) =>
  (
    await post("/api/sales", {
      customerId: customer,
      date: today,
      termsDays: 14,
      discountKind: "none",
      discountValue: 0,
      lines: [{ productId, qty, unitPrice: 100_000 }],
    })
  ).body;

beforeAll(async () => {
  ({ cookie } = await signIn("admin"));
  const [a, b] = await db
    .insert(contacts)
    .values([
      { code: "P-001", name: "Toko Bangunan Makmur", kind: "customer" },
      { code: "P-002", name: "CV Lain", kind: "customer" },
    ])
    .returning();
  const [account] = await db.insert(accounts).values({ code: "KAS", name: "Kas Toko", kind: "cash" }).returning();
  const [product] = await db
    .insert(products)
    .values({ name: "Kilau Enamel", unit: "kaleng", sellPrice: rupiah(100_000), costPrice: rupiah(80_000) })
    .returning();
  customerId = a!.id;
  otherCustomerId = b!.id;
  accountId = account!.id;
  productId = product!.id;
});

it("bundles a customer's open invoices and rejects paid, voided, foreign or already bundled ones", async () => {
  const first = await sell(customerId, 2);
  const second = await sell(customerId, 3);
  const paid = await sell(customerId, 1);
  await post(`/api/sales/${paid.id}/payments`, { accountId, amount: 100_000, method: "cash", date: today });
  const voided = await sell(customerId, 1);
  await post(`/api/sales/${voided.id}/void`, { reason: "Batal" });
  const foreign = await sell(otherCustomerId, 1);
  await post(`/api/sales/${second.id}/payments`, { accountId, amount: 50_000, method: "cash", date: today });

  for (const bad of [paid.id, voided.id, foreign.id]) {
    const res = await post("/api/invoice-bundles", { customerId, date: today, invoiceIds: [first.id, bad] });
    expect(res.status).toBe(422);
  }

  const created = await post("/api/invoice-bundles", { customerId, date: today, note: "Diserahkan ke Pak Budi", invoiceIds: [first.id, second.id] });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({
    number: expect.stringMatching(/^TF-\d{6}-0001$/),
    customer: { name: "Toko Bangunan Makmur" },
    total: 500_000,
    outstanding: 450_000,
    voidedAt: null,
  });
  expect(created.body.invoices.map((i: Json) => i.number)).toEqual([second.number, first.number].sort());

  const again = await post("/api/invoice-bundles", { customerId, date: today, invoiceIds: [first.id] });
  expect(again).toEqual({ status: 409, body: { error: `Sebagian faktur sudah ada di ${created.body.number}` } });

  const list = (await (await call("/api/invoice-bundles?q=makmur", { cookie })).json()) as Json;
  expect(list).toMatchObject({ total: 1, rows: [{ number: created.body.number, invoiceCount: 2, total: 500_000, outstanding: 450_000 }] });

  const voidRes = await post(`/api/invoice-bundles/${created.body.id}/void`);
  expect(voidRes.status).toBe(200);
  expect(voidRes.body.voidedAt).not.toBeNull();
  expect((await post(`/api/invoice-bundles/${created.body.id}/void`)).status).toBe(409);
  expect((await post("/api/invoice-bundles", { customerId, date: today, invoiceIds: [first.id] })).status).toBe(201);
});

it("refuses the kasir role", async () => {
  const kasir = await signIn("kasir");
  expect((await call("/api/invoice-bundles", { cookie: kasir.cookie })).status).toBe(403);
});
