import {
  businessDate,
  type accountInput,
  type cashBookQuery,
  type cashEntryInput,
  DomainError,
  manualCashCategory,
  type PaginationQuery,
  reversalOf,
  transferMovements,
  type transferInput,
} from "@billy/core";
import { accounts, cashEntries, type Db, expenses, transfers, users } from "@billy/db";
import { and, asc, count, desc, eq, gte, ilike, lte, ne, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { likePattern } from "../../lib/search.ts";

/** Money in counts up, money out counts down. */
const signedAmount = sql`case when ${cashEntries.direction} = 'in' then ${cashEntries.amount} else -${cashEntries.amount} end`;

/** Balances are derived: the sum of an account's cash entries (data-model ground rule 4). */
const balanceByAccount = (db: Db) =>
  db
    .select({ accountId: cashEntries.accountId, balance: sql<string>`sum(${signedAmount})`.as("balance") })
    .from(cashEntries)
    .groupBy(cashEntries.accountId)
    .as("balance_by_account");

function selectAccounts(db: Db) {
  const balances = balanceByAccount(db);
  return db
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      kind: accounts.kind,
      active: accounts.active,
      balance: sql`coalesce(${balances.balance}, 0)::bigint`.mapWith(Number),
    })
    .from(accounts)
    .leftJoin(balances, eq(balances.accountId, accounts.id));
}

/** One page of accounts with their balances, plus the combined balance of every account. */
export async function listAccounts(db: Db, { q, page, pageSize }: PaginationQuery) {
  const where = q ? or(ilike(accounts.name, likePattern(q)), ilike(accounts.code, likePattern(q))) : undefined;
  const [rows, [counted], [overall]] = await Promise.all([
    selectAccounts(db)
      .where(where)
      .orderBy(desc(accounts.active), asc(accounts.kind), asc(accounts.name))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(accounts).where(where),
    db.select({ balance: sql`coalesce(sum(${signedAmount}), 0)::bigint`.mapWith(Number) }).from(cashEntries),
  ]);
  return { rows, total: counted!.total, balanceTotal: overall!.balance };
}

/** Active accounts for pickers, including the POS payment-method mapping. */
export async function lookupAccounts(db: Db) {
  return db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, kind: accounts.kind })
    .from(accounts)
    .where(eq(accounts.active, true))
    .orderBy(asc(accounts.kind), asc(accounts.name));
}

export async function getAccount(db: Db, id: string) {
  const [row] = await selectAccounts(db).where(eq(accounts.id, id));
  if (!row) throw new DomainError("not_found", "Akun tidak ditemukan");
  return row;
}

export async function createAccount(db: Db, input: z.output<typeof accountInput>) {
  const [row] = await db.insert(accounts).values(input).returning({ id: accounts.id });
  return getAccount(db, row!.id);
}

/** Accounts are never deleted: their cash entries stay. `active: false` hides them from pickers. */
export async function updateAccount(db: Db, id: string, input: z.output<typeof accountInput>) {
  const [row] = await db.update(accounts).set(input).where(eq(accounts.id, id)).returning({ id: accounts.id });
  if (!row) throw new DomainError("not_found", "Akun tidak ditemukan");
  return getAccount(db, id);
}

async function requireActiveAccount(db: Db, id: string) {
  const [row] = await db.select({ active: accounts.active }).from(accounts).where(eq(accounts.id, id));
  if (!row?.active) throw new DomainError("invalid", "Akun tidak ditemukan atau sudah nonaktif");
}

/**
 * The account's cash book, newest first. The running balance is computed over the whole account
 * history before filtering, so a filtered row still shows the real balance after it.
 * `totalIn` / `totalOut` cover every row matching the filters, not only the page.
 */
export async function cashBook(db: Db, accountId: string, query: z.output<typeof cashBookQuery>) {
  await getAccount(db, accountId);
  const ledger = db
    .select({
      id: cashEntries.id,
      date: cashEntries.date,
      direction: cashEntries.direction,
      amount: cashEntries.amount,
      category: cashEntries.category,
      sourceType: cashEntries.sourceType,
      sourceId: cashEntries.sourceId,
      note: cashEntries.note,
      createdBy: cashEntries.createdBy,
      createdAt: cashEntries.createdAt,
      balance: sql<string>`sum(${signedAmount}) over (order by ${cashEntries.date}, ${cashEntries.createdAt}, ${cashEntries.id})`.as(
        "balance",
      ),
    })
    .from(cashEntries)
    .where(eq(cashEntries.accountId, accountId))
    .as("ledger");

  const where = and(
    query.from ? gte(ledger.date, query.from) : undefined,
    query.to ? lte(ledger.date, query.to) : undefined,
    query.direction ? eq(ledger.direction, query.direction) : undefined,
    query.category ? eq(ledger.category, query.category) : undefined,
    query.q ? ilike(ledger.note, likePattern(query.q)) : undefined,
  );
  const sumWhere = (direction: "in" | "out") =>
    sql`coalesce(sum(${ledger.amount}) filter (where ${ledger.direction} = ${direction}), 0)::bigint`.mapWith(Number);

  const [rows, [summary]] = await Promise.all([
    db
      .select({
        id: ledger.id,
        date: ledger.date,
        direction: ledger.direction,
        amount: ledger.amount,
        category: ledger.category,
        sourceType: ledger.sourceType,
        sourceId: ledger.sourceId,
        note: ledger.note,
        balance: sql`${ledger.balance}::bigint`.mapWith(Number),
        expenseNumber: expenses.number,
        /** The source transfer or expense is still live, so the entry can be voided from the cash book. */
        voidable: sql<boolean>`(${transfers.id} is not null and ${transfers.voidedAt} is null) or (${expenses.id} is not null and ${expenses.voidedAt} is null)`,
        createdByName: users.name,
      })
      .from(ledger)
      .innerJoin(users, eq(users.id, ledger.createdBy))
      .leftJoin(transfers, and(eq(ledger.sourceType, "transfer"), eq(transfers.id, ledger.sourceId)))
      .leftJoin(expenses, and(eq(ledger.sourceType, "expense"), eq(expenses.id, ledger.sourceId)))
      .where(where)
      .orderBy(desc(ledger.date), desc(ledger.createdAt), desc(ledger.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ total: count(), totalIn: sumWhere("in"), totalOut: sumWhere("out") })
      .from(ledger)
      .where(where),
  ]);
  return { rows, total: summary!.total, totalIn: summary!.totalIn, totalOut: summary!.totalOut };
}

/** Uang masuk / uang keluar lain. */
export async function createCashEntry(db: Db, input: z.output<typeof cashEntryInput>, userId: string) {
  return db.transaction(async (tx) => {
    await requireActiveAccount(tx, input.accountId);
    const [row] = await tx
      .insert(cashEntries)
      .values({ ...input, category: manualCashCategory(input.direction), sourceType: "manual", createdBy: userId })
      .returning();
    return row!;
  });
}

export async function createTransfer(db: Db, input: z.output<typeof transferInput>, userId: string) {
  return db.transaction(async (tx) => {
    await requireActiveAccount(tx, input.fromAccountId);
    await requireActiveAccount(tx, input.toAccountId);
    const [row] = await tx
      .insert(transfers)
      .values({ ...input, createdBy: userId })
      .returning();
    await tx.insert(cashEntries).values(
      transferMovements(input).map((movement) => ({
        ...movement,
        category: "transfer" as const,
        sourceType: "transfer" as const,
        sourceId: row!.id,
        note: input.note,
        createdBy: userId,
      })),
    );
    return row!;
  });
}

export async function voidTransfer(db: Db, id: string, reason: string, userId: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ voidedAt: transfers.voidedAt }).from(transfers).where(eq(transfers.id, id)).for("update");
    if (!row) throw new DomainError("not_found", "Transfer tidak ditemukan");
    if (row.voidedAt) throw new DomainError("conflict", "Transfer ini sudah di-void");
    const [voided] = await tx
      .update(transfers)
      .set({ voidedAt: new Date(), voidedBy: userId, voidReason: reason })
      .where(eq(transfers.id, id))
      .returning();
    await writeReversals(tx, "transfer", id, reason, userId);
    return voided!;
  });
}

/**
 * Cancels a voided document's cash side: one `reversal` entry per original entry of the source.
 * Call it inside the void command's transaction, after the document row is marked voided.
 */
export async function writeReversals(
  tx: Db,
  sourceType: "transfer" | "expense" | "sales_payment" | "purchase_payment" | "pos_sale",
  sourceId: string,
  reason: string,
  userId: string,
) {
  const originals = await tx
    .select({ accountId: cashEntries.accountId, date: cashEntries.date, direction: cashEntries.direction, amount: cashEntries.amount })
    .from(cashEntries)
    .where(and(eq(cashEntries.sourceType, sourceType), eq(cashEntries.sourceId, sourceId), ne(cashEntries.category, "reversal")));
  if (originals.length === 0) return;
  await tx.insert(cashEntries).values(
    originals.map((entry) => ({
      ...reversalOf(entry, businessDate()),
      category: "reversal" as const,
      sourceType,
      sourceId,
      note: `Void: ${reason}`,
      createdBy: userId,
    })),
  );
}
