import { addDays, businessDate, computeTotals, deriveInvoiceStatus, DomainError, dueBucket, netUnitCost, rupiah, type purchaseInput, type purchaseListQuery, type purchasePaymentInput, type movementQuery } from "@billy/core";
import { accounts, cashEntries, contacts, type Db, payments, products, purchaseInvoices, purchaseLines, stockMovements } from "@billy/db";
import { and, asc, desc, eq, gte, ilike, isNull, lte, sql } from "drizzle-orm";
import type { z } from "zod";
import { allocateDocNumber } from "../../lib/doc-number.ts";
import { likePattern } from "../../lib/search.ts";

type Input = z.output<typeof purchaseInput>;
type PaymentInput = z.output<typeof purchasePaymentInput>;

export async function suppliers(db: Db, q: string) {
  return db.select({ id: contacts.id, name: contacts.name, paymentTermsDays: contacts.paymentTermsDays }).from(contacts).where(and(eq(contacts.kind, "supplier"), eq(contacts.active, true), ilike(contacts.name, likePattern(q)))).orderBy(asc(contacts.name)).limit(100);
}
export async function accountLookup(db: Db) {
  return db.select({ id: accounts.id, name: accounts.name, kind: accounts.kind }).from(accounts).where(eq(accounts.active, true)).orderBy(asc(accounts.name));
}

async function lockInvoice(tx: Db, id: string) {
  const [invoice] = await tx.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, id)).for("update");
  if (!invoice) throw new DomainError("not_found", "Faktur pembelian tidak ditemukan");
  return invoice;
}
async function paidAmount(db: Db, id: string) {
  const [row] = await db.select({ paid: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint` }).from(payments).where(and(eq(payments.purchaseInvoiceId, id), isNull(payments.voidedAt)));
  return Number(row?.paid ?? 0);
}
async function recordPayment(tx: Db, invoice: typeof purchaseInvoices.$inferSelect, input: PaymentInput, userId: string) {
  if (invoice.voidedAt) throw new DomainError("invalid", "Faktur sudah dibatalkan");
  if (input.amount > invoice.total - await paidAmount(tx, invoice.id)) throw new DomainError("invalid", "Pembayaran melebihi sisa hutang");
  const [account] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, input.accountId), eq(accounts.active, true)));
  if (!account) throw new DomainError("invalid", "Akun tidak ditemukan atau tidak aktif");
  const [payment] = await tx.insert(payments).values({ ...input, direction: "payable", purchaseInvoiceId: invoice.id, createdBy: userId }).returning();
  if (!payment) throw new Error("Payment insert failed");
  await tx.insert(cashEntries).values({ accountId: input.accountId, date: input.date, direction: "out", amount: input.amount, category: "purchase", sourceType: "purchase_payment", sourceId: payment.id, note: input.note, createdBy: userId });
  return payment;
}
export async function createPurchase(db: Db, input: Input, userId: string) {
  return db.transaction(async (tx) => {
    const [supplier] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, input.supplierId), eq(contacts.kind, "supplier"), eq(contacts.active, true)));
    if (!supplier) throw new DomainError("invalid", "Pemasok tidak ditemukan atau tidak aktif");
    const totals = computeTotals(input.lines.map((line) => ({ qty: line.qty, unitPrice: line.unitCost, discountAmount: line.discountAmount })), { kind: input.discountKind, value: input.discountValue }, input.taxRateBp);
    const [invoice] = await tx.insert(purchaseInvoices).values({ number: await allocateDocNumber(tx, "PO", input.date), supplierId: input.supplierId, supplierInvoiceNumber: input.supplierInvoiceNumber, date: input.date, dueDate: addDays(input.date, input.termsDays), termsDays: input.termsDays, discountKind: input.discountKind, discountValue: input.discountValue, taxRateBp: input.taxRateBp, note: input.note, subtotal: totals.subtotal, discountAmount: totals.discountAmount, taxAmount: totals.taxAmount, total: totals.total, createdBy: userId }).returning();
    if (!invoice) throw new Error("Invoice insert failed");
    for (const [position, line] of input.lines.entries()) {
      const lineTotal = totals.lineTotals[position];
      if (lineTotal === undefined) throw new Error("Missing line total");
      const [product] = await tx.select({ id: products.id }).from(products).where(and(eq(products.id, line.productId), eq(products.active, true)));
      if (!product) throw new DomainError("invalid", "Produk tidak ditemukan atau tidak aktif");
      const cost = netUnitCost(lineTotal, line.qty);
      await tx.insert(purchaseLines).values({ ...line, invoiceId: invoice.id, position, lineTotal });
      await tx.insert(stockMovements).values({ productId: line.productId, date: input.date, qty: line.qty, reason: "purchase", unitCost: cost, sourceType: "purchase_invoice", sourceId: invoice.id, note: line.note, createdBy: userId });
      await tx.update(products).set({ costPrice: cost }).where(eq(products.id, line.productId));
    }
    if (input.payment) await recordPayment(tx, invoice, input.payment, userId);
    return invoice;
  });
}
export async function payPurchase(db: Db, id: string, input: PaymentInput, userId: string) {
  return db.transaction(async (tx) => recordPayment(tx, await lockInvoice(tx, id), input, userId));
}
export async function voidPayment(db: Db, id: string, paymentId: string, reason: string, userId: string) {
  return db.transaction(async (tx) => {
    await lockInvoice(tx, id);
    const [payment] = await tx.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.purchaseInvoiceId, id))).for("update");
    if (!payment) throw new DomainError("not_found", "Pembayaran tidak ditemukan");
    if (payment.voidedAt) throw new DomainError("invalid", "Pembayaran sudah dibatalkan");
    await tx.update(payments).set({ voidedAt: new Date(), voidedBy: userId, voidReason: reason }).where(eq(payments.id, paymentId));
    await tx.insert(cashEntries).values({ accountId: payment.accountId, date: businessDate(), direction: "in", amount: payment.amount, category: "reversal", sourceType: "purchase_payment", sourceId: payment.id, note: reason, createdBy: userId });
    return { ok: true as const };
  });
}
export async function voidPurchase(db: Db, id: string, reason: string, userId: string) {
  return db.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, id);
    if (invoice.voidedAt) throw new DomainError("invalid", "Faktur sudah dibatalkan");
    if (await paidAmount(tx, id) > 0) throw new DomainError("invalid", "Batalkan pembayaran terlebih dahulu");
    await tx.update(purchaseInvoices).set({ voidedAt: new Date(), voidedBy: userId, voidReason: reason }).where(eq(purchaseInvoices.id, id));
    const movements = await tx.select().from(stockMovements).where(and(eq(stockMovements.sourceType, "purchase_invoice"), eq(stockMovements.sourceId, id), eq(stockMovements.reason, "purchase")));
    for (const movement of movements) await tx.insert(stockMovements).values({ productId: movement.productId, date: businessDate(), qty: -movement.qty, reason: "reversal", unitCost: movement.unitCost, sourceType: "purchase_invoice", sourceId: id, note: reason, createdBy: userId });
    // Later purchases may have established a newer cost, so a void never rewinds it.
    return { ok: true as const };
  });
}

async function invoiceRows(db: Db) {
  const rows = await db.select({ invoice: purchaseInvoices, supplierName: contacts.name }).from(purchaseInvoices).innerJoin(contacts, eq(contacts.id, purchaseInvoices.supplierId)).orderBy(desc(purchaseInvoices.date), desc(purchaseInvoices.createdAt));
  const sums = await db.select({ id: payments.purchaseInvoiceId, paid: sql<number>`sum(${payments.amount})::bigint` }).from(payments).where(isNull(payments.voidedAt)).groupBy(payments.purchaseInvoiceId);
  const paid = new Map(sums.map((row) => [row.id, Number(row.paid)]));
  return rows.map(({ invoice, supplierName }) => {
    const amountPaid = rupiah(paid.get(invoice.id) ?? 0);
    const state = deriveInvoiceStatus({ total: invoice.total, paid: amountPaid, dueDate: invoice.dueDate, voided: !!invoice.voidedAt, today: businessDate() });
    return { ...invoice, supplierName, paid: amountPaid, ...state };
  });
}
export async function listPurchases(db: Db, query: z.output<typeof purchaseListQuery>) {
  const rows = (await invoiceRows(db)).filter((row) => (!query.q || `${row.number} ${row.supplierName} ${row.supplierInvoiceNumber}`.toLowerCase().includes(query.q.toLowerCase())) && (!query.from || row.date >= query.from) && (!query.to || row.date <= query.to) && (!query.supplierId || row.supplierId === query.supplierId) && (!query.status || (query.status === "overdue" ? row.overdue : row.status === query.status)));
  return { rows: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: rows.length, summary: { total: rows.reduce((sum, r) => sum + (r.status === "void" ? 0 : r.total), 0), outstanding: rows.reduce((sum, r) => sum + r.outstanding, 0) } };
}
export async function getPurchase(db: Db, id: string) {
  const invoice = (await invoiceRows(db)).find((row) => row.id === id);
  if (!invoice) throw new DomainError("not_found", "Faktur pembelian tidak ditemukan");
  const lines = await db.select({ line: purchaseLines, productName: products.name, variant: products.variant, unit: products.unit }).from(purchaseLines).innerJoin(products, eq(products.id, purchaseLines.productId)).where(eq(purchaseLines.invoiceId, id)).orderBy(asc(purchaseLines.position));
  const history = await db.select({ payment: payments, accountName: accounts.name }).from(payments).innerJoin(accounts, eq(accounts.id, payments.accountId)).where(eq(payments.purchaseInvoiceId, id)).orderBy(desc(payments.date), desc(payments.createdAt));
  return { ...invoice, lines: lines.map(({ line, ...rest }) => ({ ...line, ...rest })), payments: history.map(({ payment, ...rest }) => ({ ...payment, ...rest })) };
}
export async function payables(db: Db) {
  const rows = (await invoiceRows(db)).filter((row) => row.outstanding > 0).map((row) => ({ ...row, bucket: dueBucket(row.dueDate, businessDate()) }));
  return { rows, total: rows.length };
}
export async function listStockMovements(db: Db, query: z.output<typeof movementQuery>) {
  const conditions = and(query.productId ? eq(stockMovements.productId, query.productId) : undefined, query.from ? gte(stockMovements.date, query.from) : undefined, query.to ? lte(stockMovements.date, query.to) : undefined, query.reason ? eq(stockMovements.reason, query.reason) : undefined, query.q ? ilike(products.name, likePattern(query.q)) : undefined);
  const running = sql<number>`(select coalesce(sum(m.qty), 0)::int from stock_movements m where m.product_id = ${stockMovements.productId} and (m.date, m.created_at, m.id) <= (${stockMovements.date}, ${stockMovements.createdAt}, ${stockMovements.id}))`;
  const rows = await db.select({ id: stockMovements.id, productId: products.id, productName: products.name, variant: products.variant, unit: products.unit, date: stockMovements.date, qty: stockMovements.qty, reason: stockMovements.reason, unitCost: stockMovements.unitCost, sourceType: stockMovements.sourceType, sourceId: stockMovements.sourceId, note: stockMovements.note, runningStock: running }).from(stockMovements).innerJoin(products, eq(products.id, stockMovements.productId)).where(conditions).orderBy(desc(stockMovements.date), desc(stockMovements.createdAt), desc(stockMovements.id));
  return { rows: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: rows.length };
}
export async function lowStock(db: Db) {
  const rows = await db.select({ id: products.id, name: products.name, variant: products.variant, unit: products.unit, minStock: products.minStock, stock: sql<number>`coalesce(sum(${stockMovements.qty}), 0)::int` }).from(products).leftJoin(stockMovements, eq(products.id, stockMovements.productId)).where(eq(products.active, true)).groupBy(products.id).having(sql`coalesce(sum(${stockMovements.qty}), 0) <= ${products.minStock}`).orderBy(asc(products.name));
  return { rows, total: rows.length };
}
