import { rupiah, type DateWindow } from "@billy/core";
import {
  accounts,
  cashEntries,
  type Db,
  posLines,
  posSales,
  salesInvoices,
  salesLines,
} from "@billy/db";
import { and, between, eq, isNull, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { money, signedAmount, snapshot } from "./sql.ts";

export const RUPIAH_FORMAT = '"Rp" #,##0;[Red]("Rp" #,##0)';

type ReportQuery = DateWindow & { account?: string | undefined };

function salesRows(db: Db, window: DateWindow) {
  const documents = (
    source: string,
    document: typeof salesInvoices | typeof posSales,
    line: typeof salesLines | typeof posLines,
    lineDocumentId: typeof salesLines.invoiceId | typeof posLines.saleId,
  ) =>
    db
      .select({
        date: document.date,
        number: document.number,
        source: sql<string>`${source}::text`,
        total: document.total,
        profit: money(
          sql`sum(${line.lineTotal} - ${line.qty} * ${line.unitCost})`,
        ),
      })
      .from(document)
      .leftJoin(line, eq(lineDocumentId, document.id))
      .where(
        and(
          between(document.date, window.from, window.to),
          isNull(document.voidedAt),
        ),
      )
      .groupBy(document.id);
  return Promise.all([
    documents("Faktur", salesInvoices, salesLines, salesLines.invoiceId),
    documents("Kasir", posSales, posLines, posLines.saleId),
  ]).then((parts) =>
    parts
      .flat()
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) || a.number.localeCompare(b.number),
      ),
  );
}

async function cashBook(db: Db, query: ReportQuery) {
  const account = (column: typeof accounts.id | typeof cashEntries.accountId) =>
    query.account ? eq(column, query.account) : undefined;
  const [opening, rows] = await Promise.all([
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        balance: money(
          sql`sum(${signedAmount}) filter (where ${cashEntries.date} < ${query.from})`,
        ),
      })
      .from(accounts)
      .leftJoin(cashEntries, eq(cashEntries.accountId, accounts.id))
      .where(account(accounts.id))
      .groupBy(accounts.id)
      .orderBy(accounts.name),
    db
      .select({
        accountId: cashEntries.accountId,
        date: cashEntries.date,
        direction: cashEntries.direction,
        amount: cashEntries.amount,
        sourceType: cashEntries.sourceType,
        note: cashEntries.note,
      })
      .from(cashEntries)
      .where(
        and(
          between(cashEntries.date, query.from, query.to),
          account(cashEntries.accountId),
        ),
      )
      .orderBy(cashEntries.date, cashEntries.id),
  ]);
  return { opening, rows };
}

export async function exportReport(
  db: Db,
  kind: "cash-book" | "sales",
  query: ReportQuery,
) {
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
    sheet.addRows(
      await db.transaction((tx) => salesRows(tx, query), snapshot),
    );
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
    const { opening, rows } = await db.transaction(
      (tx) => cashBook(tx, query),
      snapshot,
    );
    for (const account of opening) {
      let balance = account.balance;
      sheet.addRow({
        date: query.from,
        account: account.name,
        note: "Saldo awal",
        incoming: 0,
        outgoing: 0,
        balance,
      });
      for (const row of rows.filter((r) => r.accountId === account.id)) {
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
