import { uuidv7 } from "@billy/core";
import { accounts, contacts, settings } from "@billy/db";
import ExcelJS from "exceljs";
import { beforeAll, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

/** One Rp100.000 sale of a Rp60.000 product with a Rp20.000 document discount, on each channel. */
const { db, call, signIn } = await createTestApp();
let cookie: string;
const date = "2026-11-13";
const query = `from=${date}&to=${date}`;

beforeAll(async () => {
  ({ cookie } = await signIn("admin"));
  await db.insert(settings).values({ shopName: "Toko Uji", receiptFooter: "", posDeviceCode: "K1" });
  const [{ id: accountId }] = (await db.insert(accounts).values({ code: "KAS", name: "Kas", kind: "cash" }).returning({ id: accounts.id })) as [{ id: string }];
  const [{ id: customerId }] = (await db
    .insert(contacts)
    .values({ code: "P-1", name: "Pelanggan", kind: "customer" })
    .returning({ id: contacts.id })) as [{ id: string }];
  const product = (await (
    await call("/api/products", {
      method: "POST",
      cookie,
      body: { code: "P1", barcode: null, name: "Cat", variant: "", unit: "kaleng", categoryId: null, sellPrice: 100_000, costPrice: 60_000, minStock: 0 },
    })
  ).json()) as { id: string };
  const invoice = await call("/api/sales", {
    method: "POST",
    cookie,
    body: {
      customerId,
      date,
      termsDays: 0,
      discountKind: "amount",
      discountValue: 20_000,
      note: "",
      lines: [{ productId: product.id, qty: 1, unitPrice: 100_000, note: "" }],
    },
  });
  expect(invoice.status).toBe(201);
  const sale = await call("/api/pos/sales", {
    method: "POST",
    cookie,
    body: {
      id: uuidv7(),
      number: "K1-261113-0001",
      soldAt: "2026-11-13T02:15:00.000Z",
      lines: [{ productId: product.id, qty: 1, unitPrice: 100_000 }],
      discount: { kind: "amount", value: 20_000 },
      method: "cash",
      accountId,
      tendered: 80_000,
      total: 80_000,
    },
  });
  expect(sale.status).toBe(201);
});

it("reports sales net of the document discount and profit after it", async () => {
  const body = (await (await call(`/api/insights/dashboard?${query}`, { cookie })).json()) as { current: object };
  expect(body.current).toMatchObject({ sales: 160_000, invoiceSales: 80_000, posSales: 80_000, profit: 40_000, margin: 25 });
});

it("exports the same sales and profit per document", async () => {
  const res = await call(`/api/reports/sales.xlsx?${query}`, { cookie });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await res.arrayBuffer());
  const rows = book.worksheets[0]!.getSheetValues().slice(2).map((row) => (row as unknown[]).slice(3, 6));
  expect(rows).toEqual([
    ["Kasir", 80_000, 20_000],
    ["Faktur", 80_000, 20_000],
  ]);
});
