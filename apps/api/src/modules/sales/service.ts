import {
  ageReceivables,
  addDays,
  assertInvoiceVoidable,
  assertPaymentAllowed,
  businessDate,
  computeTotals,
  deriveInvoiceStatus,
  DomainError,
  type lookupQuery,
  matchesStatusFilter,
  rupiah,
  type salesInvoiceInput,
  type salesListQuery,
  type salesPaymentInput,
  summarizeInvoices,
  type voidInput,
} from "@billy/core";
import {
  accounts,
  cashEntries,
  contacts,
  type Db,
  payments,
  products,
  salesInvoices,
  salesLines,
  stockMovements,
  users,
} from "@billy/db";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { allocateDocNumber } from "../../lib/doc-number.ts";
import { likePattern } from "../../lib/search.ts";

type PaymentFields = Omit<z.output<typeof salesPaymentInput>, "date">;

/** Contacts are owned by the contacts module; sales only reads customers for its pickers. */
export async function lookupCustomers(db: Db, { q }: z.output<typeof lookupQuery>) {
  return db
    .select({
      id: contacts.id,
      code: contacts.code,
      name: contacts.name,
      address: contacts.address,
      phone: contacts.phone,
      paymentTermsDays: contacts.paymentTermsDays,
    })
    .from(contacts)
    .where(
      and(
        eq(contacts.kind, "customer"),
        eq(contacts.active, true),
        q ? or(ilike(contacts.name, likePattern(q)), ilike(contacts.code, likePattern(q))) : undefined,
      ),
    )
    .orderBy(asc(contacts.name))
    .limit(20);
}

export async function lookupAccounts(db: Db) {
  return db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, kind: accounts.kind })
    .from(accounts)
    .where(eq(accounts.active, true))
    .orderBy(asc(accounts.code));
}

/** Paid is derived: the sum of an invoice's non-voided payments (data-model ground rule 5). */
const paidByInvoice = (db: Db) =>
  db
    .select({
      invoiceId: payments.salesInvoiceId,
      paid: sql<number>`sum(${payments.amount})`.mapWith(Number).as("paid"),
    })
    .from(payments)
    .where(isNull(payments.voidedAt))
    .groupBy(payments.salesInvoiceId)
    .as("paid_by_invoice");

function selectInvoices(db: Db) {
  const paid = paidByInvoice(db);
  return db
    .select({
      id: salesInvoices.id,
      number: salesInvoices.number,
      customerId: salesInvoices.customerId,
      customerName: contacts.name,
      date: salesInvoices.date,
      dueDate: salesInvoices.dueDate,
      total: salesInvoices.total,
      voidedAt: salesInvoices.voidedAt,
      paid: sql<number>`coalesce(${paid.paid}, 0)`.mapWith(Number),
    })
    .from(salesInvoices)
    .innerJoin(contacts, eq(contacts.id, salesInvoices.customerId))
    .leftJoin(paid, eq(paid.invoiceId, salesInvoices.id));
}

type InvoiceRow = Awaited<ReturnType<ReturnType<typeof selectInvoices>["execute"]>>[number];

function withState(row: InvoiceRow, today: string) {
  const paid = rupiah(row.paid);
  const state = deriveInvoiceStatus({ total: row.total, paid, dueDate: row.dueDate, voided: row.voidedAt !== null, today });
  return { ...row, paid, state };
}

export async function listInvoices(db: Db, query: z.output<typeof salesListQuery>) {
  const conditions: (SQL | undefined)[] = [
    query.from ? gte(salesInvoices.date, query.from) : undefined,
    query.to ? lte(salesInvoices.date, query.to) : undefined,
    query.customerId ? eq(salesInvoices.customerId, query.customerId) : undefined,
    query.q ? or(ilike(salesInvoices.number, likePattern(query.q)), ilike(contacts.name, likePattern(query.q))) : undefined,
  ];
  // ponytail: status is derived, so the period's invoices are filtered and paged in memory.
  // Fine for one shop's volume; move the status expression into SQL if a period passes ~50k invoices.
  const today = businessDate();
  const rows = (
    await selectInvoices(db)
      .where(and(...conditions))
      .orderBy(desc(salesInvoices.date), desc(salesInvoices.number))
  )
    .map((row) => withState(row, today))
    .filter((row) => !query.status || matchesStatusFilter(row.state, query.status));
  const start = (query.page - 1) * query.pageSize;
  return { rows: rows.slice(start, start + query.pageSize), total: rows.length, summary: summarizeInvoices(rows) };
}

export async function getInvoice(db: Db, id: string) {
  const [invoice] = await db
    .select({
      id: salesInvoices.id,
      number: salesInvoices.number,
      date: salesInvoices.date,
      dueDate: salesInvoices.dueDate,
      termsDays: salesInvoices.termsDays,
      subtotal: salesInvoices.subtotal,
      discountKind: salesInvoices.discountKind,
      discountValue: salesInvoices.discountValue,
      discountAmount: salesInvoices.discountAmount,
      total: salesInvoices.total,
      note: salesInvoices.note,
      createdAt: salesInvoices.createdAt,
      createdByName: users.name,
      voidedAt: salesInvoices.voidedAt,
      voidReason: salesInvoices.voidReason,
      customer: {
        id: contacts.id,
        code: contacts.code,
        name: contacts.name,
        address: contacts.address,
        phone: contacts.phone,
      },
    })
    .from(salesInvoices)
    .innerJoin(contacts, eq(contacts.id, salesInvoices.customerId))
    .innerJoin(users, eq(users.id, salesInvoices.createdBy))
    .where(eq(salesInvoices.id, id));
  if (!invoice) throw new DomainError("not_found", "Faktur tidak ditemukan");

  const [lines, paymentRows] = await Promise.all([
    db
      .select({
        id: salesLines.id,
        position: salesLines.position,
        productId: salesLines.productId,
        productCode: products.code,
        productName: products.name,
        variant: products.variant,
        unit: products.unit,
        note: salesLines.note,
        qty: salesLines.qty,
        unitPrice: salesLines.unitPrice,
        discountAmount: salesLines.discountAmount,
        lineTotal: salesLines.lineTotal,
      })
      .from(salesLines)
      .innerJoin(products, eq(products.id, salesLines.productId))
      .where(eq(salesLines.invoiceId, id))
      .orderBy(asc(salesLines.position)),
    db
      .select({
        id: payments.id,
        date: payments.date,
        amount: payments.amount,
        method: payments.method,
        accountName: accounts.name,
        proofUrl: payments.proofUrl,
        note: payments.note,
        createdByName: users.name,
        createdAt: payments.createdAt,
        voidedAt: payments.voidedAt,
        voidReason: payments.voidReason,
      })
      .from(payments)
      .innerJoin(accounts, eq(accounts.id, payments.accountId))
      .innerJoin(users, eq(users.id, payments.createdBy))
      .where(eq(payments.salesInvoiceId, id))
      .orderBy(asc(payments.date), asc(payments.createdAt)),
  ]);

  const paid = rupiah(paymentRows.reduce((sum, p) => (p.voidedAt ? sum : sum + p.amount), 0));
  const state = deriveInvoiceStatus({
    total: invoice.total,
    paid,
    dueDate: invoice.dueDate,
    voided: invoice.voidedAt !== null,
    today: businessDate(),
  });
  return { ...invoice, paid, state, lines, payments: paymentRows };
}

/** Locks the invoice row so concurrent payments and voids on it run one after another. */
async function lockInvoice(tx: Db, id: string) {
  const [row] = await tx
    .select({ id: salesInvoices.id, number: salesInvoices.number })
    .from(salesInvoices)
    .where(eq(salesInvoices.id, id))
    .for("update");
  if (!row) throw new DomainError("not_found", "Faktur tidak ditemukan");
  return row;
}

async function insertPayment(
  tx: Db,
  invoice: { id: string; number: string },
  input: PaymentFields & { date: string },
  userId: string,
) {
  const { state } = await getInvoice(tx, invoice.id);
  assertPaymentAllowed(state, input.amount);
  const [payment] = await tx
    .insert(payments)
    .values({ ...input, direction: "receivable", salesInvoiceId: invoice.id, createdBy: userId })
    .returning({ id: payments.id });
  await tx.insert(cashEntries).values({
    accountId: input.accountId,
    date: input.date,
    direction: "in",
    amount: input.amount,
    category: "sale",
    sourceType: "sales_payment",
    sourceId: payment!.id,
    note: `Pembayaran ${invoice.number}`,
    createdBy: userId,
  });
}

export async function createInvoice(db: Db, input: z.output<typeof salesInvoiceInput>, userId: string) {
  return db.transaction(async (tx) => {
    const [customer] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, input.customerId), eq(contacts.kind, "customer")));
    if (!customer) throw new DomainError("invalid", "Pelanggan tidak ditemukan");

    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const costs = new Map(
      (
        await tx.select({ id: products.id, costPrice: products.costPrice }).from(products).where(inArray(products.id, productIds))
      ).map((p) => [p.id, p.costPrice]),
    );
    if (costs.size !== productIds.length) throw new DomainError("invalid", "Ada produk yang tidak ditemukan");

    const totals = computeTotals(input.lines, { kind: input.discountKind, value: input.discountValue });
    const number = await allocateDocNumber(tx, "SO", input.date);
    const [invoice] = await tx
      .insert(salesInvoices)
      .values({
        number,
        customerId: input.customerId,
        date: input.date,
        dueDate: addDays(input.date, input.termsDays),
        termsDays: input.termsDays,
        subtotal: totals.subtotal,
        discountKind: input.discountKind,
        discountValue: input.discountKind === "none" ? 0 : input.discountValue,
        discountAmount: totals.discountAmount,
        total: totals.total,
        note: input.note,
        createdBy: userId,
      })
      .returning({ id: salesInvoices.id, number: salesInvoices.number });

    const lines = input.lines.map((line, i) => ({ ...line, unitCost: costs.get(line.productId)!, lineTotal: totals.lineTotals[i]! }));
    await tx.insert(salesLines).values(lines.map((line, position) => ({ ...line, invoiceId: invoice!.id, position })));
    await tx.insert(stockMovements).values(
      lines.map((line) => ({
        productId: line.productId,
        date: input.date,
        qty: -line.qty,
        reason: "sale" as const,
        unitCost: line.unitCost,
        sourceType: "sales_invoice" as const,
        sourceId: invoice!.id,
        note: number,
        createdBy: userId,
      })),
    );

    if (input.payment) await insertPayment(tx, invoice!, { ...input.payment, date: input.date }, userId);
    return getInvoice(tx, invoice!.id);
  });
}

export async function recordPayment(db: Db, invoiceId: string, input: z.output<typeof salesPaymentInput>, userId: string) {
  return db.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId);
    await insertPayment(tx, invoice, input, userId);
    return getInvoice(tx, invoiceId);
  });
}

export async function voidPayment(
  db: Db,
  invoiceId: string,
  paymentId: string,
  { reason }: z.output<typeof voidInput>,
  userId: string,
) {
  return db.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId);
    const [payment] = await tx
      .update(payments)
      .set({ voidedAt: new Date(), voidedBy: userId, voidReason: reason })
      .where(and(eq(payments.id, paymentId), eq(payments.salesInvoiceId, invoiceId), isNull(payments.voidedAt)))
      .returning({ id: payments.id, accountId: payments.accountId, amount: payments.amount });
    if (!payment) throw new DomainError("conflict", "Pembayaran tidak ditemukan atau sudah di-void");
    await tx.insert(cashEntries).values({
      accountId: payment.accountId,
      date: businessDate(),
      direction: "out",
      amount: payment.amount,
      category: "reversal",
      sourceType: "sales_payment",
      sourceId: payment.id,
      note: `Void pembayaran ${invoice.number}: ${reason}`,
      createdBy: userId,
    });
    return getInvoice(tx, invoiceId);
  });
}

export async function voidInvoice(db: Db, invoiceId: string, { reason }: z.output<typeof voidInput>, userId: string) {
  return db.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId);
    const current = await getInvoice(tx, invoiceId);
    assertInvoiceVoidable({
      voided: current.voidedAt !== null,
      activePayments: current.payments.filter((p) => !p.voidedAt).length,
    });
    await tx
      .update(salesInvoices)
      .set({ voidedAt: new Date(), voidedBy: userId, voidReason: reason })
      .where(eq(salesInvoices.id, invoiceId));
    const sold = await tx
      .select({ productId: stockMovements.productId, qty: stockMovements.qty, unitCost: stockMovements.unitCost })
      .from(stockMovements)
      .where(and(eq(stockMovements.sourceType, "sales_invoice"), eq(stockMovements.sourceId, invoiceId)));
    await tx.insert(stockMovements).values(
      sold.map((m) => ({
        productId: m.productId,
        date: businessDate(),
        qty: -m.qty,
        reason: "reversal" as const,
        unitCost: m.unitCost,
        sourceType: "sales_invoice" as const,
        sourceId: invoiceId,
        note: `Void ${invoice.number}: ${reason}`,
        createdBy: userId,
      })),
    );
    return getInvoice(tx, invoiceId);
  });
}

/** Piutang: open invoices aged per customer, largest balance first. */
export async function listReceivables(db: Db) {
  const today = businessDate();
  const open = (await selectInvoices(db).where(isNull(salesInvoices.voidedAt)))
    .map((row) => withState(row, today))
    .filter((row) => row.state.outstanding > 0);
  const names = new Map(open.map((row) => [row.customerId, row.customerName]));
  const aged = ageReceivables(
    open.map((row) => ({ customerId: row.customerId, dueDate: row.dueDate, outstanding: row.state.outstanding })),
    today,
  );
  const rows = [...aged]
    .map(([customerId, totals]) => ({ id: customerId, customerName: names.get(customerId)!, ...totals }))
    .sort((a, b) => b.total - a.total);
  const totals = ageReceivables(
    open.map((row) => ({ customerId: "all", dueDate: row.dueDate, outstanding: row.state.outstanding })),
    today,
  ).get("all");
  return { asOf: today, rows, totals: totals ?? null };
}
