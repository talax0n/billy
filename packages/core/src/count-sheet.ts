import { DomainError } from "./errors.ts";

/**
 * The Excel sheet a stok opname accepts. Billy hands it out prefilled ("Unduh template"); staff fill
 * in Stok fisik and upload it back. Each column's note is shown in the app and in the template.
 */
export const countSheetColumns = [
  { header: "ID", width: 38, note: "Kode unik barang di billy, diisi otomatis oleh template (kolom tersembunyi). Jangan diubah." },
  { header: "Kode", width: 14, note: "Kode barang. Dipakai bila ID kosong." },
  { header: "Nama barang", width: 48, note: "Nama barang persis seperti di billy. Dipakai bila ID dan Kode kosong." },
  { header: "Satuan", width: 10, note: "Hanya keterangan, tidak dibaca." },
  { header: "Stok sistem", width: 12, note: "Hanya keterangan, tidak dibaca." },
  { header: "Stok fisik", width: 12, note: "Wajib. Jumlah hasil hitung, bilangan bulat 0 atau lebih. Kosong berarti belum dihitung dan dilewati." },
] as const;

export const COUNT_SHEET_NAME = "Hitung opname";
/** How far down the header row may sit, so a title or note above it is fine. */
const HEADER_SEARCH_ROWS = 10;

export type SheetCell = string | number | null;

/** One filled-in line: which product (by whichever identifier is there) and its counted quantity. */
export interface CountSheetRow {
  /** The Excel row number, for messages. */
  row: number;
  id: string | null;
  code: string | null;
  name: string | null;
  qty: number;
}

export interface CountSheetIssue {
  row: number;
  reason: string;
}

const norm = (value: SheetCell) => (value === null ? "" : String(value).trim().replace(/\s+/g, " "));
const key = (value: SheetCell) => norm(value).toLowerCase();

/**
 * Reads the first sheet's cells (row by row, as Excel shows them). The header row is the first of the
 * top rows holding "Stok fisik" and at least one of ID, Kode or Nama barang; column order is free and
 * other columns are ignored. Rows with an empty Stok fisik are skipped; a bad row is reported, not fatal.
 */
export function readCountSheet(cells: readonly (readonly SheetCell[])[]): { rows: CountSheetRow[]; issues: CountSheetIssue[] } {
  const headerAt = cells.slice(0, HEADER_SEARCH_ROWS).findIndex((row) => {
    const names = row.map(key);
    return names.includes("stok fisik") && ["id", "kode", "nama barang"].some((h) => names.includes(h));
  });
  if (headerAt === -1) {
    throw new DomainError(
      "invalid",
      'Kolom "Stok fisik" dan salah satu dari "ID", "Kode" atau "Nama barang" tidak ditemukan di 10 baris teratas. Pakai template dari tombol "Unduh template".',
    );
  }
  const names = cells[headerAt]!.map(key);
  const column = (header: string) => names.indexOf(header);
  const [idAt, codeAt, nameAt, qtyAt] = [column("id"), column("kode"), column("nama barang"), column("stok fisik")];
  const text = (row: readonly SheetCell[], at: number) => (at === -1 ? null : norm(row[at] ?? null) || null);

  const rows: CountSheetRow[] = [];
  const issues: CountSheetIssue[] = [];
  cells.slice(headerAt + 1).forEach((row, i) => {
    const rowNumber = headerAt + i + 2;
    const raw = norm(row[qtyAt] ?? null);
    if (raw === "") return;
    const id = text(row, idAt);
    const code = text(row, codeAt);
    const name = text(row, nameAt);
    if (!id && !code && !name) return issues.push({ row: rowNumber, reason: "Tidak ada ID, Kode atau Nama barang" });
    const qty = Number(raw.replace(",", "."));
    if (!Number.isInteger(qty) || qty < 0) return issues.push({ row: rowNumber, reason: `Stok fisik "${raw}" bukan bilangan bulat 0 atau lebih` });
    rows.push({ row: rowNumber, id, code, name, qty });
  });
  return { rows, issues };
}
