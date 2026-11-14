import {
  addDays,
  businessDate,
  computeTotals,
  deriveInvoiceStatus,
  DomainError,
  type DueBucket,
  dueBucket,
  formatRupiah,
  invoiceStatusLabel,
  netUnitCost,
  type PaginationQuery,
  type purchaseEditInput,
  type purchaseInput,
  type purchaseListQuery,
  type purchasePaymentInput,
  revisionNumber,
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
import type { Actor } from "../../env.ts";
import { audit } from "../../lib/audit.ts";
import { costAsOf } from "../../lib/cost-as-of.ts";
import { allocateDocNumber } from "../../lib/doc-number.ts";
import { invoiceState } from "../../lib/invoice-state.ts";
import { revisionLinks } from "../../lib/revisions.ts";
import { matchAllTerms } from "../../lib/search.ts";
import { assertExportable, xlsxFile } from "../../lib/xlsx.ts";

type PurchaseInput = z.output<typeof purchaseInput>;
type PurchaseEditInput = z.output<typeof purchaseEditInput>;
/** The document itself, without the payment that may come with it. */
type PurchaseFields = Omit<PurchaseInput, "payment">;
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
        revisionOfId: purchaseInvoices.revisionOf,
        createdAt: purchaseInvoices.createdAt,
        voidedAt: purchaseInvoices.voidedAt,
        voidReason: purchaseInvoices.voidReason,
        paid,
      })
      .from(purchaseInvoices)
      .innerJoin(contacts, eq(contacts.id, purchaseInvoices.supplierId))
      .leftJoin(paidByInvoice, eq(paidByInvoice.invoiceId, purchaseInvoices.id));

  const owed = (where: SQL) => sql<number>`coalesce(sum(${purchaseInvoices.total} - ${paid}) filter (where ${where}), 0)`.mapWith(Number);
  const aggregate = (today: string) =>
    db
      .select({
        count: count(),
        purchased: sql<number>`coalesce(sum(${purchaseInvoices.total}) filter (where ${purchaseInvoices.voidedAt} is null), 0)`.mapWith(Number),
        paid: sql<number>`coalesce(sum(${paid}) filter (where ${purchaseInvoices.voidedAt} is null), 0)`.mapWith(Number),
        outstanding: owed(open),
        overdue: owed(state.statusWhere("overdue", today)),
        /** The Hutang "≤7 hari" bucket: due today through today + 7. */
        dueSoon: owed(and(open, gte(purchaseInvoices.dueDate, today), lte(purchaseInvoices.dueDate, addDays(today, 7)))!),
      })
      .from(purchaseInvoices)
      .innerJoin(contacts, eq(contacts.id, purchaseInvoices.supplierId))
      .leftJoin(paidByInvoice, eq(paidByInvoice.invoiceId, purchaseInvoices.id));

  const listOrder = (query: ListFilter, today: string) =>
    state.listOrder(
      query,
      {
        number: purchaseInvoices.number,
        date: purchaseInvoices.date,
        supplier: contacts.name,
        dueDate: purchaseInvoices.dueDate,
        total: purchaseInvoices.total,
        outstanding: sql`case when ${open} then ${purchaseInvoices.total} - ${paid} else 0 end`,
      },
      [desc(purchaseInvoices.date), desc(purchaseInvoices.number)],
      today,
    );

  return { ...state, select, aggregate, listOrder };
}

type InvoiceRow = Awaited<ReturnType<ReturnType<typeof invoiceQuery>["select"]>>[number];

function withState(row: InvoiceRow, today: string) {
  const paid = rupiah(row.paid);
  return { ...row, paid, ...deriveInvoiceStatus({ total: row.total, paid, dueDate: row.dueDate, voided: row.voidedAt !== null, today }) };
}

type ListFilter = Omit<ListQuery, "page" | "pageSize">;

const listWhere = (invoices: ReturnType<typeof invoiceQuery>, query: ListFilter, today: string) =>
  and(
    matchAllTerms(sql`${purchaseInvoices.number} || ' ' || ${purchaseInvoices.supplierInvoiceNumber} || ' ' || ${contacts.name}`, query.q),
    query.from ? gte(purchaseInvoices.date, query.from) : undefined,
    query.to ? lte(purchaseInvoices.date, query.to) : undefined,
    query.supplierId ? eq(purchaseInvoices.supplierId, query.supplierId) : undefined,
    query.status ? invoices.statusWhere(query.status, today) : undefined,
  );

/** Every supplier invoice the Pembelian filters match, in the list's order, as an .xlsx with a totals row. */
export async function exportPurchases(db: Db, query: ListFilter) {
  const today = businessDate();
  const { rows, summary } = await db.transaction(
    async (tx) => {
      const invoices = invoiceQuery(tx);
      const where = listWhere(invoices, query, today);
      const [summary] = await invoices.aggregate(today).where(where);
      assertExportable(summary!.count);
      const rows = await invoices.select().where(where).orderBy(...invoices.listOrder(query, today));
      return { rows: rows.map((row) => withState(row, today)), summary: summary! };
    },
    { isolationLevel: "repeatable read" },
  );
  const live = rows.filter((r) => r.status !== "void");
  return xlsxFile(
    "Pembelian",
    [
      { header: "Tanggal", width: 13, kind: "date" },
      { header: "Nomor", width: 22, kind: "text" },
      { header: "No. pemasok", width: 18, kind: "text" },
      { header: "Pemasok", width: 30, kind: "text" },
      { header: "Jatuh tempo", width: 13, kind: "date" },
      { header: "Status", width: 12, kind: "text" },
      { header: "Total", width: 18, kind: "money" },
      { header: "Dibayar", width: 18, kind: "money" },
      { header: "Sisa", width: 18, kind: "money" },
    ],
    rows.map((r) => [r.date, r.number, r.supplierInvoiceNumber, r.supplierName, r.dueDate, invoiceStatusLabel(r), r.total, r.paid, r.outstanding]),
    [
      null,
      `${live.length} faktur, tanpa void`,
      null,
      null,
      null,
      null,
      summary.purchased,
      live.reduce((sum, r) => sum + r.paid, 0),
      summary.outstanding,
    ],
  );
}

export async function listPurchases(db: Db, query: ListQuery) {
  const today = businessDate();
  const invoices = invoiceQuery(db);
  const where = listWhere(invoices, query, today);
  const [rows, [summary]] = await Promise.all([
    invoices
      .select()
      .where(where)
      .orderBy(...invoices.listOrder(query, today))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    invoices.aggregate(today).where(where),
  ]);
  return {
    rows: rows.map((row) => withState(row, today)),
    total: summary!.count,
    summary: {
      purchased: rupiah(summary!.purchased),
      paid: rupiah(summary!.paid),
      outstanding: rupiah(summary!.outstanding),
      overdue: rupiah(summary!.overdue),
      dueSoon: rupiah(summary!.dueSoon),
    },
  };
}

export async function getPurchase(db: Db, id: string) {
  const [invoice] = await invoiceQuery(db).select().where(eq(purchaseInvoices.id, id));
  if (!invoice) throw notFound();
  const [lines, history, links] = await Promise.all([
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
    revisionLinks(db, purchaseInvoices, { id, revisionOf: invoice.revisionOfId }),
  ]);
  const { revisionOfId: _, ...detail } = withState(invoice, businessDate());
  return { ...detail, lines, payments: history, ...links };
}

async function lockInvoice(tx: Db, id: string) {
  const [invoice] = await tx
    .select({ id: purchaseInvoices.id, number: purchaseInvoices.number, total: purchaseInvoices.total, voidedAt: purchaseInvoices.voidedAt })
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
async function recordPayment(tx: Db, invoice: Awaited<ReturnType<typeof lockInvoice>>, input: PaymentInput, actor: Actor) {
  const userId = actor.id;
  if (invoice.voidedAt) throw new DomainError("invalid", "Faktur ini sudah dibatalkan");
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
  await audit(tx, actor, {
    action: "purchase.payment.create",
    entityId: payment!.id,
    summary: `Pembayaran ${invoice.number} ${formatRupiah(input.amount)}`,
    after: { invoiceId: invoice.id, date: input.date, amount: input.amount, method: input.method, accountId: input.accountId },
  });
  return payment!;
}

/** Totals and lines with their net unit cost, as the server posts them. */
function priceLines(input: PurchaseFields) {
  const totals = computeTotals(
    input.lines.map((line) => ({ qty: line.qty, unitPrice: line.unitCost, discountAmount: line.discountAmount })),
    { kind: input.discountKind, value: input.discountValue },
    input.taxRateBp,
  );
  const lines = input.lines.map((line, position) => {
    const lineTotal = totals.lineTotals[position]!;
    return { ...line, position, lineTotal, netUnitCost: netUnitCost(lineTotal, line.qty) };
  });
  return { totals, lines };
}

/**
 * The invoice row, its lines, a `purchase` stock movement per line valued at its net unit cost,
 * and the products' latest cost, under `number`. Logs nothing; returns what the log records.
 */
async function writePurchase(tx: Db, input: PurchaseFields, userId: string, number: string, revisionOf: string | null) {
  const { totals, lines } = priceLines(input);
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
      number,
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
      revisionOf,
      createdBy: userId,
    })
    .returning({ id: purchaseInvoices.id, number: purchaseInvoices.number, total: purchaseInvoices.total, voidedAt: purchaseInvoices.voidedAt });

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
  const costsBefore = new Map(
    (await tx.select({ id: products.id, costPrice: products.costPrice }).from(products).where(inArray(products.id, productIds))).map(
      (p) => [p.id, p.costPrice],
    ),
  );
  for (const line of lines) {
    await tx.update(products).set({ costPrice: line.netUnitCost }).where(eq(products.id, line.productId));
  }
  const costsAfter = new Map(lines.map((line) => [line.productId, line.netUnitCost]));
  const costChanges = [...costsAfter].filter(([id, cost]) => costsBefore.get(id) !== cost);
  return {
    invoice: invoice!,
    before: costChanges.length > 0 ? { costPrice: Object.fromEntries(costChanges.map(([id]) => [id, costsBefore.get(id)])) } : undefined,
    after: {
      number,
      supplierId: input.supplierId,
      supplierInvoiceNumber: input.supplierInvoiceNumber,
      date: input.date,
      total: totals.total,
      lines: lines.map(({ productId, qty, unitCost, discountAmount }) => ({ productId, qty, unitCost, discountAmount })),
      ...(costChanges.length > 0 && { costPrice: Object.fromEntries(costChanges) }),
    },
  };
}

/** Posts a supplier invoice and the optional "bayar sekarang" payment, in one transaction. */
export async function createPurchase(db: Db, input: PurchaseInput, actor: Actor) {
  const id = await db.transaction(async (tx) => {
    const written = await writePurchase(tx, input, actor.id, await allocateDocNumber(tx, "PO", input.date), null);
    await audit(tx, actor, {
      action: "purchase.invoice.create",
      entityId: written.invoice.id,
      summary: `Pembelian ${written.invoice.number} ${formatRupiah(written.invoice.total)}`,
      ...(written.before && { before: written.before }),
      after: written.after,
    });
    if (input.payment) await recordPayment(tx, written.invoice, input.payment, actor);
    return written.invoice.id;
  });
  return getPurchase(db, id);
}

export async function payPurchase(db: Db, id: string, input: PaymentInput, actor: Actor) {
  await db.transaction(async (tx) => recordPayment(tx, await lockInvoice(tx, id), input, actor));
  return getPurchase(db, id);
}

/** Marks the payment void and puts the money back with a reversal cash entry dated today. */
export async function voidPayment(db: Db, id: string, paymentId: string, reason: string, actor: Actor) {
  const userId = actor.id;
  await db.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, id);
    const [payment] = await tx
      .select({ accountId: payments.accountId, amount: payments.amount, voidedAt: payments.voidedAt })
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.purchaseInvoiceId, id)));
    if (!payment) throw new DomainError("not_found", "Pembayaran tidak ditemukan");
    if (payment.voidedAt) throw new DomainError("invalid", "Pembayaran ini sudah dibatalkan");

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
    await audit(tx, actor, {
      action: "purchase.payment.void",
      entityId: paymentId,
      summary: `Pembatalan pembayaran ${invoice.number} ${formatRupiah(payment.amount)}`,
      before: { voidedAt: null },
      after: { voidedAt: new Date().toISOString(), amount: payment.amount },
      reason,
    });
  });
  return getPurchase(db, id);
}

/** Refused while a non-voided payment exists; otherwise takes the goods back out of stock. */
export async function voidPurchase(db: Db, id: string, reason: string, actor: Actor) {
  await db.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, id);
    if (invoice.voidedAt) throw new DomainError("invalid", "Faktur ini sudah dibatalkan");
    if ((await paidSoFar(tx, id)) > 0) {
      throw new DomainError("invalid", "Faktur masih punya pembayaran. Batalkan pembayarannya dulu.");
    }
    const costs = await reversePurchase(tx, invoice, reason, actor.id);
    await audit(tx, actor, {
      action: "purchase.invoice.void",
      entityId: id,
      summary: `Pembatalan pembelian ${invoice.number} ${formatRupiah(invoice.total)}`,
      before: { voidedAt: null, ...(costs && { costPrice: costs.before }) },
      after: { voidedAt: new Date().toISOString(), ...(costs && { costPrice: costs.after }) },
      reason,
    });
  });
  return getPurchase(db, id);
}

/**
 * Marks the invoice void, takes its goods back out of stock dated today, and moves each
 * product's cost back. Logs nothing; returns the cost prices it changed, if any.
 */
async function reversePurchase(tx: Db, invoice: { id: string }, reason: string, userId: string) {
  const id = invoice.id;
  await tx
    .update(purchaseInvoices)
    .set({ voidedAt: new Date(), voidedBy: userId, voidReason: reason })
    .where(eq(purchaseInvoices.id, id));
  const posted = await tx
    .select({ productId: stockMovements.productId, qty: stockMovements.qty, unitCost: stockMovements.unitCost })
    .from(stockMovements)
    .where(and(eq(stockMovements.sourceType, "purchase_invoice"), eq(stockMovements.sourceId, id), eq(stockMovements.reason, "purchase")));
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
  // The voided lines no longer count: each product's cost_price goes back to the net cost of
  // its latest remaining non-voided purchase, or stays as is when none remains (rule 8).
  const productIds = [...new Set(posted.map((movement) => movement.productId))];
  const cost = () => tx.select({ id: products.id, costPrice: products.costPrice }).from(products).where(inArray(products.id, productIds));
  const costsBefore = new Map((await cost()).map((p) => [p.id, p.costPrice]));
  await tx.update(products).set({ costPrice: costAsOf(null) }).where(inArray(products.id, productIds));
  const costChanges = (await cost()).filter((p) => costsBefore.get(p.id) !== p.costPrice);
  if (costChanges.length === 0) return null;
  return {
    before: Object.fromEntries(costChanges.map((p) => [p.id, costsBefore.get(p.id)])),
    after: Object.fromEntries(costChanges.map((p) => [p.id, p.costPrice])),
  };
}

/**
 * Ubah: voids the supplier invoice ("Diubah: <reason>") and posts the corrected one as
 * `<number>/R<n>`, linked by `revision_of`, in one transaction with one audit event. Its live
 * payments move to the new invoice, so no money moves; refused when they exceed the new total.
 * The original is reversed first, so product costs end as if only the new invoice were posted.
 */
export async function editPurchase(db: Db, id: string, input: PurchaseEditInput, actor: Actor) {
  const newId = await db.transaction(async (tx) => {
    await lockInvoice(tx, id);
    const original = await getPurchase(tx, id);
    if (original.voidedAt) throw new DomainError("conflict", "Faktur ini sudah dibatalkan atau diubah");
    const { totals } = priceLines(input);
    if (original.paid > totals.total) {
      throw new DomainError(
        "invalid",
        `Faktur ini sudah dibayar ${formatRupiah(original.paid)}, lebih dari total baru ${formatRupiah(totals.total)}. Batalkan pembayaran yang berlebih dulu.`,
      );
    }
    const costs = await reversePurchase(tx, original, `Diubah: ${input.reason}`, actor.id);
    const written = await writePurchase(tx, input, actor.id, revisionNumber(original.number), original.id);
    const moved = await tx
      .update(payments)
      .set({ purchaseInvoiceId: written.invoice.id })
      .where(and(eq(payments.purchaseInvoiceId, id), isNull(payments.voidedAt)))
      .returning({ id: payments.id });
    await audit(tx, actor, {
      action: "purchase.invoice.edit",
      entityId: written.invoice.id,
      summary: `Ubah ${original.number} → ${written.invoice.number} · ${formatRupiah(original.total)} → ${formatRupiah(written.invoice.total)}`,
      before: {
        invoiceId: id,
        number: original.number,
        supplierId: original.supplierId,
        date: original.date,
        total: original.total,
        lines: original.lines.map(({ productId, qty, unitCost, discountAmount }) => ({ productId, qty, unitCost, discountAmount })),
        ...(costs && { costPrice: costs.before }),
      },
      after: { invoiceId: written.invoice.id, ...written.after, paymentIds: moved.map((p) => p.id) },
      reason: input.reason,
    });
    return written.invoice.id;
  });
  return getPurchase(db, newId);
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
