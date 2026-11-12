import {
  addDays,
  businessDate,
  computeTotals,
  deriveInvoiceStatus,
  DomainError,
  type DueBucket,
  dueBucket,
  formatRupiah,
  netUnitCost,
  type PaginationQuery,
  type purchaseInput,
  type purchaseListQuery,
  type purchasePaymentInput,
  rupiah,
  type Rupiah,
} from "@billy/core";
import {
  accounts,
  cashEntries,
  contacts,
  type Db,
  payments,
  products,
  purchaseInvoices,
  purchaseLines,
  stockMovements,
  users,
} from "@billy/db";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { allocateDocNumber } from "../../lib/doc-number.ts";
import { invoiceState } from "../../lib/invoice-state.ts";
import { matchAllTerms } from "../../lib/search.ts";

type PurchaseInput = z.output<typeof purchaseInput>;
type PaymentInput = z.output<typeof purchasePaymentInput>;
type ListQuery = z.output<typeof purchaseListQuery>;

const notFound = () => new DomainError("not_found", "Faktur pembelian tidak ditemukan");

function invoiceQuery(db: Db) {
  const state = invoiceState(db, purchaseInvoices, payments.purchaseInvoiceId);
  const { paidByInvoice, paid, open } = state;

  const select = () =>
    db
      .select({
        id: purchaseInvoices.id,
        number: purchaseInvoices.number,
        supplierInvoiceNumber: purchaseInvoices.supplierInvoiceNumber,
        supplierId: purchaseInvoices.supplierId,
        supplierName: contacts.name,
        date: purchaseInvoices.date,
        dueDate: purchaseInvoices.dueDate,
        termsDays: purchaseInvoices.termsDays,
        subtotal: purchaseInvoices.subtotal,
        discountKind: purchaseInvoices.discountKind,
        discountValue: purchaseInvoices.discountValue,
        discountAmount: purchaseInvoices.discountAmount,
        taxRateBp: purchaseInvoices.taxRateBp,
        taxAmount: purchaseInvoices.taxAmount,
        total: purchaseInvoices.total,
        note: purchaseInvoices.note,
        createdAt: purchaseInvoices.createdAt,
        voidedAt: purchaseInvoices.voidedAt,
        voidReason: purchaseInvoices.voidReason,
        paid,
      })
      .from(purchaseInvoices)
      .innerJoin(contacts, eq(contacts.id, purchaseInvoices.supplierId))
      .leftJoin(paidByInvoice, eq(paidByInvoice.invoiceId, purchaseInvoices.id));

  const aggregate = () =>
    db
      .select({
        count: count(),
        purchased: sql<number>`coalesce(sum(${purchaseInvoices.total}) filter (where ${purchaseInvoices.voidedAt} is null), 0)`.mapWith(Number),
        outstanding: sql<number>`coalesce(sum(${purchaseInvoices.total} - ${paid}) filter (where ${open}), 0)`.mapWith(Number),
      })
      .from(purchaseInvoices)
      .innerJoin(contacts, eq(contacts.id, purchaseInvoices.supplierId))
      .leftJoin(paidByInvoice, eq(paidByInvoice.invoiceId, purchaseInvoices.id));

  return { ...state, select, aggregate };
}

type InvoiceRow = Awaited<ReturnType<ReturnType<typeof invoiceQuery>["select"]>>[number];

function withState(row: InvoiceRow, today: string) {
  const paid = rupiah(row.paid);
  return { ...row, paid, ...deriveInvoiceStatus({ total: row.total, paid, dueDate: row.dueDate, voided: row.voidedAt !== null, today }) };
}

export async function listPurchases(db: Db, query: ListQuery) {
  const today = businessDate();
  const invoices = invoiceQuery(db);
  const where = and(
    matchAllTerms(sql`${purchaseInvoices.number} || ' ' || ${purchaseInvoices.supplierInvoiceNumber} || ' ' || ${contacts.name}`, query.q),
    query.from ? gte(purchaseInvoices.date, query.from) : undefined,
    query.to ? lte(purchaseInvoices.date, query.to) : undefined,
    query.supplierId ? eq(purchaseInvoices.supplierId, query.supplierId) : undefined,
    query.status ? invoices.statusWhere(query.status, today) : undefined,
  );
  const [rows, [summary]] = await Promise.all([
    invoices
      .select()
      .where(where)
      .orderBy(desc(purchaseInvoices.date), desc(purchaseInvoices.number))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    invoices.aggregate().where(where),
  ]);
  return {
    rows: rows.map((row) => withState(row, today)),
    total: summary!.count,
    summary: { purchased: rupiah(summary!.purchased), outstanding: rupiah(summary!.outstanding) },
  };
}

export async function getPurchase(db: Db, id: string) {
  const [invoice] = await invoiceQuery(db).select().where(eq(purchaseInvoices.id, id));
  if (!invoice) throw notFound();
  const [lines, history] = await Promise.all([
    db
      .select({
        id: purchaseLines.id,
        productId: purchaseLines.productId,
        productName: products.name,
        variant: products.variant,
        unit: products.unit,
        qty: purchaseLines.qty,
        unitCost: purchaseLines.unitCost,
        discountAmount: purchaseLines.discountAmount,
        lineTotal: purchaseLines.lineTotal,
        note: purchaseLines.note,
      })
      .from(purchaseLines)
      .innerJoin(products, eq(products.id, purchaseLines.productId))
      .where(eq(purchaseLines.invoiceId, id))
      .orderBy(asc(purchaseLines.position)),
    db
      .select({
        id: payments.id,
        date: payments.date,
        amount: payments.amount,
        method: payments.method,
        note: payments.note,
        accountName: accounts.name,
        createdByName: users.name,
        createdAt: payments.createdAt,
        voidedAt: payments.voidedAt,
        voidReason: payments.voidReason,
      })
      .from(payments)
      .innerJoin(accounts, eq(accounts.id, payments.accountId))
      .innerJoin(users, eq(users.id, payments.createdBy))
      .where(eq(payments.purchaseInvoiceId, id))
      .orderBy(asc(payments.createdAt)),
  ]);
  return { ...withState(invoice, businessDate()), lines, payments: history };
}

async function lockInvoice(tx: Db, id: string) {
  const [invoice] = await tx
    .select({ id: purchaseInvoices.id, total: purchaseInvoices.total, voidedAt: purchaseInvoices.voidedAt })
    .from(purchaseInvoices)
    .where(eq(purchaseInvoices.id, id))
    .for("update");
  if (!invoice) throw notFound();
  return invoice;
}

async function paidSoFar(tx: Db, invoiceId: string): Promise<Rupiah> {
  const [row] = await tx
    .select({ paid: sql<number>`coalesce(sum(${payments.amount}), 0)`.mapWith(Number) })
    .from(payments)
    .where(and(eq(payments.purchaseInvoiceId, invoiceId), isNull(payments.voidedAt)));
  return rupiah(row!.paid);
}

/** Payment + cash entry `out` / `purchase`. Call with the invoice row locked. */
async function recordPayment(tx: Db, invoice: Awaited<ReturnType<typeof lockInvoice>>, input: PaymentInput, userId: string) {
  if (invoice.voidedAt) throw new DomainError("invalid", "Faktur ini sudah di-void");
  const outstanding = rupiah(invoice.total - (await paidSoFar(tx, invoice.id)));
  if (input.amount > outstanding) {
    throw new DomainError("invalid", `Pembayaran melebihi sisa hutang (${formatRupiah(outstanding)})`);
  }
  const [account] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), eq(accounts.active, true)));
  if (!account) throw new DomainError("invalid", "Akun pembayaran tidak ditemukan atau nonaktif");

  const [payment] = await tx
    .insert(payments)
    .values({ ...input, direction: "payable", purchaseInvoiceId: invoice.id, createdBy: userId })
    .returning({ id: payments.id });
  await tx.insert(cashEntries).values({
    accountId: input.accountId,
    date: input.date,
    direction: "out",
    amount: input.amount,
    category: "purchase",
    sourceType: "purchase_payment",
    sourceId: payment!.id,
    note: input.note,
    createdBy: userId,
  });
  return payment!;
}

/**
 * Posts a supplier invoice: lines, a `purchase` stock movement per line valued at its net unit
 * cost, the products' latest cost, and the optional "bayar sekarang" payment, in one transaction.
 */
export async function createPurchase(db: Db, input: PurchaseInput, userId: string) {
  const totals = computeTotals(
    input.lines.map((line) => ({ qty: line.qty, unitPrice: line.unitCost, discountAmount: line.discountAmount })),
    { kind: input.discountKind, value: input.discountValue },
    input.taxRateBp,
  );
  const lines = input.lines.map((line, position) => {
    const lineTotal = totals.lineTotals[position]!;
    return { ...line, position, lineTotal, netUnitCost: netUnitCost(lineTotal, line.qty) };
  });

  const id = await db.transaction(async (tx) => {
    const [supplier] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, input.supplierId), eq(contacts.kind, "supplier")));
    if (!supplier) throw new DomainError("invalid", "Pemasok tidak ditemukan");
    const productIds = [...new Set(lines.map((line) => line.productId))];
    const found = await tx.select({ id: products.id }).from(products).where(inArray(products.id, productIds));
    if (found.length !== productIds.length) throw new DomainError("invalid", "Ada produk yang tidak ditemukan");

    const [invoice] = await tx
      .insert(purchaseInvoices)
      .values({
        number: await allocateDocNumber(tx, "PO", input.date),
        supplierInvoiceNumber: input.supplierInvoiceNumber,
        supplierId: input.supplierId,
        date: input.date,
        dueDate: addDays(input.date, input.termsDays),
        termsDays: input.termsDays,
        discountKind: input.discountKind,
        discountValue: input.discountValue,
        taxRateBp: input.taxRateBp,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        total: totals.total,
        note: input.note,
        createdBy: userId,
      })
      .returning({ id: purchaseInvoices.id, total: purchaseInvoices.total, voidedAt: purchaseInvoices.voidedAt });

    await tx.insert(purchaseLines).values(
      lines.map((line) => ({
        invoiceId: invoice!.id,
        position: line.position,
        productId: line.productId,
        note: line.note,
        qty: line.qty,
        unitCost: line.unitCost,
        discountAmount: line.discountAmount,
        lineTotal: line.lineTotal,
      })),
    );
    await tx.insert(stockMovements).values(
      lines.map((line) => ({
        productId: line.productId,
        date: input.date,
        qty: line.qty,
        reason: "purchase" as const,
        unitCost: line.netUnitCost,
        sourceType: "purchase_invoice" as const,
        sourceId: invoice!.id,
        note: line.note,
        createdBy: userId,
      })),
    );
    // Latest-cost method: a product listed twice ends at its last line's cost.
    for (const line of lines) {
      await tx.update(products).set({ costPrice: line.netUnitCost }).where(eq(products.id, line.productId));
    }
    if (input.payment) await recordPayment(tx, invoice!, input.payment, userId);
    return invoice!.id;
  });
  return getPurchase(db, id);
}

export async function payPurchase(db: Db, id: string, input: PaymentInput, userId: string) {
  await db.transaction(async (tx) => recordPayment(tx, await lockInvoice(tx, id), input, userId));
  return getPurchase(db, id);
}

/** Marks the payment void and puts the money back with a reversal cash entry dated today. */
export async function voidPayment(db: Db, id: string, paymentId: string, reason: string, userId: string) {
  await db.transaction(async (tx) => {
    await lockInvoice(tx, id);
    const [payment] = await tx
      .select({ accountId: payments.accountId, amount: payments.amount, voidedAt: payments.voidedAt })
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.purchaseInvoiceId, id)));
    if (!payment) throw new DomainError("not_found", "Pembayaran tidak ditemukan");
    if (payment.voidedAt) throw new DomainError("invalid", "Pembayaran ini sudah di-void");

    await tx
      .update(payments)
      .set({ voidedAt: new Date(), voidedBy: userId, voidReason: reason })
      .where(eq(payments.id, paymentId));
    await tx.insert(cashEntries).values({
      accountId: payment.accountId,
      date: businessDate(),
      direction: "in",
      amount: payment.amount,
      category: "reversal",
      sourceType: "purchase_payment",
      sourceId: paymentId,
      note: reason,
      createdBy: userId,
    });
  });
  return getPurchase(db, id);
}

/** Refused while a non-voided payment exists; otherwise takes the goods back out of stock. */
export async function voidPurchase(db: Db, id: string, reason: string, userId: string) {
  await db.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, id);
    if (invoice.voidedAt) throw new DomainError("invalid", "Faktur ini sudah di-void");
    if ((await paidSoFar(tx, id)) > 0) {
      throw new DomainError("invalid", "Faktur masih punya pembayaran. Void pembayarannya dulu.");
    }

    await tx
      .update(purchaseInvoices)
      .set({ voidedAt: new Date(), voidedBy: userId, voidReason: reason })
      .where(eq(purchaseInvoices.id, id));
    const posted = await tx
      .select({ productId: stockMovements.productId, qty: stockMovements.qty, unitCost: stockMovements.unitCost })
      .from(stockMovements)
      .where(
        and(eq(stockMovements.sourceType, "purchase_invoice"), eq(stockMovements.sourceId, id), eq(stockMovements.reason, "purchase")),
      );
    await tx.insert(stockMovements).values(
      posted.map((movement) => ({
        productId: movement.productId,
        date: businessDate(),
        qty: -movement.qty,
        reason: "reversal" as const,
        unitCost: movement.unitCost,
        sourceType: "purchase_invoice" as const,
        sourceId: id,
        note: reason,
        createdBy: userId,
      })),
    );
    // products.cost_price stays as is: a later purchase may already have set a newer cost, and
    // the previous cost is not recorded anywhere to roll back to.
  });
  return getPurchase(db, id);
}

const emptyBuckets = (): Record<DueBucket, Rupiah> => ({
  late: rupiah(0),
  within7: rupiah(0),
  within30: rupiah(0),
  later: rupiah(0),
});

async function openPayables(db: Db, where?: SQL) {
  const today = businessDate();
  const invoices = invoiceQuery(db);
  const rows = await invoices
    .select()
    .where(and(invoices.open, where))
    .orderBy(asc(purchaseInvoices.dueDate), asc(purchaseInvoices.number));
  return rows.map((row) => {
    const invoice = withState(row, today);
    return { ...invoice, bucket: dueBucket(invoice.dueDate, today) };
  });
}

/**
 * Open payables per supplier, split into due buckets, most urgent supplier first.
 * ponytail: groups in memory; open bills number in the hundreds. Group in SQL if that grows.
 */
export async function listPayables(db: Db, { q, page, pageSize }: PaginationQuery) {
  const invoices = await openPayables(db, matchAllTerms(sql`${contacts.name} || ' ' || ${contacts.code}`, q));
  const totals = { ...emptyBuckets(), total: rupiah(0) };
  const bySupplier = new Map<string, { id: string; supplierName: string; invoiceCount: number; nextDueDate: string } & typeof totals>();
  for (const invoice of invoices) {
    const supplier = bySupplier.get(invoice.supplierId) ?? {
      id: invoice.supplierId,
      supplierName: invoice.supplierName,
      invoiceCount: 0,
      nextDueDate: invoice.dueDate,
      ...emptyBuckets(),
      total: rupiah(0),
    };
    supplier.invoiceCount += 1;
    for (const target of [supplier, totals]) {
      target[invoice.bucket] = rupiah(target[invoice.bucket] + invoice.outstanding);
      target.total = rupiah(target.total + invoice.outstanding);
    }
    bySupplier.set(invoice.supplierId, supplier);
  }
  const suppliers = [...bySupplier.values()];
  return {
    rows: suppliers.slice((page - 1) * pageSize, page * pageSize),
    total: suppliers.length,
    totals,
    asOf: businessDate(),
  };
}

export async function listSupplierPayables(db: Db, supplierId: string) {
  const rows = await openPayables(db, eq(purchaseInvoices.supplierId, supplierId));
  return { rows, total: rows.length };
}
