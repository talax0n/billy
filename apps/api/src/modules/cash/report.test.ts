import { cashEntries, users } from "@billy/db";
import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "../../testing.ts";

const { call, db, signIn } = await createTestApp();
let cookie: string;
let kas: string;
let bca: string;

type Json = Record<string, any>;
const post = async (path: string, body: object) => {
  const res = await call(path, { method: "POST", cookie, body });
  expect(res.status).toBeLessThan(300);
  return (await res.json()) as Json;
};
const report = async (query: Record<string, string>) => {
  const res = await call(`/api/cash/report?${new URLSearchParams(query)}`, { cookie });
  return { status: res.status, body: (await res.json()) as Json };
};

beforeAll(async () => {
  ({ cookie } = await signIn("admin"));
  kas = (await post("/api/accounts", { code: "KAS", name: "Kas", kind: "cash" })).id;
  bca = (await post("/api/accounts", { code: "BCA", name: "BCA", kind: "bank" })).id;
  const entry = (accountId: string, date: string, direction: "in" | "out", amount: number, note: string) =>
    post("/api/cash/entries", { accountId, date, direction, amount, note });
  // Before the period: Kas opens at 1.000.000 - 200.000 = 800.000.
  await entry(kas, "2026-10-20", "in", 1_000_000, "Modal awal");
  await entry(kas, "2026-10-31", "out", 200_000, "Bon lama");
  // November.
  await entry(kas, "2026-11-02", "in", 500_000, "Setoran");
  await entry(bca, "2026-11-03", "in", 2_000_000, "Transfer pelanggan");
  await post("/api/cash/transfers", { fromAccountId: kas, toAccountId: bca, date: "2026-11-05", amount: 300_000, note: "Setor bank" });
  await post("/api/expenses", { date: "2026-11-07", accountId: kas, category: "Listrik", description: "PLN", amount: 150_000, proofUrl: "" });
  await entry(kas, "2026-11-09", "out", 50_000, "Parkir");
  // After the period.
  await entry(kas, "2026-12-01", "in", 999_000, "Desember");
});

const november = { from: "2026-11-01", to: "2026-11-30" };

describe("Laporan Kas", () => {
  it("lists every account's movements of the period, oldest first, with totals masuk and keluar", async () => {
    const { status, body } = await report(november);
    expect(status).toBe(200);
    const rows = body.rows.map((r: Json) => [r.date, r.accountName, r.direction, r.amount]);
    // The transfer's two legs share a date and a timestamp, so either may come first.
    expect([rows.slice(0, 2), rows.slice(4)]).toEqual([
      [
        ["2026-11-02", "Kas", "in", 500_000],
        ["2026-11-03", "BCA", "in", 2_000_000],
      ],
      [
        ["2026-11-07", "Kas", "out", 150_000],
        ["2026-11-09", "Kas", "out", 50_000],
      ],
    ]);
    expect(rows.slice(2, 4)).toEqual(
      expect.arrayContaining([
        ["2026-11-05", "Kas", "out", 300_000],
        ["2026-11-05", "BCA", "in", 300_000],
      ]),
    );
    expect(body).toMatchObject({ total: 6, totalIn: 2_800_000, totalOut: 500_000, opening: null, closing: null });
    expect(body.rows.every((r: Json) => r.balance === null)).toBe(true);
    expect(body.rows[4]).toMatchObject({ sourceType: "expense", documentNumber: expect.stringMatching(/^BY-261107-/) });
  });

  it("runs one account's balance from the opening balance before the period", async () => {
    const { body } = await report({ ...november, accountId: kas });
    expect(body.opening).toBe(800_000);
    expect(body.rows.map((r: Json) => r.balance)).toEqual([1_300_000, 1_000_000, 850_000, 800_000]);
    expect(body).toMatchObject({ total: 4, totalIn: 500_000, totalOut: 500_000, closing: 800_000 });
  });

  it("keeps the account's real balance on rows left after a source filter", async () => {
    const { body } = await report({ ...november, accountId: kas, sourceType: "expense" });
    expect(body.rows.map((r: Json) => [r.amount, r.balance])).toEqual([[150_000, 850_000]]);
    expect(body).toMatchObject({ total: 1, totalIn: 0, totalOut: 150_000, opening: 800_000, closing: 800_000 });
  });

  it("pages on the server while the totals cover every matching row", async () => {
    const first = await report({ ...november, pageSize: "4", page: "1" });
    const second = await report({ ...november, pageSize: "4", page: "2" });
    expect(first.body.rows).toHaveLength(4);
    expect(second.body.rows.map((r: Json) => r.amount)).toEqual([150_000, 50_000]);
    for (const page of [first, second]) expect(page.body).toMatchObject({ total: 6, totalIn: 2_800_000, totalOut: 500_000 });
  });

  it("refuses a period that ends before it starts", async () => {
    expect((await report({ from: "2026-11-30", to: "2026-11-01" })).status).toBe(400);
  });
});

describe("Ekspor Laporan Kas", () => {
  const download = (query: Record<string, string>) => call(`/api/cash/report.xlsx?${new URLSearchParams(query)}`, { cookie });

  it("exports the whole filtered report as an .xlsx with typed cells and a totals row", async () => {
    const res = await download({ ...november, accountId: kas });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="laporan-kas-2026-11-01_2026-11-30.xlsx"');

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await res.arrayBuffer());
    const sheet = book.getWorksheet("Laporan Kas")!;
    const values = (row: number) => (sheet.getRow(row).values as unknown[]).slice(1);
    expect(values(1)).toEqual(["Tanggal", "Akun", "Sumber", "Dokumen", "Keterangan", "Masuk", "Keluar", "Saldo"]);
    // Opening row, four movements, totals row.
    expect(sheet.rowCount).toBe(7);
    expect(sheet.getCell("A2").value).toEqual(new Date("2026-11-01T00:00:00Z"));
    expect(sheet.getCell("H2").value).toBe(800_000);
    const expense = sheet.getRow(5);
    expect(expense.getCell(1).type).toBe(ExcelJS.ValueType.Date);
    expect(expense.getCell(1).value).toEqual(new Date("2026-11-07T00:00:00Z"));
    expect(expense.getCell(3).value).toBe("Biaya");
    expect(expense.getCell(7).type).toBe(ExcelJS.ValueType.Number);
    expect(expense.getCell(7).value).toBe(150_000);
    expect(expense.getCell(8).value).toBe(850_000);
    const totals = sheet.getRow(7);
    expect([totals.getCell(6).value, totals.getCell(7).value, totals.getCell(8).value]).toEqual([500_000, 500_000, 800_000]);
    expect(totals.font?.bold).toBe(true);
  });

  it("exports more rows than one page, without a balance column across accounts", async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await (await download(november)).arrayBuffer());
    const sheet = book.getWorksheet("Laporan Kas")!;
    expect(sheet.columnCount).toBe(7);
    expect(sheet.rowCount).toBe(1 + 6 + 1);
    expect([sheet.getCell("F8").value, sheet.getCell("G8").value]).toEqual([2_800_000, 500_000]);
  });

  it("refuses an export past 50.000 rows with a clear message", async () => {
    const [admin] = await db.select({ id: users.id }).from(users);
    await db.execute(sql`
      insert into ${cashEntries} (id, account_id, date, direction, amount, category, source_type, note, created_by)
      select gen_random_uuid(), ${bca}, date '2025-01-01', 'in', 1000, 'other_in', 'manual', 'massal', ${admin!.id}
      from generate_series(1, 50001)`);
    const res = await download({ from: "2025-01-01", to: "2025-01-01" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error).toBe(
      "Laporan ini berisi 50.001 baris, melebihi batas ekspor 50.000 baris. Persempit periode atau filter.",
    );
    // The screen still pages through it.
    expect((await report({ from: "2025-01-01", to: "2025-01-01", pageSize: "10" })).body).toMatchObject({ total: 50_001 });
  });
});
