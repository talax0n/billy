import { DomainError, runningBalances, validateTransfer, rupiah, type accountInput, type cashBookQuery, type expenseInput, type expenseQuery, type manualCashInput, type transferInput } from "@billy/core";
import { accounts, cashEntries, expenses, transfers, type Db } from "@billy/db";
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import { allocateDocNumber } from "../../lib/doc-number.ts";

type Input<T extends z.ZodType> = z.output<T>;
async function activeAccount(db: Db, id: string) {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id));
  if (!row || !row.active) throw new DomainError("invalid", "Akun tidak ditemukan atau tidak aktif");
  return row;
}
export async function listAccounts(db: Db) {
  const rows = await db.select({ id: accounts.id, code: accounts.code, name: accounts.name, kind: accounts.kind, active: accounts.active, balance: sql<number>`coalesce(sum(case when ${cashEntries.direction} = 'in' then ${cashEntries.amount} else -${cashEntries.amount} end), 0)::bigint`.mapWith(Number) }).from(accounts).leftJoin(cashEntries, eq(cashEntries.accountId, accounts.id)).groupBy(accounts.id).orderBy(asc(accounts.name));
  return { rows, total: rows.reduce((sum, row) => sum + row.balance, 0) };
}
export async function lookupAccounts(db: Db) { return db.select({ id: accounts.id, code: accounts.code, name: accounts.name, kind: accounts.kind }).from(accounts).where(eq(accounts.active, true)).orderBy(asc(accounts.name)); }
export async function saveAccount(db: Db, input: Input<typeof accountInput>, id?: string) {
  return db.transaction(async (tx) => {
    const [row] = id ? await tx.update(accounts).set(input).where(eq(accounts.id, id)).returning() : await tx.insert(accounts).values(input).returning();
    if (!row) throw new DomainError("not_found", "Akun tidak ditemukan");
    return row;
  });
}
export async function cashBook(db: Db, id: string, query: Input<typeof cashBookQuery>) {
  const all = await db.select().from(cashEntries).where(eq(cashEntries.accountId, id)).orderBy(asc(cashEntries.date), asc(cashEntries.createdAt), asc(cashEntries.id));
  const rows = runningBalances(all).filter((row) => (!query.from || row.date >= query.from) && (!query.to || row.date <= query.to) && (!query.direction || row.direction === query.direction) && (!query.category || row.category === query.category));
  return { rows: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: rows.length };
}
export async function manualCash(db: Db, input: Input<typeof manualCashInput>, userId: string) {
  return db.transaction(async (tx) => { await activeAccount(tx, input.accountId); const [row] = await tx.insert(cashEntries).values({ ...input, category: input.direction === "in" ? "other_in" : "other_out", sourceType: "manual", createdBy: userId }).returning(); return row; });
}
export async function createTransfer(db: Db, input: Input<typeof transferInput>, userId: string) {
  validateTransfer(input);
  return db.transaction(async (tx) => {
    await activeAccount(tx, input.fromAccountId); await activeAccount(tx, input.toAccountId);
    const [row] = await tx.insert(transfers).values({ ...input, createdBy: userId }).returning();
    if (!row) throw new Error("Transfer insert failed");
    await tx.insert(cashEntries).values([{ accountId: input.fromAccountId, date: input.date, direction: "out", amount: input.amount, category: "transfer", sourceType: "transfer", sourceId: row.id, note: input.note, createdBy: userId }, { accountId: input.toAccountId, date: input.date, direction: "in", amount: input.amount, category: "transfer", sourceType: "transfer", sourceId: row.id, note: input.note, createdBy: userId }]);
    return row;
  });
}
export async function createExpense(db: Db, input: Input<typeof expenseInput>, userId: string) {
  return db.transaction(async (tx) => {
    await activeAccount(tx, input.accountId);
    const number = await allocateDocNumber(tx, "BY", input.date);
    const [row] = await tx.insert(expenses).values({ ...input, number, createdBy: userId }).returning();
    if (!row) throw new Error("Expense insert failed");
    await tx.insert(cashEntries).values({ accountId: input.accountId, date: input.date, direction: "out", amount: input.amount, category: "expense", sourceType: "expense", sourceId: row.id, note: input.description, createdBy: userId });
    return row;
  });
}
export async function listExpenses(db: Db, query: Input<typeof expenseQuery>) {
  const start = query.month ? `${query.month}-01` : undefined;
  const end = start ? new Date(Date.UTC(Number(start.slice(0,4)), Number(start.slice(5,7)), 1)).toISOString().slice(0,10) : undefined;
  const where = and(start ? gte(expenses.date, start) : undefined, end ? lt(expenses.date, end) : undefined);
  const all = await db.select().from(expenses).where(where).orderBy(desc(expenses.date), desc(expenses.createdAt));
  return { rows: all.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: all.length, amountTotal: all.reduce((sum, row) => sum + (row.voidedAt ? 0 : row.amount), 0) };
}
export async function voidDocument(db: Db, type: "expense" | "transfer", id: string, reason: string, userId: string) {
  return db.transaction(async (tx) => {
    const table = type === "expense" ? expenses : transfers;
    const [row] = await tx.update(table).set({ voidedAt: new Date(), voidedBy: userId, voidReason: reason }).where(and(eq(table.id, id), sql`${table.voidedAt} is null`)).returning();
    if (!row) throw new DomainError("conflict", "Dokumen tidak ditemukan atau sudah void");
    const originals = await tx.select().from(cashEntries).where(and(eq(cashEntries.sourceType, type), eq(cashEntries.sourceId, id), eq(cashEntries.category, type)));
    await tx.insert(cashEntries).values(originals.map((entry) => ({ accountId: entry.accountId, date: entry.date, direction: entry.direction === "in" ? "out" as const : "in" as const, amount: rupiah(entry.amount), category: "reversal" as const, sourceType: type, sourceId: id, note: reason, createdBy: userId })));
    return row;
  });
}
