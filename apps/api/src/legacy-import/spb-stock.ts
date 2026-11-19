/**
 * One-time move of the shop's SPB stock sheets (one Excel per brand, a TANGGAL | MASUK | KELUAR | STOCK
 * block per variant) into billy. Reads billy's products (read only) and writes, per brand file, a sheet in
 * the layout Stok Opname "Impor Excel" accepts, plus two review columns the import ignores:
 * "Dari sheet SPB" (where the figure came from) and "Kecocokan" (pasti, cek, tidak ketemu).
 * Check every "cek" and "tidak ketemu" row (fix Nama barang, or clear Stok fisik to skip it), then
 * upload the file into a draft opname for that brand.
 *
 *   DATABASE_URL=postgresql://localhost/billy_prod pnpm --filter @billy/api spb:stock <out-dir> <brand.xlsx>...
 */
import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { brandOf, COUNT_SHEET_NAME, countSheetColumns } from "@billy/core";
import { createDb, products } from "@billy/db";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { sheetCells } from "../modules/opname/count-sheet.ts";
import { bestMatch, spbBlocks } from "./spb-stock-parse.ts";

const [outDir, ...files] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !outDir || files.length === 0) {
  console.error("Pakai: DATABASE_URL=... pnpm --filter @billy/api spb:stock <folder-hasil> <file-brand.xlsx>...");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const { db, close } = await createDb({ url: process.env.DATABASE_URL });
const catalog = await db
  .select({ id: products.id, code: products.code, name: products.name, variant: products.variant, unit: products.unit })
  .from(products)
  .where(eq(products.active, true));
await close();
const named = catalog.map((p) => ({ ...p, name: `${p.name} ${p.variant}`.trim() }));

for (const file of files) {
  const source = new ExcelJS.Workbook();
  await source.xlsx.readFile(file);
  const blocks = source.worksheets.flatMap((sheet) => spbBlocks(sheet.name, sheetCells(sheet)));

  // The file's brand is the one most of its labels name; candidates are that brand's products.
  const votes = new Map<string, number>();
  for (const b of blocks) {
    const brand = brandOf(b.label);
    if (brand) votes.set(brand, (votes.get(brand) ?? 0) + 1);
  }
  const brand = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const candidates = brand ? named.filter((p) => brandOf(p.name) === brand) : named;

  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(COUNT_SHEET_NAME, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    ...countSheetColumns.map((c) => ({ header: c.header, width: c.width })),
    { header: "Dari sheet SPB", width: 50 },
    { header: "Kecocokan", width: 14 },
  ];
  sheet.getColumn(1).hidden = true;
  sheet.getRow(1).font = { bold: true };
  const tally = { pasti: 0, cek: 0, "tidak ketemu": 0 };
  for (const b of blocks) {
    const { product, confidence } = bestMatch(b.label, candidates);
    tally[confidence]++;
    const p = product ? named.find((n) => n.id === product.id)! : null;
    const row = sheet.addRow([p?.id ?? null, p?.code ?? null, p?.name ?? null, p?.unit ?? null, null, b.qty, `${b.sheet} · ${b.label}`, confidence]);
    if (confidence !== "pasti") row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: confidence === "cek" ? "FFFFF2CC" : "FFF8CBAD" } };
  }

  const out = join(outDir, `hitung-${basename(file, ".xlsx")}.xlsx`);
  await book.xlsx.writeFile(out);
  console.log(`${basename(file)} → ${out}: brand ${brand ?? "?"}, ${blocks.length} varian (${tally.pasti} pasti, ${tally.cek} cek, ${tally["tidak ketemu"]} tidak ketemu)`);
}
