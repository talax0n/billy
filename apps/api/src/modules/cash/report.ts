import { cashSourceTypeLabels, type CashReportFilter, type cashReportQuery, formatDate, rupiah } from "@billy/core";
import { accounts, cashEntries, type Db, expenses, payments, posSales, purchaseInvoices, salesInvoices, users } from "@billy/db";
import { and, asc, between, count, eq, ilike, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { likePattern } from "../../lib/search.ts";
import { assertExportable, type SheetColumn, xlsxFile } from "../../lib/xlsx.ts";

const signedAmount = sql`case when ${cashEntries.direction} = 'in' then ${cashEntries.amount} else -${cashEntries.amount} end`;

/**
 * The period's entries, in date order. With one account each row also carries the running sum
 * of that account's entries in the period, before the source and search filters, so a filtered
 * row still shows the account's real balance (opening balance added by the caller).
 */
function periodLedger(db: Db, filter: CashReportFilter) {
  return db
    .select({
      id: cashEntries.id,
      accountId: cashEntries.accountId,
      date: cashEntries.date,
      direction: cashEntries.direction,
      amount: cashEntries.amount,
      category: cashEntries.category,
      sourceType: cashEntries.sourceType,
      sourceId: cashEntries.sourceId,
      note: cashEntries.note,
      createdBy: cashEntries.createdBy,
      createdAt: cashEntries.createdAt,
      movement: (filter.accountId
        ? sql<string>`sum(${signedAmount}) over (order by ${cashEntries.date}, ${cashEntries.createdAt}, ${cashEntries.id})`
        : sql<string | null>`null`
      ).as("movement"),
    })
    .from(cashEntries)
    .where(and(between(cashEntries.date, filter.from, filter.to), filter.accountId ? eq(cashEntries.accountId, filter.accountId) : undefined))
    .as("ledger");
}

type Ledger = ReturnType<typeof periodLedger>;

const ledgerWhere = (ledger: Ledger, filter: CashReportFilter) =>
  and(filter.sourceType ? eq(ledger.sourceType, filter.sourceType) : undefined, filter.q ? ilike(ledger.note, likePattern(filter.q)) : undefined);

/** Rows with the account, who entered them, and the document behind each (the invoice for a payment). */
function selectRows(db: Db, ledger: Ledger, filter: CashReportFilter) {
  const isPayment = inArray(ledger.sourceType, ["sales_payment", "purchase_payment"]);
  return db
    .select({
      id: ledger.id,
      date: ledger.date,
      accountId: ledger.accountId,
      accountName: accounts.name,
      direction: ledger.direction,
      amount: ledger.amount,
      category: ledger.category,
      sourceType: ledger.sourceType,
      documentId: sql<string | null>`coalesce(${payments.salesInvoiceId}, ${payments.purchaseInvoiceId}, ${posSales.id}, ${expenses.id})`,
      documentNumber: sql<string | null>`coalesce(${salesInvoices.number}, ${purchaseInvoices.number}, ${posSales.number}, ${expenses.number})`,
      note: ledger.note,
      createdByName: users.name,
      movement: ledger.movement,
    })
    .from(ledger)
    .innerJoin(accounts, eq(accounts.id, ledger.accountId))
    .innerJoin(users, eq(users.id, ledger.createdBy))
    .leftJoin(payments, and(isPayment, eq(payments.id, ledger.sourceId)))
    .leftJoin(salesInvoices, eq(salesInvoices.id, payments.salesInvoiceId))
    .leftJoin(purchaseInvoices, eq(purchaseInvoices.id, payments.purchaseInvoiceId))
    .leftJoin(posSales, and(eq(ledger.sourceType, "pos_sale"), eq(posSales.id, ledger.sourceId)))
    .leftJoin(expenses, and(eq(ledger.sourceType, "expense"), eq(expenses.id, ledger.sourceId)))
    .where(ledgerWhere(ledger, filter))
    .orderBy(asc(ledger.date), asc(ledger.createdAt), asc(ledger.id));
}

/** Count and totals of every row the filters match, not only one page. */
async function summarize(db: Db, ledger: Ledger, filter: CashReportFilter) {
  const sumOf = (direction: "in" | "out") =>
    sql`coalesce(sum(${ledger.amount}) filter (where ${ledger.direction} = ${direction}), 0)::bigint`.mapWith(Number);
  const [row] = await db
    .select({ total: count(), totalIn: sumOf("in"), totalOut: sumOf("out") })
    .from(ledger)
    .where(ledgerWhere(ledger, filter));
  return { total: row!.total, totalIn: rupiah(row!.totalIn), totalOut: rupiah(row!.totalOut) };
}

/** One account's balance before the period and at its end, over all its entries. */
async function accountBalances(db: Db, filter: CashReportFilter) {
  if (!filter.accountId) return null;
  const sumWhere = (condition: ReturnType<typeof sql>) => sql`coalesce(sum(${signedAmount}) filter (where ${condition}), 0)::bigint`.mapWith(Number);
  const [row] = await db
    .select({ opening: sumWhere(sql`${cashEntries.date} < ${filter.from}`), closing: sumWhere(sql`${cashEntries.date} <= ${filter.to}`) })
    .from(cashEntries)
    .where(eq(cashEntries.accountId, filter.accountId));
  return { opening: rupiah(row!.opening), closing: rupiah(row!.closing) };
}

async function readReport(db: Db, filter: CashReportFilter, page: { limit: number; offset: number } | null) {
  const ledger = periodLedger(db, filter);
  const rowsQuery = selectRows(db, ledger, filter);
  const [rows, summary, balances] = await Promise.all([
    page ? rowsQuery.limit(page.limit).offset(page.offset) : rowsQuery,
    summarize(db, ledger, filter),
    accountBalances(db, filter),
  ]);
  return {
    rows: rows.map(({ movement, ...row }) => ({
      ...row,
      balance: balances && movement !== null ? rupiah(balances.opening + Number(movement)) : null,
    })),
    ...summary,
    opening: balances?.opening ?? null,
    closing: balances?.closing ?? null,
  };
}

/**
 * Laporan Kas (legacy "Laporan Debit Kredit"): every cash and bank movement of the period, oldest
 * first, one page at a time. With one account it adds the opening balance, the running balance
 * after each row, and the closing balance.
 */
export async function cashReport(db: Db, { page, pageSize, ...filter }: z.output<typeof cashReportQuery>) {
  return db.transaction((tx) => readReport(tx, filter, { limit: pageSize, offset: (page - 1) * pageSize }), {
    isolationLevel: "repeatable read",
  });
}

/**
 * The whole filtered Laporan Kas as an .xlsx, oldest first. With one account it opens with the
 * opening balance, carries the running balance, and closes with the closing balance.
 */
export async function cashReportXlsx(db: Db, filter: CashReportFilter) {
  const report = await db.transaction(
    async (tx) => {
      assertExportable((await summarize(tx, periodLedger(tx, filter), filter)).total);
      return readReport(tx, filter, null);
    },
    { isolationLevel: "repeatable read" },
  );
  const withBalance = report.opening !== null;
  const columns: SheetColumn[] = [
    { header: "Tanggal", width: 13, kind: "date" },
    { header: "Akun", width: 22, kind: "text" },
    { header: "Sumber", width: 22, kind: "text" },
    { header: "Dokumen", width: 22, kind: "text" },
    { header: "Keterangan", width: 40, kind: "text" },
    { header: "Masuk", width: 18, kind: "money" },
    { header: "Keluar", width: 18, kind: "money" },
    ...(withBalance ? [{ header: "Saldo", width: 18, kind: "money" as const }] : []),
  ];
  const balance = (value: number | null) => (withBalance ? [value] : []);
  const rows = report.rows.map((row) => [
    row.date,
    row.accountName,
    cashSourceTypeLabels[row.sourceType],
    row.documentNumber ?? "",
    row.note,
    row.direction === "in" ? row.amount : null,
    row.direction === "out" ? row.amount : null,
    ...balance(row.balance),
  ]);
  const opening = withBalance ? [[filter.from, null, null, null, "Saldo awal", null, null, report.opening]] : [];
  const totals = [
    null,
    null,
    null,
    null,
    `Total ${report.total} baris · ${formatDate(filter.from)} – ${formatDate(filter.to)}`,
    report.totalIn,
    report.totalOut,
    ...balance(report.closing),
  ];
  return xlsxFile("Laporan Kas", columns, [...opening, ...rows], totals);
}
