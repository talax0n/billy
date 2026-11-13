import { DomainError } from "@billy/core";
import ExcelJS from "exceljs";

/** Above this an export is refused: a bigger sheet is slow to build in one serverless call and to open. */
export const EXPORT_ROW_CAP = 50_000;

export function assertExportable(rows: number) {
  if (rows > EXPORT_ROW_CAP) {
    throw new DomainError(
      "invalid",
      `Laporan ini berisi ${rows.toLocaleString("id-ID")} baris, melebihi batas ekspor ${EXPORT_ROW_CAP.toLocaleString("id-ID")} baris. Persempit periode atau filter.`,
    );
  }
}

const RUPIAH_FORMAT = '"Rp" #,##0;[Red]-"Rp" #,##0';

export interface SheetColumn {
  header: string;
  width: number;
  /** `date` cells take a `YYYY-MM-DD` business date and are written as real dates. */
  kind: "text" | "date" | "money";
}

type Cell = string | number | null;

/**
 * One sheet as a real .xlsx, built in memory (no filesystem, so it runs on serverless): dates as
 * date cells, money as numbers in rupiah format, a frozen bold header, and a bold totals row.
 */
export async function xlsxFile(sheetName: string, columns: SheetColumn[], rows: Cell[][], totals: Cell[]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map((column) => ({
    header: column.header,
    width: column.width,
    ...(column.kind !== "text" && { style: { numFmt: column.kind === "date" ? "dd/mm/yyyy" : RUPIAH_FORMAT } }),
  }));
  const typed = (row: Cell[]) =>
    row.map((value, i) => (columns[i]!.kind === "date" && typeof value === "string" ? new Date(`${value}T00:00:00Z`) : value));
  sheet.addRows(rows.map(typed));
  sheet.addRow(typed(totals)).font = { bold: true };
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return new Uint8Array(await book.xlsx.writeBuffer());
}

export function xlsxResponse(body: Uint8Array<ArrayBuffer>, fileName: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** `laporan-kas-2026-11-01_2026-11-30.xlsx`; an open end reads `awal` or `akhir`. */
export const exportFileName = (name: string, { from, to }: { from?: string | undefined; to?: string | undefined }) =>
  `${name}-${from ?? "awal"}_${to ?? "akhir"}.xlsx`;
