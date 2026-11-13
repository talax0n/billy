import {
  addDays,
  businessDate,
  computeTotals,
  DomainError,
  formatRupiah,
  type QuotationStatus,
  quotationStatus,
  type quotationConvertInput,
  type quotationInput,
  type quotationListQuery,
  type quotationStatusInput,
} from "@billy/core";
import { contacts, type Db, type DocumentLine, products, quotations, salesInvoices, users } from "@billy/db";
import { and, count, desc, eq, gte, inArray, lt, or, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../env.ts";
import { authorize, pinApprover, type Requirement } from "../../lib/approval.ts";
import { audit } from "../../lib/audit.ts";
import { costAsOf } from "../../lib/cost-as-of.ts";
import { allocateDocNumber } from "../../lib/doc-number.ts";
import { matchAllTerms } from "../../lib/search.ts";
import { getInvoice, insertInvoice, invoiceRequirement } from "../sales/service.ts";

type QuotationInput = z.output<typeof quotationInput>;
type ConvertInput = z.output<typeof quotationConvertInput>;
type Quotation = typeof quotations.$inferSelect;

const selectQuotations = (db: Db) =>
  db
    .select({
      id: quotations.id,
      number: quotations.number,
      customerId: quotations.customerId,
      customerName: contacts.name,
      date: quotations.date,
      validUntil: quotations.validUntil,
      total: quotations.total,
      storedStatus: quotations.status,
      invoiceId: quotations.invoiceId,
      invoiceNumber: salesInvoices.number,
    })
    .from(quotations)
    .innerJoin(contacts, eq(contacts.id, quotations.customerId))
    .leftJoin(salesInvoices, eq(salesInvoices.id, quotations.invoiceId));

const withStatus = <T extends { storedStatus: Quotation["status"]; validUntil: string }>({ storedStatus, ...row }: T, today: string) => ({
  ...row,
  status: quotationStatus(storedStatus, row.validUntil, today),
});

/** `expired` is not stored: draft or sent past the valid-until date. */
function statusWhere(status: QuotationStatus, today: string): SQL {
  const live = or(eq(quotations.status, "draft"), eq(quotations.status, "sent"))!;
  if (status === "expired") return and(live, lt(quotations.validUntil, today))!;
  if (status === "draft" || status === "sent") return and(eq(quotations.status, status), gte(quotations.validUntil, today))!;
  return eq(quotations.status, status);
}

export async function listQuotations(db: Db, query: z.output<typeof quotationListQuery>) {
  const today = businessDate();
  const where = and(
    matchAllTerms(sql`${quotations.number} || ' ' || ${contacts.name}`, query.q),
    query.status ? statusWhere(query.status, today) : undefined,
  );
  const [rows, [counted]] = await Promise.all([
    selectQuotations(db)
      .where(where)
      .orderBy(desc(quotations.date), desc(quotations.number))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(quotations).innerJoin(contacts, eq(contacts.id, quotations.customerId)).where(where),
  ]);
  return { rows: rows.map((row) => withStatus(row, today)), total: counted!.total };
}

export async function getQuotation(db: Db, id: string) {
  const [row] = await db
    .select({
      quotation: quotations,
      createdByName: users.name,
      invoiceNumber: salesInvoices.number,
      customer: { id: contacts.id, code: contacts.code, name: contacts.name, address: contacts.address, phone: contacts.phone },
    })
    .from(quotations)
    .innerJoin(contacts, eq(contacts.id, quotations.customerId))
    .innerJoin(users, eq(users.id, quotations.createdBy))
    .leftJoin(salesInvoices, eq(salesInvoices.id, quotations.invoiceId))
    .where(eq(quotations.id, id));
  if (!row) throw new DomainError("not_found", "Penawaran tidak ditemukan");
  const { quotation, ...rest } = row;
  const catalog = await db
    .select({ id: products.id, code: products.code, name: products.name, variant: products.variant, unit: products.unit })
    .from(products)
    .where(inArray(products.id, quotation.lines.map((l) => l.productId)));
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const { lineTotals } = computeTotals(quotation.lines, { kind: quotation.discountKind, value: quotation.discountValue });
  const lines = quotation.lines.map((line, i) => {
    const product = byId.get(line.productId)!;
    return { ...line, productCode: product.code, productName: product.name, variant: product.variant, unit: product.unit, lineTotal: lineTotals[i]! };
  });
  return { ...withStatus({ ...quotation, storedStatus: quotation.status }, businessDate()), ...rest, lines };
}

/**
 * Penawaran harga. A quote moves no stock and no money and is in no total or report; it only
 * becomes a sale when "Jadikan faktur" turns it into a sales invoice.
 */
export async function createQuotation(db: Db, input: QuotationInput, actor: Actor) {
  const id = await db.transaction(async (tx) => {
    const [customer] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, input.customerId), eq(contacts.kind, "customer")));
    if (!customer) throw new DomainError("invalid", "Pelanggan tidak ditemukan");
    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const known = await tx.select({ id: products.id }).from(products).where(inArray(products.id, productIds));
    if (known.length !== productIds.length) throw new DomainError("invalid", "Ada produk yang tidak ditemukan");

    const discount = { kind: input.discountKind, value: input.discountKind === "none" ? 0 : input.discountValue };
    const totals = computeTotals(input.lines, discount);
    const lines: DocumentLine[] = input.lines.map(({ productId, qty, unitPrice, discountAmount, note }) => ({ productId, qty, unitPrice, discountAmount, note }));
    const number = await allocateDocNumber(tx, "Q", input.date);
    const [row] = await tx
      .insert(quotations)
      .values({
        number,
        customerId: input.customerId,
        date: input.date,
        validUntil: input.validUntil,
        lines,
        subtotal: totals.subtotal,
        discountKind: discount.kind,
        discountValue: discount.value,
        discountAmount: totals.discountAmount,
        total: totals.total,
        note: input.note,
        createdBy: actor.id,
      })
      .returning({ id: quotations.id });
    await audit(tx, actor, {
      action: "quotation.create",
      entityId: row!.id,
      summary: `Penawaran ${number} ${formatRupiah(totals.total)}`,
      after: { number, customerId: input.customerId, date: input.date, validUntil: input.validUntil, total: totals.total, lines },
    });
    return row!.id;
  });
  return getQuotation(db, id);
}

/** Locks a quote that may still change: not accepted, not rejected. */
async function lockLive(tx: Db, id: string) {
  const [quote] = await tx.select().from(quotations).where(eq(quotations.id, id)).for("update");
  if (!quote) throw new DomainError("not_found", "Penawaran tidak ditemukan");
  if (quote.status === "accepted") throw new DomainError("conflict", `Penawaran ${quote.number} sudah dijadikan faktur`);
  if (quote.status === "rejected") throw new DomainError("conflict", `Penawaran ${quote.number} sudah ditolak`);
  return quote;
}

/** Draft → sent, or draft/sent → rejected. */
export async function setQuotationStatus(db: Db, id: string, { status }: z.output<typeof quotationStatusInput>, actor: Actor) {
  await db.transaction(async (tx) => {
    const quote = await lockLive(tx, id);
    if (status === "sent" && quote.status !== "draft") throw new DomainError("conflict", "Penawaran ini sudah terkirim");
    await tx.update(quotations).set({ status }).where(eq(quotations.id, id));
    await audit(tx, actor, {
      action: "quotation.status",
      entityId: id,
      summary: `${quote.number} ${status === "sent" ? "terkirim" : "ditolak"}`,
      before: { status: quote.status },
      after: { status },
    });
  });
  return getQuotation(db, id);
}

/** The invoice a quote converts into: the quote's lines and discount, on the given date and terms. */
const invoiceOf = (quote: Quotation, input: ConvertInput) => ({
  customerId: quote.customerId,
  date: input.date,
  termsDays: input.termsDays,
  discountKind: quote.discountKind,
  discountValue: quote.discountValue,
  note: quote.note,
  lines: quote.lines,
  payment: null,
  approval: input.approval,
});

/**
 * A non-admin converting a quote with a line priced below cost or below the product's normal
 * selling price (net of its line discount) needs approval, as does a discount past the kasir cap.
 * One approval covers both; the subject binds the quote and its exact lines and total.
 */
async function convertRequirement(tx: Db, quote: Quotation, input: ConvertInput, actor: Pick<Actor, "role">): Promise<Requirement | null> {
  if (actor.role === "admin") return null;
  const catalog = await tx
    .select({ id: products.id, sellPrice: products.sellPrice, costPrice: costAsOf(input.date) })
    .from(products)
    .where(inArray(products.id, quote.lines.map((l) => l.productId)));
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const below = quote.lines.some((l) => {
    const p = byId.get(l.productId)!;
    const net = l.qty * l.unitPrice - l.discountAmount;
    return net < l.qty * p.sellPrice || net < l.qty * p.costPrice;
  });
  const discount = await invoiceRequirement(tx, invoiceOf(quote, input), actor);
  if (!below && !discount) return null;
  const messages = [below && "Harga penawaran di bawah harga jual normal atau modal butuh persetujuan admin.", discount?.message].filter(Boolean);
  return {
    kind: below ? "below_cost" : "discount",
    subject: { quotationId: quote.id, date: input.date, total: quote.total, discount: { kind: quote.discountKind, value: quote.discountValue }, lines: quote.lines },
    summary: `Penawaran ${quote.number} jadi faktur · ${formatRupiah(quote.total)}${below ? " · harga di bawah normal" : ""}`,
    message: messages.join(" "),
  };
}

export async function quotationConvertApproval(db: Db, id: string, input: ConvertInput, actor: Pick<Actor, "role">) {
  const [quote] = await db.select().from(quotations).where(eq(quotations.id, id));
  if (!quote) throw new DomainError("not_found", "Penawaran tidak ditemukan");
  return convertRequirement(db, quote, input, actor);
}

/** "Jadikan faktur": a sales invoice with the quote's lines, linked both ways; the quote turns accepted. */
export async function convertQuotation(db: Db, id: string, input: ConvertInput, actor: Actor) {
  const pinAdmin = await pinApprover(db, actor, input.approval);
  const invoiceId = await db.transaction(async (tx) => {
    const quote = await lockLive(tx, id);
    if (quotationStatus(quote.status, quote.validUntil, businessDate()) === "expired") {
      throw new DomainError("conflict", `Penawaran ${quote.number} sudah kedaluwarsa`);
    }
    const approvalId = await authorize(tx, actor, await convertRequirement(tx, quote, input, actor), input.approval, pinAdmin);
    const invoice = await insertInvoice(tx, invoiceOf(quote, input), actor, approvalId);
    await tx.update(quotations).set({ status: "accepted", invoiceId: invoice.id }).where(eq(quotations.id, id));
    await audit(tx, actor, {
      action: "quotation.convert",
      entityId: id,
      summary: `${quote.number} jadi faktur ${invoice.number}`,
      before: { status: quote.status },
      after: { status: "accepted", invoiceId: invoice.id, invoiceNumber: invoice.number, dueDate: addDays(input.date, input.termsDays) },
      approvalId,
    });
    return invoice.id;
  });
  return getInvoice(db, invoiceId);
}
