import { accounts, categories, products, settings } from "@billy/db";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { app, call, signIn, db } = await createTestApp();
let admin: string;
let staff: string;
let dulux: string;

beforeAll(async () => {
  ({ cookie: admin } = await signIn("admin"));
  ({ cookie: staff } = await signIn("staff"));
  await db.insert(settings).values({ shopName: "Toko Uji", receiptFooter: "", posDeviceCode: "K1" });
  await db.insert(accounts).values({ code: "KAS", name: "Kas Toko", kind: "cash" });
  const [d, n] = await db.insert(categories).values([{ name: "Dulux" }, { name: "Nippon Paint" }]).returning({ id: categories.id });
  dulux = d!.id;
  await db.insert(products).values([
    { name: "CATYLAC EXTERIOR BASE A GALON", code: "CE-A-G", unit: "GALON", categoryId: dulux },
    { name: "CATYLAC EXTERIOR BASE A PAIL", unit: "PAIL", categoryId: dulux },
    { name: "WEATHERSHIELD BASE B", variant: "PAIL", unit: "PAIL", categoryId: dulux },
    { name: "DULUX TINTER", unit: "LITER", categoryId: dulux },
    { name: "DULUX TINTER", code: "TNT-2", unit: "LITER", categoryId: dulux },
    { name: "VINILEX 5000 PUTIH PAIL", unit: "PAIL", categoryId: n!.id },
  ]);
});

const startOpname = async () =>
  (await (await call("/api/opnames", { method: "POST", cookie: staff, body: { categoryId: dulux, note: "SPB Dulux" } })).json()) as { id: string };

const upload = (id: string, file: Blob, cookie = staff) => {
  const form = new FormData();
  form.append("file", file, "hitung.xlsx");
  return app.request(`/api/opnames/${id}/import`, { method: "POST", body: form, headers: { cookie } });
};

const xlsx = async (rows: (string | number | null)[][]) => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Sheet1").addRows(rows);
  return new Blob([await book.xlsx.writeBuffer()]);
};

const counted = async (id: string) =>
  ((await (await call(`/api/opnames/${id}/lines?filter=counted`, { cookie: staff })).json()) as { rows: { name: string; variant: string; countedQty: number }[] }).rows
    .map((r) => [`${r.name} ${r.variant}`.trim(), r.countedQty])
    .sort();

describe("stok opname from Excel", () => {
  it("hands out the opname's products and takes the filled template back", async () => {
    const { id } = await startOpname();
    const res = await call(`/api/opnames/${id}/template.xlsx`, { cookie: staff });
    expect(res.status).toBe(200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await res.arrayBuffer());
    expect(book.worksheets.map((w) => w.name)).toEqual(["Hitung opname", "Petunjuk"]);
    const sheet = book.worksheets[0]!;
    expect(sheet.getRow(1).values).toEqual([undefined, "ID", "Kode", "Nama barang", "Satuan", "Stok sistem", "Stok fisik"]);
    expect(sheet.getColumn(1).hidden).toBe(true);
    const names = Array.from({ length: sheet.rowCount - 1 }, (_, i) => sheet.getRow(i + 2).getCell(3).text);
    expect(names).toEqual(["CATYLAC EXTERIOR BASE A GALON", "CATYLAC EXTERIOR BASE A PAIL", "DULUX TINTER", "DULUX TINTER", "WEATHERSHIELD BASE B PAIL"]);

    sheet.getRow(2).getCell(6).value = 6;
    sheet.getRow(6).getCell(6).value = 3;
    const filled = await upload(id, new Blob([await book.xlsx.writeBuffer()]));
    expect(await filled.json()).toEqual({ applied: 2, skipped: [] });
    expect(await counted(id)).toEqual([
      ["CATYLAC EXTERIOR BASE A GALON", 6],
      ["WEATHERSHIELD BASE B PAIL", 3],
    ]);

    const again = await call(`/api/opnames/${id}/template.xlsx`, { cookie: staff });
    const reread = new ExcelJS.Workbook();
    await reread.xlsx.load(await again.arrayBuffer());
    expect(reread.worksheets[0]!.getRow(2).getCell(6).value).toBe(6);
  });

  it("matches a hand-made sheet by code or name and explains every row it skips", async () => {
    const { id } = await startOpname();
    const res = await upload(
      id,
      await xlsx([
        ["Hitungan SPB Dulux 19/11"],
        ["Nama barang", "Kode", "Stok fisik"],
        ["catylac exterior base a pail", null, 4],
        ["salah nama", "ce-a-g", 9],
        ["DULUX TINTER", null, 2],
        ["DULUX TINTER", "TNT-2", 5],
        ["VINILEX 5000 PUTIH PAIL", null, 1],
        ["WEATHERSHIELD BASE B PAIL", null, "dua"],
        ["CATYLAC EXTERIOR BASE A PAIL", null, 8],
        ["WEATHERSHIELD BASE B", null, null],
      ]),
    );
    expect(await res.json()).toEqual({
      applied: 3,
      skipped: [
        { row: 5, reason: 'Nama "DULUX TINTER" dipakai beberapa barang; isi Kode' },
        { row: 7, reason: '"VINILEX 5000 PUTIH PAIL" tidak ada di cakupan opname ini' },
        { row: 8, reason: 'Stok fisik "dua" bukan bilangan bulat 0 atau lebih' },
        { row: 9, reason: "Barang yang sama sudah ada di baris 3" },
      ],
    });
    expect(await counted(id)).toEqual([
      ["CATYLAC EXTERIOR BASE A GALON", 9],
      ["CATYLAC EXTERIOR BASE A PAIL", 4],
      ["DULUX TINTER", 5],
    ]);
  });

  it("refuses a file that is not the template, and a posted opname", async () => {
    const { id } = await startOpname();
    const legacy = await upload(id, await xlsx([["DULUX WEATHERSHIELD"], [], ["BASE A", "2,5 LITER"], [], ["TANGGAL", "MASUK", "KELUAR", "STOCK"]]));
    expect(legacy.status).toBe(422);
    expect(((await legacy.json()) as { error: string }).error).toContain('Kolom "Stok fisik"');
    expect((await upload(id, new Blob(["bukan excel"]))).status).toBe(422);

    await upload(id, await xlsx([["Nama barang", "Stok fisik"], ["DULUX TINTER", 1], ["CATYLAC EXTERIOR BASE A PAIL", 2]]));
    await call(`/api/opnames/${id}/post`, { method: "POST", cookie: admin });
    expect((await upload(id, await xlsx([["Nama barang", "Stok fisik"], ["CATYLAC EXTERIOR BASE A PAIL", 3]]))).status).toBe(409);
  });
});
