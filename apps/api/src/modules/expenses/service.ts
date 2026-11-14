import { DomainError, type expenseEditInput, type expenseInput, type expenseQuery, formatRupiah, monthRange, revisionNumber } from "@billy/core";
import { accounts, cashEntries, type Db, expenses, users } from "@billy/db";
import { and, count, desc, eq, gte, lt, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../env.ts";
import { audit } from "../../lib/audit.ts";
import { allocateDocNumber } from "../../lib/doc-number.ts";
import { revisionLinks } from "../../lib/revisions.ts";
import { matchAllTerms } from "../../lib/search.ts";
import { writeReversals } from "../cash/service.ts";

function expenseWhere({ q, month }: z.output<typeof expenseQuery>): SQL | undefined {
  const range = month ? monthRange(month) : undefined;
  const haystack = sql`${expenses.number} || ' ' || ${expenses.category} || ' ' || ${expenses.description}`;
  return and(range && gte(expenses.date, range.from), range && lt(expenses.date, range.until), matchAllTerms(haystack, q));
}

function selectExpenses(db: Db) {
  return db
    .select({
      id: expenses.id,
      number: expenses.number,
      date: expenses.date,
      accountId: expenses.accountId,
      accountName: accounts.name,
      category: expenses.category,
      description: expenses.description,
      amount: expenses.amount,
      proofUrl: expenses.proofUrl,
      revisionOfId: expenses.revisionOf,
      createdByName: users.name,
      createdAt: expenses.createdAt,
      voidedAt: expenses.voidedAt,
      voidReason: expenses.voidReason,
    })
    .from(expenses)
    .innerJoin(accounts, eq(accounts.id, expenses.accountId))
    .innerJoin(users, eq(users.id, expenses.createdBy));
}

/** One page of expenses, plus the sum of the non-voided expenses matching the filters. */
export async function listExpenses(db: Db, query: z.output<typeof expenseQuery>) {
  const where = expenseWhere(query);
  const [rows, [summary]] = await Promise.all([
    selectExpenses(db)
      .where(where)
      .orderBy(desc(expenses.date), desc(expenses.number))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({
        total: count(),
        amountTotal: sql`coalesce(sum(${expenses.amount}) filter (where ${expenses.voidedAt} is null), 0)::bigint`.mapWith(Number),
      })
      .from(expenses)
      .where(where),
  ]);
  return { rows, total: summary!.total, amountTotal: summary!.amountTotal };
}

export async function getExpense(db: Db, id: string) {
  const [row] = await selectExpenses(db).where(eq(expenses.id, id));
  if (!row) throw new DomainError("not_found", "Biaya tidak ditemukan");
  const { revisionOfId, ...expense } = row;
  return { ...expense, ...(await revisionLinks(db, expenses, { id, revisionOf: revisionOfId })) };
}

type ExpenseInput = z.output<typeof expenseInput>;

/** The expense row and its cash entry `out` / `expense` on the paying account. Logs nothing. */
async function writeExpense(tx: Db, input: ExpenseInput, userId: string, number: string, revisionOf: string | null) {
  const [account] = await tx.select({ active: accounts.active }).from(accounts).where(eq(accounts.id, input.accountId));
  if (!account?.active) throw new DomainError("invalid", "Akun tidak ditemukan atau sudah nonaktif");
  const [row] = await tx
    .insert(expenses)
    .values({ ...input, number, revisionOf, createdBy: userId })
    .returning({ id: expenses.id });
  await tx.insert(cashEntries).values({
    accountId: input.accountId,
    date: input.date,
    direction: "out",
    amount: input.amount,
    category: "expense",
    sourceType: "expense",
    sourceId: row!.id,
    note: input.description ? `${input.category}: ${input.description}` : input.category,
    createdBy: userId,
  });
  return row!.id;
}

export async function createExpense(db: Db, input: ExpenseInput, actor: Actor) {
  return db.transaction(async (tx) => {
    const number = await allocateDocNumber(tx, "BY", input.date);
    const id = await writeExpense(tx, input, actor.id, number, null);
    await audit(tx, actor, {
      action: "expense.create",
      entityId: id,
      summary: `Biaya ${number} ${input.category} ${formatRupiah(input.amount)}`,
      after: { number, ...input },
    });
    return getExpense(tx, id);
  });
}

async function lockExpense(tx: Db, id: string) {
  const [row] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
  if (!row) throw new DomainError("not_found", "Biaya tidak ditemukan");
  return row;
}

/** Marks the expense void and puts its money back with a reversal entry dated today. Logs nothing. */
async function reverseExpense(tx: Db, id: string, reason: string, userId: string) {
  await tx
    .update(expenses)
    .set({ voidedAt: new Date(), voidedBy: userId, voidReason: reason })
    .where(eq(expenses.id, id));
  await writeReversals(tx, "expense", id, reason, userId);
}

export async function voidExpense(db: Db, id: string, reason: string, actor: Actor) {
  return db.transaction(async (tx) => {
    const row = await lockExpense(tx, id);
    if (row.voidedAt) throw new DomainError("conflict", "Biaya ini sudah dibatalkan");
    await reverseExpense(tx, id, reason, actor.id);
    await audit(tx, actor, {
      action: "expense.void",
      entityId: id,
      summary: `Pembatalan biaya ${row.number} ${formatRupiah(row.amount)}`,
      before: { voidedAt: null },
      after: { voidedAt: new Date().toISOString() },
      reason,
    });
    return getExpense(tx, id);
  });
}

/**
 * Ubah: voids the expense ("Diubah: <reason>", its money back in a reversal entry) and records
 * the corrected one as `<number>/R<n>`, linked by `revision_of`, with one audit event.
 */
export async function editExpense(db: Db, id: string, { reason, ...input }: z.output<typeof expenseEditInput>, actor: Actor) {
  return db.transaction(async (tx) => {
    const original = await lockExpense(tx, id);
    if (original.voidedAt) throw new DomainError("conflict", "Biaya ini sudah dibatalkan atau diubah");
    await reverseExpense(tx, id, `Diubah: ${reason}`, actor.id);
    const number = revisionNumber(original.number);
    const newId = await writeExpense(tx, input, actor.id, number, id);
    const fields = ({ date, accountId, category, description, amount, proofUrl }: ExpenseInput) => ({ date, accountId, category, description, amount, proofUrl });
    await audit(tx, actor, {
      action: "expense.edit",
      entityId: newId,
      summary: `Ubah ${original.number} → ${number} · ${formatRupiah(original.amount)} → ${formatRupiah(input.amount)}`,
      before: { expenseId: id, number: original.number, ...fields(original) },
      after: { expenseId: newId, number, ...fields(input) },
      reason,
    });
    return getExpense(tx, newId);
  });
}
