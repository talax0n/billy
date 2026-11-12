import { inWindow, rupiah, type DateWindow } from "@billy/core";
import type { Db } from "@billy/db";
import ExcelJS from "exceljs";
import { readInsightData } from "./service.ts";

export const RUPIAH_FORMAT = '"Rp" #,##0;[Red]("Rp" #,##0)';
export async function exportReport(
  db: Db,
  kind: "cash-book" | "sales",
  query: DateWindow & { account?: string | undefined },
) {
  const data = await db.transaction((tx) => readInsightData(tx, query.to), {
    isolationLevel: "repeatable read",
  });
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(kind === "sales" ? "Penjualan" : "Buku kas", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  if (kind === "sales") {
    sheet.columns = [
      { header: "Tanggal", key: "date", width: 15 },
      { header: "Nomor", key: "number", width: 26 },
      { header: "Sumber", key: "source", width: 16 },
      { header: "Penjualan", key: "total", width: 22 },
      { header: "Laba kotor", key: "profit", width: 22 },
    ];
    const rows = [
      ...data.invoices.map((r) => ({ ...r, source: "Faktur" })),
      ...data.pos.map((r) => ({ ...r, source: "Kasir" })),
    ]
      .filter((r) => !r.voidedDate && inWindow(r.date, query))
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) || a.number.localeCompare(b.number),
      );
    sheet.addRows(rows);
    for (const key of ["total", "profit"])
      sheet.getColumn(key).numFmt = RUPIAH_FORMAT;
  } else {
    sheet.columns = [
      { header: "Tanggal", key: "date", width: 15 },
      { header: "Akun", key: "account", width: 26 },
      { header: "Keterangan", key: "note", width: 36 },
      { header: "Sumber", key: "source", width: 22 },
      { header: "Masuk", key: "incoming", width: 22 },
      { header: "Keluar", key: "outgoing", width: 22 },
      { header: "Saldo akun", key: "balance", width: 22 },
    ];
    for (const account of data.accounts.filter(
      (a) => !query.account || a.id === query.account,
    )) {
      const rows = data.cash
        .filter((r) => r.accountId === account.id)
        .sort(
          (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
        );
      let balance = rupiah(
        rows
          .filter((r) => r.date < query.from)
          .reduce(
            (n, r) => n + (r.direction === "in" ? r.amount : -r.amount),
            0,
          ),
      );
      sheet.addRow({
        date: query.from,
        account: account.name,
        note: "Saldo awal",
        incoming: 0,
        outgoing: 0,
        balance,
      });
      for (const row of rows.filter((r) => inWindow(r.date, query))) {
        balance = rupiah(
          balance + (row.direction === "in" ? row.amount : -row.amount),
        );
        sheet.addRow({
          date: row.date,
          account: account.name,
          note: row.note,
          source: row.sourceType,
          incoming: row.direction === "in" ? row.amount : 0,
          outgoing: row.direction === "out" ? row.amount : 0,
          balance,
        });
      }
    }
    for (const key of ["incoming", "outgoing", "balance"])
      sheet.getColumn(key).numFmt = RUPIAH_FORMAT;
  }
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columnCount },
  };
  return new Uint8Array(await book.xlsx.writeBuffer());
}
