import { uuidv7 } from "@billy/core";
import { accounts, contacts, posLines, products, salesLines, settings } from "@billy/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

/**
 * Cost at time of sale (data-model ground rule 8): the net unit cost of the product's latest
 * non-voided purchase line dated on or before the sale, else `products.cost_price`.
 * Cat Tembok: master cost 50.000, bought 1 Nov at 55.000 and 10 Nov at 2 × 60.000 − 2.000 line
 * discount (59.000 net).
 */
const { db, call, signIn } = await createTestApp();
let staff: string;
let product: string;
let untouched: string;
let supplierId: string;
let customerId: string;
let accountId: string;
let lateId: string;

const purchase = async (date: string, productId: string, qty: number, unitCost: number, discountAmount = 0) => {
  const res = await call("/api/purchases", {
    method: "POST",
    cookie: staff,
    body: {
      supplierId,
      supplierInvoiceNumber: "",
      date,
      termsDays: 30,
      discountKind: "none",
      discountValue: 0,
      taxRateBp: 0,
      note: "",
      lines: [{ productId, qty, unitCost, discountAmount, note: "" }],
    },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
};

const newProduct = async (code: string) =>
  ((await (
    await call("/api/products", {
      method: "POST",
      cookie: staff,
      body: { code, barcode: null, name: `Cat ${code}`, variant: "", unit: "pail", categoryId: null, sellPrice: 80_000, costPrice: 50_000, minStock: 0 },
    })
  ).json()) as { id: string }).id;

const costPrice = async (id: string) => (await db.select({ c: products.costPrice }).from(products).where(eq(products.id, id)))[0]!.c;

beforeAll(async () => {
  ({ cookie: staff } = await signIn("staff"));
  await db.insert(settings).values({ shopName: "Toko Uji", receiptFooter: "", posDeviceCode: "K1" });
  [{ id: accountId }] = (await db.insert(accounts).values({ code: "KAS", name: "Kas", kind: "cash" }).returning({ id: accounts.id })) as [{ id: string }];
  [{ id: supplierId }, { id: customerId }] = (await db
    .insert(contacts)
    .values([
      { code: "S-1", name: "Pemasok", kind: "supplier" },
      { code: "P-1", name: "Pelanggan", kind: "customer" },
    ])
    .returning({ id: contacts.id })) as [{ id: string }, { id: string }];
  product = await newProduct("CT");
  untouched = await newProduct("UT");
  await purchase("2026-11-01", product, 4, 55_000);
  lateId = await purchase("2026-11-10", product, 2, 60_000, 2_000);
});

const invoiceOn = async (date: string, productId: string) => {
  const res = await call("/api/sales", {
    method: "POST",
    cookie: staff,
    body: { customerId, date, termsDays: 0, discountKind: "none", discountValue: 0, note: "", lines: [{ productId, qty: 1, unitPrice: 80_000, note: "" }] },
  });
  const { id } = (await res.json()) as { id: string };
  return (await db.select({ c: salesLines.unitCost }).from(salesLines).where(eq(salesLines.invoiceId, id)))[0]!.c;
};

let n = 0;
const posSaleAt = async (soldAt: string, productId: string) => {
  const id = uuidv7();
  const res = await call("/api/pos/sales", {
    method: "POST",
    cookie: staff,
    body: {
      id,
      number: `K1-261105-${String(++n).padStart(4, "0")}`,
      soldAt,
      lines: [{ productId, qty: 1, unitPrice: 80_000 }],
      discount: { kind: "none", value: 0 },
      method: "cash",
      accountId,
      tendered: 80_000,
      total: 80_000,
    },
  });
  expect(res.status).toBe(201);
  return (await db.select({ c: posLines.unitCost }).from(posLines).where(eq(posLines.saleId, id)))[0]!.c;
};

describe("cost at time of sale", () => {
  it("snapshots a sales invoice at the cost of the latest purchase on or before its date", async () => {
    expect([await invoiceOn("2026-11-05", product), await invoiceOn("2026-11-10", product), await invoiceOn("2026-10-30", product)]).toEqual([
      55_000, 59_000, 59_000,
    ]);
  });

  it("snapshots an offline POS sale at the cost on the day it was sold, not when it synced", async () => {
    // 5 Nov 09:00 in Jakarta; the 10 Nov purchase was posted before this upload.
    expect(await posSaleAt("2026-11-05T02:00:00.000Z", product)).toBe(55_000);
  });

  it("falls back to products.cost_price for a product never purchased", async () => {
    expect([await invoiceOn("2026-11-05", untouched), await posSaleAt("2026-11-05T02:00:00.000Z", untouched)]).toEqual([50_000, 50_000]);
  });

  it("restores products.cost_price from the latest remaining purchase when one is voided", async () => {
    expect(await costPrice(product)).toBe(59_000);
    const res = await call(`/api/purchases/${lateId}/void`, { method: "POST", cookie: staff, body: { reason: "Salah input" } });
    expect(res.status).toBe(200);
    expect(await costPrice(product)).toBe(55_000);
  });

  it("keeps products.cost_price when no purchase remains", async () => {
    const only = await newProduct("ON");
    const id = await purchase("2026-11-02", only, 1, 70_000);
    await call(`/api/purchases/${id}/void`, { method: "POST", cookie: staff, body: { reason: "Salah input" } });
    expect(await costPrice(only)).toBe(70_000);
  });
});
