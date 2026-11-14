import { rupiah } from "@billy/core";
import { contacts, products } from "@billy/db";
import ExcelJS from "exceljs";
import { beforeAll, expect, it } from "vitest";
import { createTestApp } from "../testing.ts";

const { call, db, signIn } = await createTestApp();
let cookie: string;
let paint: string;
let customer: string;
let supplier: string;

type Json = Record<string, any>;
const post = async (path: string, body: object) => {
  const res = await call(path, { method: "POST", cookie, body });
  expect(res.status).toBeLessThan(300);
  return (await res.json()) as Json;
};
async function sheetOf(path: string) {
  const res = await call(path, { cookie });
  expect(res.status).toBe(200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await res.arrayBuffer());
  return { sheet: book.worksheets[0]!, fileName: res.headers.get("content-disposition") };
}

beforeAll(async () => {
  ({ cookie } = await signIn("admin"));
  const kas = (await post("/api/accounts", { code: "KAS", name: "Kas", kind: "cash" })).id;
  [{ id: customer }, { id: supplier }] = (await db
    .insert(contacts)
    .values([
      { code: "P-001", name: "Pelanggan Satu", kind: "customer" },
      { code: "S-001", name: "Pemasok Satu", kind: "supplier" },
    ])
    .returning({ id: contacts.id })) as [{ id: string }, { id: string }];
  [{ id: paint }] = (await db
    .insert(products)
    .values({ name: "Cat Tembok", variant: "5 kg", unit: "pail", sellPrice: rupiah(185_000), costPrice: rupiah(150_000) })
    .returning({ id: products.id })) as [{ id: string }];
  const invoice = (qty: number, date: string) => ({
    customerId: customer,
    date,
    termsDays: 30,
    discountKind: "none",
    discountValue: 0,
    note: "",
    lines: [{ productId: paint, qty, unitPrice: 185_000 }],
  });
  await post("/api/sales", { ...invoice(2, "2026-11-02"), payment: { accountId: kas, amount: 100_000, method: "cash" } });
  const voided = await post("/api/sales", invoice(1, "2026-11-03"));
  await post(`/api/sales/${voided.id}/void`, { reason: "Batal" });
  await post("/api/purchases", {
    supplierId: supplier,
    supplierInvoiceNumber: "INV-9",
    date: "2026-11-04",
    termsDays: 30,
    discountKind: "none",
    discountValue: 0,
    taxRateBp: 0,
    note: "",
    lines: [{ productId: paint, qty: 10, unitCost: 150_000, discountAmount: 0, note: "" }],
    payment: { accountId: kas, date: "2026-11-04", amount: 500_000, method: "transfer", note: "" },
  });
});

it("exports the filtered Penjualan list with typed cells and totals that leave out void invoices", async () => {
  const { sheet, fileName } = await sheetOf("/api/sales/export.xlsx?from=2026-11-01&to=2026-11-30");
  expect(fileName).toBe('attachment; filename="penjualan-2026-11-01_2026-11-30.xlsx"');
  expect(sheet.rowCount).toBe(1 + 2 + 1);
  expect(sheet.getCell("A2").type).toBe(ExcelJS.ValueType.Date);
  expect(sheet.getCell("A2").value).toEqual(new Date("2026-11-02T00:00:00Z"));
  expect([sheet.getCell("E2").value, sheet.getCell("F2").value, sheet.getCell("G2").value, sheet.getCell("H2").value]).toEqual([
    "Sebagian",
    370_000,
    100_000,
    270_000,
  ]);
  expect(sheet.getCell("E3").value).toBe("Dibatalkan");
  expect([sheet.getCell("B4").value, sheet.getCell("F4").value, sheet.getCell("H4").value]).toEqual(["1 faktur, tanpa void", 370_000, 270_000]);
});

it("exports the Pembelian list, its file name open-ended when the period is", async () => {
  const { sheet, fileName } = await sheetOf("/api/purchases/export.xlsx");
  expect(fileName).toBe('attachment; filename="pembelian-awal_akhir.xlsx"');
  expect(sheet.getRow(2).values).toEqual([
    undefined,
    new Date("2026-11-04T00:00:00Z"),
    expect.stringMatching(/^PO-261104-/),
    "INV-9",
    "Pemasok Satu",
    new Date("2026-12-04T00:00:00Z"),
    "Sebagian",
    1_500_000,
    500_000,
    1_000_000,
  ]);
  expect([sheet.getCell("G3").value, sheet.getCell("H3").value, sheet.getCell("I3").value]).toEqual([1_500_000, 500_000, 1_000_000]);
});
