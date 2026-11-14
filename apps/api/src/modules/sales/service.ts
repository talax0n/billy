import {
  ageReceivables,
  addDays,
  type ApprovalKind,
  approvalKindLabels,
  assertInvoiceVoidable,
  assertPaymentAllowed,
  breachMessage,
  businessDate,
  combinedDiscountBp,
  computeTotals,
  deriveInvoiceStatus,
  DomainError,
  formatBp,
  formatRupiah,
  invoiceStatusLabel,
  revisionNumber,
  rupiah,
  saleLimitBreaches,
  type salesInvoiceEditInput,
  type salesInvoiceInput,
  type salesListQuery,
  type salesPaymentInput,
  type voidInput,
} from "@billy/core";
import {
  accounts,
  bundleInvoices,
  cashEntries,
  contacts,
  type Db,
  payments,
  products,
  invoiceBundles,
  quotations,
  salesInvoices,
  salesLines,
  stockMovements,
  users,
} from "@billy/db";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../env.ts";
import { authorize, pinApprover, type Requirement } from "../../lib/approval.ts";
import { audit } from "../../lib/audit.ts";
import { costAsOf } from "../../lib/cost-as-of.ts";
import { getLimits } from "../pos/service.ts";
import { allocateDocNumber } from "../../lib/doc-number.ts";
import { invoiceState } from "../../lib/invoice-state.ts";
import { revisionLinks } from "../../lib/revisions.ts";
import { matchAllTerms } from "../../lib/search.ts";
import { assertExportable, xlsxFile } from "../../lib/xlsx.ts";

type PaymentFields = Omit<z.output<typeof salesPaymentInput>, "date">;
type InvoiceInput = z.output<typeof salesInvoiceInput>;
type InvoiceEditInput = z.output<typeof salesInvoiceEditInput>;
/** The document itself, without the payment and approval that may come with it. */
type InvoiceFields = Omit<InvoiceInput, "payment" | "approval">;

function invoiceQuery(db: Db) {
  const state = invoiceState(db, salesInvoices, payments.salesInvoiceId);
  const { paidByInvoice, paid, live, open } = state;

  const select = () =>
    db
      .select({
        id: salesInvoices.id,
        number: salesInvoices.number,
        customerId: salesInvoices.customerId,
        customerName: contacts.name,
        date: salesInvoices.date,
        dueDate: salesInvoices.dueDate,
        total: salesInvoices.total,
        voidedAt: salesInvoices.voidedAt,
        paid,
      })
      .from(salesInvoices)
      .innerJoin(contacts, eq(contacts.id, salesInvoices.customerId))
      .leftJoin(paidByInvoice, eq(paidByInvoice.invoiceId, salesInvoices.id));

  const sum = (value: SQL, where: SQL) => sql<number>`coalesce(sum(${value}) filter (where ${where}), 0)`.mapWith(Number);
  const aggregate = (today: string) =>
    db
      .select({
        rows: count(),
        count: sql<number>`count(*) filter (where ${live})`.mapWith(Number),
        total: sum(sql`${salesInvoices.total}`, live),
        paid: sum(paid, live),
        outstanding: sum(sql`${salesInvoices.total} - ${paid}`, open),
        overdue: sum(sql`${salesInvoices.total} - ${paid}`, state.statusWhere("overdue", today)),
      })
      .from(salesInvoices)
      .innerJoin(contacts, eq(contacts.id, salesInvoices.customerId))
      .leftJoin(paidByInvoice, eq(paidByInvoice.invoiceId, salesInvoices.id));

  /** Rows per status chip; the four are disjoint so they add up to "Semua". */
  const statusCounts = (today: string) =>
    db
      .select({
        overdue: sql<number>`count(*) filter (where ${state.statusWhere("overdue", today)})`.mapWith(Number),
        due: sql<number>`count(*) filter (where ${state.statusWhere("due", today)})`.mapWith(Number),
        paid: sql<number>`count(*) filter (where ${state.statusWhere("paid", today)})`.mapWith(Number),
        void: sql<number>`count(*) filter (where ${state.statusWhere("void", today)})`.mapWith(Number),
      })
      .from(salesInvoices)
      .innerJoin(contacts, eq(contacts.id, salesInvoices.customerId))
      .leftJoin(paidByInvoice, eq(paidByInvoice.invoiceId, salesInvoices.id));

  const listOrder = (query: ListFilter, today: string) =>
    state.listOrder(
      query,
      {
        number: salesInvoices.number,
        customer: contacts.name,
        date: salesInvoices.date,
        dueDate: salesInvoices.dueDate,
        total: salesInvoices.total,
        paid,
        outstanding: sql`case when ${open} then ${salesInvoices.total} - ${paid} else 0 end`,
      },
      [desc(salesInvoices.date), desc(salesInvoices.number)],
      today,
    );

  return { ...state, select, aggregate, statusCounts, listOrder };
}

type InvoiceRow = Awaited<ReturnType<ReturnType<typeof invoiceQuery>["select"]>>[number];

function withState(row: InvoiceRow, today: string) {
  const paid = rupiah(row.paid);
  return { ...row, paid, state: deriveInvoiceStatus({ total: row.total, paid, dueDate: row.dueDate, voided: row.voidedAt !== null, today }) };
}

/** Invoice rows with derived `paid` and `state`, newest first. Shared with tukar faktur. */
export async function invoicesWithState(db: Db, where: SQL | undefined) {
  const today = businessDate();
  const rows = await invoiceQuery(db).select().where(where).orderBy(desc(salesInvoices.date), desc(salesInvoices.number));
  return rows.map((row) => withState(row, today));
}

type ListFilter = Omit<z.output<typeof salesListQuery>, "page" | "pageSize">;

const listWhere = (invoices: ReturnType<typeof invoiceQuery>, query: ListFilter, today: string) =>
  and(periodWhere(query), query.status ? invoices.statusWhere(query.status, today) : undefined);

/** Every list filter except status, so the status chips can count each status. */
const periodWhere = (query: ListFilter) =>
  and(
    query.from ? gte(salesInvoices.date, query.from) : undefined,
    query.to ? lte(salesInvoices.date, query.to) : undefined,
    query.customerId ? eq(salesInvoices.customerId, query.customerId) : undefined,
    matchAllTerms(sql`${salesInvoices.number} || ' ' || ${contacts.name}`, query.q),
  );

export async function listInvoices(db: Db, query: z.output<typeof salesListQuery>) {
  const today = businessDate();
  const invoices = invoiceQuery(db);
  const where = listWhere(invoices, query, today);
  const [rows, [summary], [counts]] = await Promise.all([
    invoices
      .select()
      .where(where)
      .orderBy(...invoices.listOrder(query, today))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    invoices.aggregate(today).where(where),
    invoices.statusCounts(today).where(periodWhere(query)),
  ]);
  const { rows: total, ...totals } = summary!;
  return {
    rows: rows.map((row) => withState(row, today)),
    total,
    summary: {
      count: totals.count,
      total: rupiah(totals.total),
      paid: rupiah(totals.paid),
      outstanding: rupiah(totals.outstanding),
      overdue: rupiah(totals.overdue),
      counts: counts!,
    },
  };
}

/** Every invoice the Penjualan filters match, in the list's priority order, as an .xlsx with a totals row. */
export async function exportInvoices(db: Db, query: ListFilter) {
  const today = businessDate();
  const { rows, summary } = await db.transaction(
    async (tx) => {
      const invoices = invoiceQuery(tx);
      const where = listWhere(invoices, query, today);
      const [summary] = await invoices.aggregate(today).where(where);
      assertExportable(summary!.rows);
      const rows = await invoices.select().where(where).orderBy(...invoices.listOrder(query, today));
      return { rows: rows.map((row) => withState(row, today)), summary: summary! };
    },
    { isolationLevel: "repeatable read" },
  );
  return xlsxFile(
    "Penjualan",
    [
      { header: "Tanggal", width: 13, kind: "date" },
      { header: "Nomor", width: 22, kind: "text" },
      { header: "Pelanggan", width: 30, kind: "text" },
      { header: "Jatuh tempo", width: 13, kind: "date" },
      { header: "Status", width: 12, kind: "text" },
      { header: "Total", width: 18, kind: "money" },
      { header: "Dibayar", width: 18, kind: "money" },
      { header: "Sisa", width: 18, kind: "money" },
    ],
    rows.map((r) => [r.date, r.number, r.customerName, r.dueDate, invoiceStatusLabel(r.state), r.total, r.paid, r.state.outstanding]),
    [null, `${summary.count} faktur, tanpa void`, null, null, null, summary.total, summary.paid, summary.outstanding],
  );
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
      revisionOfId: salesInvoices.revisionOf,
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

  const [lines, paymentRows, [quotation], links] = await Promise.all([
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
    db.select({ id: quotations.id, number: quotations.number }).from(quotations).where(eq(quotations.invoiceId, id)),
    revisionLinks(db, salesInvoices, { id, revisionOf: invoice.revisionOfId }),
  ]);

  const paid = rupiah(paymentRows.reduce((sum, p) => (p.voidedAt ? sum : sum + p.amount), 0));
  const state = deriveInvoiceStatus({
    total: invoice.total,
    paid,
    dueDate: invoice.dueDate,
    voided: invoice.voidedAt !== null,
    today: businessDate(),
  });
  const { revisionOfId: _, ...fields } = invoice;
  return { ...fields, paid, state, lines, payments: paymentRows, quotation: quotation ?? null, ...links };
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
  actor: Actor,
) {
  const userId = actor.id;
  const { state } = await getInvoice(tx, invoice.id);
  assertPaymentAllowed(state, input.amount);
  const [payment] = await tx
    .insert(payments)
    .values({ ...input, direction: "receivable", salesInvoiceId: invoice.id, createdBy: userId })
    .returning({ id: payments.id });
  await audit(tx, actor, {
    action: "sales.payment.create",
    entityId: payment!.id,
    summary: `Pembayaran ${invoice.number} ${formatRupiah(input.amount)}`,
    after: { invoiceId: invoice.id, date: input.date, amount: input.amount, method: input.method, accountId: input.accountId },
  });
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

/** What the approved subject binds: the exact document, so an approval fits no other invoice. */
function invoiceSubject(input: InvoiceFields) {
  const discount = { kind: input.discountKind, value: input.discountValue };
  return {
    customerId: input.customerId,
    date: input.date,
    total: computeTotals(input.lines, discount).total,
    discount,
    lines: input.lines.map(({ productId, qty, unitPrice, discountAmount }) => ({ productId, qty, unitPrice, discountAmount })),
  };
}

interface Need {
  kind: ApprovalKind;
  label: string;
  message: string;
}

/** A non-admin's line and document discounts together past the kasir cap. */
async function discountNeed(tx: Db, input: InvoiceFields): Promise<Need | null> {
  const discount = { kind: input.discountKind, value: input.discountValue };
  const breaches = saleLimitBreaches(input.lines, discount, await getLimits(tx)).filter((b) => b.kind === "discount");
  if (breaches.length === 0) return null;
  return { kind: "discount", label: `Diskon ${formatBp(combinedDiscountBp(input.lines, discount))}`, message: breachMessage(breaches) };
}

/** A non-admin's invoice whose line and document discounts together pass the kasir cap needs approval. */
export async function invoiceRequirement(tx: Db, input: InvoiceFields, actor: Pick<Actor, "role">): Promise<Requirement | null> {
  if (actor.role === "admin") return null;
  const need = await discountNeed(tx, input);
  if (!need) return null;
  const subject = invoiceSubject(input);
  return { kind: need.kind, subject, summary: `${need.label} · faktur ${input.date} · ${formatRupiah(subject.total)}`, message: need.message };
}

/**
 * What a non-admin's Ubah needs approved, in one approval: a lower total (`revisi_lower`, as on
 * the Kasir) and the new invoice's own discount cap. The subject binds the original and the
 * exact new invoice, its total included.
 */
async function editRequirement(
  tx: Db,
  original: { id: string; number: string; total: number },
  input: InvoiceFields,
  actor: Pick<Actor, "role">,
): Promise<Requirement | null> {
  if (actor.role === "admin") return null;
  const subject = { originalId: original.id, ...invoiceSubject(input) };
  const needs: Need[] = [];
  if (subject.total < original.total) {
    needs.push({ kind: "revisi_lower", label: approvalKindLabels.revisi_lower, message: "Perubahan yang menurunkan total faktur butuh persetujuan admin." });
  }
  const discount = await discountNeed(tx, input);
  if (discount) needs.push(discount);
  if (needs.length === 0) return null;
  return {
    kind: needs[0]!.kind,
    subject,
    summary: `Ubah ${original.number} · ${formatRupiah(rupiah(original.total))} → ${formatRupiah(subject.total)} · ${needs.map((n) => n.label).join(" + ")}`,
    message: needs.map((n) => n.message).join(" "),
  };
}

/** For a remote approval request: what this Ubah would need approved, computed as `editInvoice` does. */
export async function invoiceEditApproval(db: Db, originalId: string, input: InvoiceEditInput, actor: Pick<Actor, "role">) {
  const original = await getInvoice(db, originalId);
  if (original.voidedAt) throw new DomainError("conflict", "Faktur ini sudah dibatalkan atau diubah");
  return editRequirement(db, original, input, actor);
}

export const invoiceApproval = (db: Db, input: InvoiceInput, actor: Pick<Actor, "role">) => invoiceRequirement(db, input, actor);

export async function createInvoice(db: Db, input: InvoiceInput, actor: Actor) {
  const pinAdmin = await pinApprover(db, actor, input.approval);
  return db.transaction(async (tx) => {
    const approvalId = await authorize(tx, actor, await invoiceRequirement(tx, input, actor), input.approval, pinAdmin);
    const invoice = await insertInvoice(tx, input, actor, approvalId);
    return getInvoice(tx, invoice.id);
  });
}

/** The invoice, its lines and stock movements, its audit event and an optional payment. Runs inside the caller's transaction. */
export async function insertInvoice(tx: Db, input: InvoiceInput, actor: Actor, approvalId: string | null) {
  const invoice = await writeInvoice(tx, input, actor.id, await allocateDocNumber(tx, "SO", input.date), null);
  await audit(tx, actor, {
    action: "sales.invoice.create",
    entityId: invoice.id,
    summary: `Faktur ${invoice.number} ${formatRupiah(invoice.total)}`,
    after: invoice.snapshot,
    approvalId,
  });
  if (input.payment) await insertPayment(tx, invoice, { ...input.payment, date: input.date }, actor);
  return invoice;
}

/** The invoice row, its lines and its stock movements under `number`. Logs nothing. */
async function writeInvoice(tx: Db, input: InvoiceFields, userId: string, number: string, revisionOf: string | null) {
  const [customer] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, input.customerId), eq(contacts.kind, "customer")));
  if (!customer) throw new DomainError("invalid", "Pelanggan tidak ditemukan");

  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const costs = new Map(
    (
      await tx.select({ id: products.id, costPrice: costAsOf(input.date) }).from(products).where(inArray(products.id, productIds))
    ).map((p) => [p.id, p.costPrice]),
  );
  if (costs.size !== productIds.length) throw new DomainError("invalid", "Ada produk yang tidak ditemukan");

  const totals = computeTotals(input.lines, { kind: input.discountKind, value: input.discountValue });
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
      revisionOf,
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

  const snapshot = {
    number,
    customerId: input.customerId,
    date: input.date,
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    total: totals.total,
    lines: lines.map(({ productId, qty, unitPrice, discountAmount }) => ({ productId, qty, unitPrice, discountAmount })),
  };
  return { id: invoice!.id, number, total: totals.total, snapshot };
}

export async function recordPayment(db: Db, invoiceId: string, input: z.output<typeof salesPaymentInput>, actor: Actor) {
  return db.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId);
    await insertPayment(tx, invoice, input, actor);
    return getInvoice(tx, invoiceId);
  });
}

export async function voidPayment(
  db: Db,
  invoiceId: string,
  paymentId: string,
  { reason }: z.output<typeof voidInput>,
  actor: Actor,
) {
  const userId = actor.id;
  return db.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId);
    const [payment] = await tx
      .update(payments)
      .set({ voidedAt: new Date(), voidedBy: userId, voidReason: reason })
      .where(and(eq(payments.id, paymentId), eq(payments.salesInvoiceId, invoiceId), isNull(payments.voidedAt)))
      .returning({ id: payments.id, accountId: payments.accountId, amount: payments.amount });
    if (!payment) throw new DomainError("conflict", "Pembayaran tidak ditemukan atau sudah dibatalkan");
    await tx.insert(cashEntries).values({
      accountId: payment.accountId,
      date: businessDate(),
      direction: "out",
      amount: payment.amount,
      category: "reversal",
      sourceType: "sales_payment",
      sourceId: payment.id,
      note: `Pembatalan pembayaran ${invoice.number}: ${reason}`,
      createdBy: userId,
    });
    await audit(tx, actor, {
      action: "sales.payment.void",
      entityId: payment.id,
      summary: `Pembatalan pembayaran ${invoice.number} ${formatRupiah(payment.amount)}`,
      before: { voidedAt: null },
      after: { voidedAt: new Date().toISOString(), amount: payment.amount },
      reason,
    });
    return getInvoice(tx, invoiceId);
  });
}

export async function voidInvoice(db: Db, invoiceId: string, { reason }: z.output<typeof voidInput>, actor: Actor) {
  return db.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId);
    const current = await getInvoice(tx, invoiceId);
    assertInvoiceVoidable({
      voided: current.voidedAt !== null,
      activePayments: current.payments.filter((p) => !p.voidedAt).length,
    });
    await reverseInvoice(tx, invoice, reason, actor.id);
    await audit(tx, actor, {
      action: "sales.invoice.void",
      entityId: invoiceId,
      summary: `Pembatalan faktur ${invoice.number} ${formatRupiah(current.total)}`,
      before: { voidedAt: null },
      after: { voidedAt: new Date().toISOString(), total: current.total },
      reason,
    });
    return getInvoice(tx, invoiceId);
  });
}

/** Marks the invoice void and puts its goods back in stock, dated today (ground rule 3). Logs nothing. */
async function reverseInvoice(tx: Db, invoice: { id: string; number: string }, reason: string, userId: string) {
  await tx
    .update(salesInvoices)
    .set({ voidedAt: new Date(), voidedBy: userId, voidReason: reason })
    .where(eq(salesInvoices.id, invoice.id));
  const sold = await tx
    .select({ productId: stockMovements.productId, qty: stockMovements.qty, unitCost: stockMovements.unitCost })
    .from(stockMovements)
    .where(and(eq(stockMovements.sourceType, "sales_invoice"), eq(stockMovements.sourceId, invoice.id)));
  await tx.insert(stockMovements).values(
    sold.map((m) => ({
      productId: m.productId,
      date: businessDate(),
      qty: -m.qty,
      reason: "reversal" as const,
      unitCost: m.unitCost,
      sourceType: "sales_invoice" as const,
      sourceId: invoice.id,
      note: `Pembatalan ${invoice.number}: ${reason}`,
      createdBy: userId,
    })),
  );
}

/**
 * Ubah: voids the invoice ("Diubah: <reason>") and posts the corrected one as `<number>/R<n>`,
 * linked by `revision_of`, in one transaction with one audit event. The original's live payments
 * move to the new invoice, so no money moves; refused when they exceed the new total. A live
 * tukar faktur and the penawaran it came from follow it to the new invoice.
 */
export async function editInvoice(db: Db, invoiceId: string, input: InvoiceEditInput, actor: Actor) {
  const pinAdmin = await pinApprover(db, actor, input.approval);
  return db.transaction(async (tx) => {
    await lockInvoice(tx, invoiceId);
    const original = await getInvoice(tx, invoiceId);
    if (original.voidedAt) throw new DomainError("conflict", "Faktur ini sudah dibatalkan atau diubah");
    const approvalId = await authorize(tx, actor, await editRequirement(tx, original, input, actor), input.approval, pinAdmin);
    const total = invoiceSubject(input).total;
    if (original.paid > total) {
      throw new DomainError(
        "invalid",
        `Faktur ini sudah dibayar ${formatRupiah(original.paid)}, lebih dari total baru ${formatRupiah(total)}. Batalkan pembayaran yang berlebih dulu.`,
      );
    }
    const bundles = await tx
      .select({ id: invoiceBundles.id, number: invoiceBundles.number })
      .from(bundleInvoices)
      .innerJoin(invoiceBundles, eq(invoiceBundles.id, bundleInvoices.bundleId))
      .where(and(eq(bundleInvoices.invoiceId, invoiceId), isNull(invoiceBundles.voidedAt)));
    if (bundles.length > 0 && input.customerId !== original.customer.id) {
      throw new DomainError("invalid", `Faktur ini ada di tukar faktur ${bundles[0]!.number}, jadi pelanggannya tidak bisa diganti`);
    }

    await reverseInvoice(tx, original, `Diubah: ${input.reason}`, actor.id);
    const invoice = await writeInvoice(tx, input, actor.id, revisionNumber(original.number), original.id);
    const moved = await tx
      .update(payments)
      .set({ salesInvoiceId: invoice.id })
      .where(and(eq(payments.salesInvoiceId, invoiceId), isNull(payments.voidedAt)))
      .returning({ id: payments.id });
    if (bundles.length > 0) {
      await tx
        .update(bundleInvoices)
        .set({ invoiceId: invoice.id })
        .where(and(eq(bundleInvoices.invoiceId, invoiceId), inArray(bundleInvoices.bundleId, bundles.map((b) => b.id))));
    }
    await tx.update(quotations).set({ invoiceId: invoice.id }).where(eq(quotations.invoiceId, invoiceId));
    await audit(tx, actor, {
      action: "sales.invoice.edit",
      entityId: invoice.id,
      summary: `Ubah ${original.number} → ${invoice.number} · ${formatRupiah(original.total)} → ${formatRupiah(invoice.total)}`,
      before: {
        invoiceId,
        number: original.number,
        customerId: original.customer.id,
        date: original.date,
        total: original.total,
        lines: original.lines.map(({ productId, qty, unitPrice, discountAmount }) => ({ productId, qty, unitPrice, discountAmount })),
      },
      after: {
        invoiceId: invoice.id,
        ...invoice.snapshot,
        paymentIds: moved.map((p) => p.id),
        ...(bundles.length > 0 && { bundleIds: bundles.map((b) => b.id) }),
      },
      reason: input.reason,
      approvalId,
    });
    return getInvoice(tx, invoice.id);
  });
}

/** Piutang: open invoices aged per customer, largest balance first. */
export async function listReceivables(db: Db) {
  const today = businessDate();
  const open = (await invoicesWithState(db, isNull(salesInvoices.voidedAt))).filter((row) => row.state.outstanding > 0);
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
