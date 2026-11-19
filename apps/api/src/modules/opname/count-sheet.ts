import { COUNT_SHEET_NAME, countSheetColumns, type CountSheetIssue, DomainError, readCountSheet, type SheetCell } from "@billy/core";
import { type Db, stockOpnames } from "@billy/db";
import { asc, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import type { Actor } from "../../env.ts";
import { opnameLines, saveCounts } from "./service.ts";

/** 5 MB holds tens of thousands of rows; anything bigger is not a count sheet. */
export const MAX_COUNT_SHEET_BYTES = 5 * 1024 * 1024;

async function findOpname(db: Db, id: string) {
  const [opname] = await db.select().from(stockOpnames).where(eq(stockOpnames.id, id));
  if (!opname) throw new DomainError("not_found", "Stok opname tidak ditemukan");
  return opname;
}

/** The opname's products in the accepted layout, Stok fisik prefilled with what is already counted, plus a Petunjuk sheet. */
export async function countTemplate(db: Db, id: string) {
  const opname = await findOpname(db, id);
  const lines = opnameLines(db, opname);
  const rows = await db
    .select({ id: lines.id, code: lines.code, name: lines.name, variant: lines.variant, unit: lines.unit, systemQty: lines.systemQty, countedQty: lines.countedQty })
    .from(lines)
    .orderBy(asc(lines.name));

  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(COUNT_SHEET_NAME, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = countSheetColumns.map((c) => ({ header: c.header, width: c.width }));
  sheet.getColumn(1).hidden = true;
  sheet.getRow(1).font = { bold: true };
  sheet.addRows(rows.map((r) => [r.id, r.code, `${r.name} ${r.variant}`.trim(), r.unit, r.systemQty, r.countedQty]));

  const help = book.addWorksheet("Petunjuk");
  help.columns = [{ width: 16 }, { width: 100 }];
  help.addRows([
    [`Template stok opname ${opname.number}`],
    ["Isi kolom Stok fisik di sheet pertama, lalu unggah lewat tombol Impor Excel di halaman opname."],
    ["Urutan kolom bebas dan kolom lain diabaikan. Baris judul boleh ada di atas, asal baris kolom ada di 10 baris teratas."],
    [],
    ["Kolom", "Keterangan"],
    ...countSheetColumns.map((c) => [c.header, c.note]),
  ]);
  help.getRow(1).font = { bold: true };
  help.getRow(5).font = { bold: true };
  return { number: opname.number, body: new Uint8Array(await book.xlsx.writeBuffer()) };
}

/** A cell as Excel shows it: formulas by their result, rich text and links by their text. */
function cellValue(value: ExcelJS.CellValue): SheetCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean" || value instanceof Date) return String(value);
  if ("result" in value) return cellValue(value.result as ExcelJS.CellValue);
  if ("richText" in value) return value.richText.map((t) => t.text).join("");
  if ("text" in value) return String(value.text);
  return null;
}

async function firstSheetCells(file: ArrayBuffer): Promise<SheetCell[][]> {
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(file);
  } catch {
    throw new DomainError("invalid", "File tidak bisa dibaca. Simpan sebagai .xlsx lalu unggah lagi.");
  }
  const sheet = book.worksheets[0];
  if (!sheet) throw new DomainError("invalid", "File Excel tidak punya sheet");
  return sheetCells(sheet);
}

/** Every row of a sheet as cell values, row 1 first. */
export function sheetCells(sheet: ExcelJS.Worksheet): SheetCell[][] {
  const cells: SheetCell[][] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    cells.push(Array.from({ length: row.cellCount }, (_, c) => cellValue(row.getCell(c + 1).value)));
  }
  return cells;
}

const lower = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Fills a draft's counts from an uploaded sheet. Each row is matched by ID, then Kode, then exact
 * Nama barang, among the products this opname covers. Matched rows are saved like typed counts;
 * the rest come back with their Excel row and reason, so nothing is skipped silently.
 */
export async function importCounts(db: Db, id: string, file: File, actor: Actor) {
  if (file.size > MAX_COUNT_SHEET_BYTES) throw new DomainError("invalid", "File terlalu besar, maksimal 5 MB");
  const opname = await findOpname(db, id);
  if (opname.status === "posted") throw new DomainError("conflict", `Opname ${opname.number} sudah diposting dan tidak bisa diubah`);
  const { rows, issues } = readCountSheet(await firstSheetCells(await file.arrayBuffer()));

  const lines = opnameLines(db, opname);
  const known = await db.select({ id: lines.id, code: lines.code, name: lines.name, variant: lines.variant }).from(lines);
  const byId = new Map(known.map((p) => [p.id, p.id]));
  const byCode = new Map(known.filter((p) => p.code).map((p) => [lower(p.code!), p.id]));
  const byName = new Map<string, string[]>();
  for (const p of known) {
    for (const name of new Set([lower(p.name), lower(`${p.name} ${p.variant}`)])) byName.set(name, [...(byName.get(name) ?? []), p.id]);
  }

  const skipped: CountSheetIssue[] = [...issues];
  const seenAt = new Map<string, number>();
  const counts: { productId: string; countedQty: number }[] = [];
  for (const row of rows) {
    const named = row.name ? [...new Set(byName.get(lower(row.name)) ?? [])] : [];
    const productId = (row.id && byId.get(row.id)) || (row.code && byCode.get(lower(row.code))) || (named.length === 1 ? named[0] : undefined);
    if (!productId) {
      skipped.push({
        row: row.row,
        reason: named.length > 1 ? `Nama "${row.name}" dipakai beberapa barang; isi Kode` : `"${row.name ?? row.code ?? row.id}" tidak ada di cakupan opname ini`,
      });
      continue;
    }
    const earlier = seenAt.get(productId);
    if (earlier !== undefined) {
      skipped.push({ row: row.row, reason: `Barang yang sama sudah ada di baris ${earlier}` });
      continue;
    }
    seenAt.set(productId, row.row);
    counts.push({ productId, countedQty: row.qty });
  }

  if (counts.length) await saveCounts(db, id, { lines: counts }, actor);
  return { applied: counts.length, skipped: skipped.sort((a, b) => a.row - b.row) };
}

