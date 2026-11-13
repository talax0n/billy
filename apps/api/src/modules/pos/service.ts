import {
  approvalKindLabels,
  breachMessage,
  businessDate,
  combinedDiscountBp,
  computeTotals,
  docPeriod,
  DomainError,
  formatBp,
  formatRupiah,
  type LimitBreach,
  type Limits,
  type PaginationQuery,
  type posRevisionInput,
  type posSaleInput,
  type posVoidInput,
  rupiah,
  saleLimitBreaches,
} from "@billy/core";
import {
  accounts,
  cashEntries,
  cashShifts,
  categories,
  contacts,
  type Db,
  posDrafts,
  posLines,
  posSales,
  products,
  settings,
  stockMovements,
  users,
} from "@billy/db";
import { and, asc, count, desc, eq, getTableColumns, ilike, inArray, isNull, like, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type { Actor } from "../../env.ts";
import { authorize, pinApprover, type Requirement } from "../../lib/approval.ts";
import { audit } from "../../lib/audit.ts";
import { costAsOf } from "../../lib/cost-as-of.ts";
import { likePattern } from "../../lib/search.ts";
import { stockByProduct } from "../products/service.ts";
import { settleDraft } from "./drafts.ts";

type PosSale = z.output<typeof posSaleInput>;
type PosRevision = z.output<typeof posRevisionInput>;
type Viewer = Pick<Actor, "id" | "role">;

/** A kasir only ever sees their own sales (data-model roles). */
const visibleTo = (user: Viewer): SQL | undefined =>
  user.role === "kasir" ? eq(posSales.cashierId, user.id) : undefined;

/** A sale uploaded this long after it was made was made offline. */
export const OFFLINE_AFTER_MS = 2 * 60_000;

export async function getLimits(db: Db): Promise<Limits> {
  const [row] = await db
    .select({ kasirMaxDiscountBp: settings.kasirMaxDiscountBp, allowBelowCost: settings.allowBelowCost })
    .from(settings);
  return row ?? { kasirMaxDiscountBp: 500, allowBelowCost: false };
}

/**
 * Everything the cashier device caches to keep selling offline: products, accounts and the
 * active customers for the F3 picker. Cost prices stay on the server.
 * `lastNumber` is the device's highest receipt number today, so a device whose local counter
 * was wiped continues after it instead of colliding.
 */
export async function getCatalog(db: Db) {
  const stock = stockByProduct(db);
  const [shop] = await db
    .select({
      shopName: settings.shopName,
      address: settings.address,
      phone: settings.phone,
      receiptFooter: settings.receiptFooter,
      deviceCode: settings.posDeviceCode,
    })
    .from(settings);
  if (!shop) throw new DomainError("not_found", "Pengaturan toko belum dibuat");

  const [productRows, accountRows, customerRows, [last]] = await Promise.all([
    db
      .select({
        id: products.id,
        code: products.code,
        barcode: products.barcode,
        name: products.name,
        variant: products.variant,
        unit: products.unit,
        categoryName: categories.name,
        sellPrice: products.sellPrice,
        minStock: products.minStock,
        stock: sql<number>`coalesce(${stock.stock}, 0)`,
      })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(stock, eq(stock.productId, products.id))
      .where(eq(products.active, true))
      .orderBy(asc(products.name), asc(products.variant)),
    db
      .select({ id: accounts.id, name: accounts.name, kind: accounts.kind })
      .from(accounts)
      .where(eq(accounts.active, true))
      .orderBy(asc(accounts.code)),
    db
      .select({ id: contacts.id, code: contacts.code, name: contacts.name })
      .from(contacts)
      .where(and(eq(contacts.kind, "customer"), eq(contacts.active, true)))
      .orderBy(asc(contacts.name)),
    db
      .select({ number: posSales.number })
      .from(posSales)
      .where(like(posSales.number, `${shop.deviceCode}-${docPeriod(businessDate())}-%`))
      .orderBy(desc(posSales.number))
      .limit(1),
  ]);

  return {
    products: productRows,
    accounts: accountRows,
    customers: customerRows,
    shop,
    lastNumber: last?.number ?? null,
    limits: await getLimits(db),
  };
}

/** The sale's lines with each product's cost as of the sale date. Refuses an unknown or inactive product. */
async function priceLines(tx: Db, input: Pick<PosSale, "soldAt" | "lines">) {
  const date = businessDate(new Date(input.soldAt));
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const catalog = await tx
    .select({ id: products.id, active: products.active, costPrice: costAsOf(date) })
    .from(products)
    .where(inArray(products.id, productIds));
  const byId = new Map(catalog.map((p) => [p.id, p]));
  return input.lines.map((line) => {
    const product = byId.get(line.productId);
    if (!product?.active) throw new DomainError("invalid", "Produk di struk tidak ditemukan atau nonaktif");
    return { ...line, unitCost: product.costPrice };
  });
}

const breachLabels = (breaches: readonly LimitBreach[]) =>
  breaches.map((b) => (b.kind === "discount" ? `Diskon ${formatBp(b.bp)}` : approvalKindLabels.below_cost)).join(" + ");

/** The exact sale an approval is for: an approval for one discount cannot be spent on a bigger one. */
const saleSubject = (input: Pick<PosSale, "id" | "number" | "total" | "discount" | "lines">) => ({
  saleId: input.id,
  number: input.number,
  total: input.total,
  discount: { kind: input.discount.kind, value: input.discount.value },
  lines: input.lines.map(({ productId, qty, unitPrice, discountAmount }) => ({ productId, qty, unitPrice, discountAmount })),
});

/**
 * What a non-admin's sale needs approved: a combined discount over the cap, or a line below
 * cost. Admin is never limited. The subject pins the exact sale, so an approval for one
 * discount cannot be spent on a bigger one.
 */
async function saleRequirement(tx: Db, input: PosSale, lines: Awaited<ReturnType<typeof priceLines>>, actor: Viewer): Promise<Requirement | null> {
  if (actor.role === "admin") return null;
  const breaches = saleLimitBreaches(lines, input.discount, await getLimits(tx));
  if (breaches.length === 0) return null;
  return {
    kind: breaches[0]!.kind,
    subject: saleSubject(input),
    summary: `${breachLabels(breaches)} · ${input.number} · ${formatRupiah(input.total)}`,
    message: breachMessage(breaches),
    deviceCode: input.number.split("-")[0]!,
  };
}

/** For a remote approval request: what this sale would need approved, computed as `recordSale` does. */
export async function posSaleApproval(db: Db, input: PosSale, actor: Viewer) {
  return saleRequirement(db, input, await priceLines(db, input), actor);
}

/**
 * Idempotent by the device-generated id: a replay returns the stored sale untouched
 * (`created: false`). The sale already happened and was paid, so each line keeps the price
 * actually charged, even when the catalog price changed while the device was offline. The
 * server still recomputes the totals from those lines and refuses a total that disagrees.
 * A non-admin's sale over a limit needs `input.approval`.
 */
export async function recordSale(db: Db, input: PosSale, actor: Actor, draftId?: string) {
  // A replay answers like GET: a kasir never sees another cashier's sale.
  const replay = (tx: Db) => getSale(tx, input.id, actor).then((sale) => ({ created: false, sale }));
  const [known] = await db.select({ id: posSales.id }).from(posSales).where(eq(posSales.id, input.id));
  const pinAdmin = known ? null : await pinApprover(db, actor, input.approval);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: posSales.id }).from(posSales).where(eq(posSales.id, input.id));
    if (existing) return replay(tx);

    const cashierId = await cashierOf(tx, input.cashierId, actor);
    await assertSellable(tx, input, cashierId);

    // Cost as of the day the sale happened, so an offline sale synced after a newer purchase
    // keeps the cost that applied when it was sold.
    const soldAt = new Date(input.soldAt);
    const date = businessDate(soldAt);
    const lines = await priceLines(tx, input);
    const totals = checkedTotals(lines, input);
    if (input.tendered < totals.total) throw new DomainError("invalid", "Uang diterima kurang dari total");
    const approvalId = await authorize(tx, actor, await saleRequirement(tx, input, lines, actor), input.approval, pinAdmin);

    // Two uploads of the same new sale can both get here; the one that loses the insert
    // waits for the winner and answers as a replay.
    const deviceCode = input.number.split("-")[0]!;
    const inserted = await insertSale(tx, lines, totals, {
      id: input.id,
      number: input.number,
      deviceCode,
      soldAt,
      date,
      cashierId,
      customerId: input.customerId,
      discountKind: input.discount.kind,
      discountValue: input.discount.value,
      method: input.method,
      accountId: input.accountId,
      tendered: input.tendered,
      change: rupiah(input.tendered - totals.total),
      shiftId: input.shiftId,
    });
    if (!inserted) return replay(tx);
    // A fully discounted sale moves no money; cash entry amounts must be positive.
    if (totals.total > 0) {
      await tx.insert(cashEntries).values({
        accountId: input.accountId,
        date,
        direction: "in",
        amount: totals.total,
        category: "sale",
        sourceType: "pos_sale",
        sourceId: input.id,
        note: input.number,
        createdBy: cashierId,
      });
    }
    const offline = actor.source === "kasir" && Date.now() - soldAt.getTime() > OFFLINE_AFTER_MS;
    await audit(tx, actor, {
      action: "pos.sale.create",
      entityId: input.id,
      summary: `Penjualan ${input.number} ${formatRupiah(totals.total)}`,
      after: {
        number: input.number,
        soldAt: input.soldAt,
        cashierId,
        method: input.method,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        discountBp: combinedDiscountBp(lines, input.discount),
        total: totals.total,
        lines: lines.length,
      },
      approvalId,
      deviceCode,
      ...(offline && { source: "kasir_offline" as const }),
    });
    if (draftId) await settleDraft(tx, draftId, input, actor);
    return { created: true, sale: await getSale(tx, input.id) };
  });
}

/** The cashier's open shift, a receipt number no other sale holds, an active account and a real customer. */
async function assertSellable(tx: Db, input: Pick<PosSale, "id" | "number" | "shiftId" | "accountId" | "customerId">, cashierId: string) {
  const [shift] = await tx
    .select({ cashierId: cashShifts.cashierId, closedAt: cashShifts.closedAt, accountId: cashShifts.accountId })
    .from(cashShifts)
    .where(eq(cashShifts.id, input.shiftId));
  if (shift?.cashierId !== cashierId) throw new DomainError("invalid", "Shift kasir tidak ditemukan. Buka shift dulu sebelum berjualan.");
  if (shift.closedAt) throw new DomainError("conflict", "Shift untuk transaksi ini sudah ditutup");
  const [taken] = await tx
    .select({ id: posSales.id })
    .from(posSales)
    .where(and(eq(posSales.number, input.number), ne(posSales.id, input.id)));
  if (taken) throw new DomainError("conflict", `Nomor struk ${input.number} sudah dipakai transaksi lain`);

  const [account] = await tx.select({ active: accounts.active }).from(accounts).where(eq(accounts.id, input.accountId));
  if (!account?.active) throw new DomainError("invalid", "Akun pembayaran tidak ditemukan atau nonaktif");

  if (input.customerId) {
    // A customer deactivated after the device cached it still counts: the sale already happened.
    const [customer] = await tx.select({ kind: contacts.kind }).from(contacts).where(eq(contacts.id, input.customerId));
    if (customer?.kind !== "customer") throw new DomainError("invalid", "Pelanggan tidak ditemukan");
  }
  return shift;
}

type PricedLines = Awaited<ReturnType<typeof priceLines>>;

/** The server's own totals; a device total that disagrees is refused. */
function checkedTotals(lines: PricedLines, input: Pick<PosSale, "discount" | "total">) {
  const totals = computeTotals(lines, input.discount);
  if (totals.total !== input.total) {
    throw new DomainError(
      "invalid",
      `Total struk ${formatRupiah(input.total)} tidak sama dengan hitungan server ${formatRupiah(totals.total)}`,
    );
  }
  return totals;
}

/** The sale row, its lines and its stock movements. False when a concurrent upload inserted the same id first. */
async function insertSale(
  tx: Db,
  lines: PricedLines,
  totals: ReturnType<typeof computeTotals>,
  sale: Omit<typeof posSales.$inferInsert, "subtotal" | "discountAmount" | "total">,
) {
  const [inserted] = await tx
    .insert(posSales)
    .values({ ...sale, subtotal: totals.subtotal, discountAmount: totals.discountAmount, total: totals.total })
    .onConflictDoNothing({ target: posSales.id })
    .returning({ id: posSales.id });
  if (!inserted) return false;
  await tx.insert(posLines).values(
    lines.map((line, position) => ({
      saleId: sale.id,
      position,
      productId: line.productId,
      note: line.note,
      qty: line.qty,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount,
      lineTotal: totals.lineTotals[position]!,
      unitCost: line.unitCost,
    })),
  );
  await tx.insert(stockMovements).values(
    lines.map((line) => ({
      productId: line.productId,
      date: sale.date,
      qty: -line.qty,
      reason: "pos" as const,
      unitCost: line.unitCost,
      sourceType: "pos_sale" as const,
      sourceId: sale.id,
      note: sale.number,
      createdBy: sale.cashierId,
    })),
  );
  return true;
}

/**
 * Puts a sale's goods back in stock, dated `date` (the void or revisi day). Reverses the sale's
 * own stock movements, not its lines: a line that moved no stock (an imported "Selisih impor")
 * moves none now either.
 */
async function reverseStock(tx: Db, saleId: string, date: string, note: string, userId: string) {
  const moved = await tx
    .select({ productId: stockMovements.productId, qty: stockMovements.qty, unitCost: stockMovements.unitCost })
    .from(stockMovements)
    .where(and(eq(stockMovements.sourceType, "pos_sale"), eq(stockMovements.sourceId, saleId), eq(stockMovements.reason, "pos")));
  if (moved.length === 0) return;
  await tx.insert(stockMovements).values(
    moved.map((line) => ({
      productId: line.productId,
      date,
      qty: -line.qty,
      reason: "reversal" as const,
      unitCost: line.unitCost,
      sourceType: "pos_sale" as const,
      sourceId: saleId,
      note,
      createdBy: userId,
    })),
  );
}

/**
 * Who the sale is recorded under. A kasir uploads only their own sales; admin or staff signed in
 * on the POS may upload sales another cashier queued offline, under that cashier's id.
 */
export async function cashierOf(tx: Db, cashierId: string | undefined, user: Viewer) {
  if (!cashierId || cashierId === user.id) return user.id;
  if (user.role === "kasir") {
    throw new DomainError("invalid", "Transaksi ini milik kasir lain. Kirim dari akun kasir itu atau akun admin.");
  }
  const [cashier] = await tx.select({ id: users.id }).from(users).where(eq(users.id, cashierId));
  if (!cashier) throw new DomainError("invalid", "Kasir tidak ditemukan");
  return cashier.id;
}

const original = alias(posSales, "original");
const revision = alias(posSales, "revision");

/** Sales with the cashier, the account, and both ends of a revisi and a nota sementara. */
const selectSales = (db: Db) =>
  db
    .select({
      ...getTableColumns(posSales),
      cashierName: users.name,
      accountName: accounts.name,
      revisionOfNumber: original.number,
      revisionOfTotal: original.total,
      revisedById: revision.id,
      revisedByNumber: revision.number,
      draftNumber: posDrafts.number,
    })
    .from(posSales)
    .innerJoin(users, eq(users.id, posSales.cashierId))
    .innerJoin(accounts, eq(accounts.id, posSales.accountId))
    .leftJoin(original, eq(original.id, posSales.revisionOf))
    .leftJoin(revision, eq(revision.revisionOf, posSales.id))
    .leftJoin(posDrafts, eq(posDrafts.saleId, posSales.id));

export async function listSales(db: Db, user: Viewer, { q, page, pageSize }: PaginationQuery) {
  const where = and(visibleTo(user), q ? ilike(posSales.number, likePattern(q)) : undefined);
  const [rows, [counted]] = await Promise.all([
    selectSales(db)
      .where(where)
      .orderBy(desc(posSales.soldAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(posSales).where(where),
  ]);
  return { rows, total: counted!.total };
}

/** The sale with its lines, for the detail sheet and reprints. Receipt-safe: no cost prices. */
export async function getSale(db: Db, id: string, user?: Viewer) {
  const [sale] = await selectSales(db).where(and(eq(posSales.id, id), user && visibleTo(user)));
  if (!sale) throw new DomainError("not_found", "Struk tidak ditemukan");
  const lines = await db
    .select({
      id: posLines.id,
      position: posLines.position,
      productId: posLines.productId,
      note: posLines.note,
      qty: posLines.qty,
      unitPrice: posLines.unitPrice,
      discountAmount: posLines.discountAmount,
      lineTotal: posLines.lineTotal,
      productName: products.name,
      variant: products.variant,
      unit: products.unit,
    })
    .from(posLines)
    .innerJoin(products, eq(products.id, posLines.productId))
    .where(eq(posLines.saleId, id))
    .orderBy(asc(posLines.position));
  return { ...sale, lines };
}

/** Every void by a non-admin needs approval (a kasir voids only their own sales). */
async function voidRequirement(tx: Db, id: string, actor: Viewer): Promise<Requirement | null> {
  const sale = await getSale(tx, id, actor);
  if (actor.role === "admin") return null;
  return {
    kind: "void",
    subject: { saleId: sale.id, number: sale.number, total: sale.total },
    summary: `Void ${sale.number} · ${formatRupiah(sale.total)}`,
    message: "Void struk kasir butuh persetujuan admin.",
    deviceCode: sale.deviceCode,
  };
}

export const posVoidApproval = (db: Db, id: string, actor: Viewer) => voidRequirement(db, id, actor);

/**
 * Sets the void columns and writes reversal rows for the stock and the money. The conditional
 * update is the guard: of two concurrent voids only one updates the row and writes reversals.
 */
export async function voidSale(db: Db, id: string, { reason, approval }: z.output<typeof posVoidInput>, actor: Actor) {
  const pinAdmin = await pinApprover(db, actor, approval);
  return db.transaction(async (tx) => {
    const requirement = await voidRequirement(tx, id, actor);
    const [voided] = await tx
      .update(posSales)
      .set({ voidedAt: new Date(), voidedBy: actor.id, voidReason: reason })
      .where(and(eq(posSales.id, id), isNull(posSales.voidedAt)))
      .returning({ id: posSales.id });
    const sale = await getSale(tx, id);
    if (!voided) throw new DomainError("conflict", "Struk sudah di-void");
    const approvalId = await authorize(tx, actor, requirement, approval, pinAdmin);
    const date = businessDate();
    const note = `Void ${sale.number}: ${reason}`;
    const userId = actor.id;

    await reverseStock(tx, id, date, note, userId);
    if (sale.total > 0) {
      await tx.insert(cashEntries).values({
        accountId: sale.accountId,
        date,
        direction: "out",
        amount: sale.total,
        category: "reversal",
        sourceType: "pos_sale",
        sourceId: id,
        note,
        createdBy: userId,
      });
    }
    await audit(tx, actor, {
      action: "pos.sale.void",
      entityId: id,
      summary: `Void ${sale.number} ${formatRupiah(sale.total)}`,
      before: { voidedAt: null },
      after: { voidedAt: new Date().toISOString(), total: sale.total },
      reason,
      approvalId,
      deviceCode: sale.deviceCode,
    });
    return getSale(tx, id);
  });
}

type OriginalSale = typeof posSales.$inferSelect;

/**
 * What a non-admin's revisi needs approved, in one approval: another cashier's or a past day's
 * nota, a lower total (money goes back out of the drawer), and the new nota's own limits. The
 * subject binds the original and the exact new nota, so the approval fits this revisi only.
 */
async function revisionRequirement(tx: Db, sale: OriginalSale, input: PosRevision, lines: PricedLines, actor: Viewer): Promise<Requirement | null> {
  if (actor.role === "admin") return null;
  const needs: { kind: Requirement["kind"]; label: string; message: string }[] = [];
  if (sale.cashierId !== actor.id || sale.date < businessDate()) {
    needs.push({
      kind: "foreign_or_past_revisi",
      label: approvalKindLabels.foreign_or_past_revisi,
      message: "Revisi nota kasir lain atau nota hari sebelumnya butuh persetujuan admin.",
    });
  }
  if (input.total < sale.total) {
    needs.push({ kind: "revisi_lower", label: approvalKindLabels.revisi_lower, message: "Revisi yang menurunkan total butuh persetujuan admin." });
  }
  const breaches = saleLimitBreaches(lines, input.discount, await getLimits(tx));
  if (breaches.length) needs.push({ kind: breaches[0]!.kind, label: breachLabels(breaches), message: breachMessage(breaches) });
  if (needs.length === 0) return null;
  return {
    kind: needs[0]!.kind,
    subject: { originalId: sale.id, ...saleSubject(input) },
    summary: `Revisi ${sale.number} → ${input.number} · ${formatRupiah(sale.total)} → ${formatRupiah(input.total)} · ${needs.map((n) => n.label).join(" + ")}`,
    message: needs.map((n) => n.message).join(" "),
    deviceCode: input.number.split("-")[0]!,
  };
}

async function findOriginal(tx: Db, id: string, lock: boolean) {
  const query = tx.select().from(posSales).where(eq(posSales.id, id));
  const [sale] = await (lock ? query.for("update") : query);
  if (!sale) throw new DomainError("not_found", "Struk tidak ditemukan");
  if (sale.voidedAt) throw new DomainError("conflict", "Struk ini sudah di-void atau direvisi");
  return sale;
}

/** For a remote approval request: what this revisi would need approved, computed as `reviseSale` does. */
export async function posRevisionApproval(db: Db, originalId: string, input: PosRevision, actor: Viewer) {
  const lines = await priceLines(db, { soldAt: new Date().toISOString(), lines: input.lines });
  return revisionRequirement(db, await findOriginal(db, originalId, false), input, lines, actor);
}

/**
 * Revisi after payment, online only: voids the original and records the new nota linked to it
 * (`revision_of`) under the reviser's open shift, in one transaction. Only the difference changes
 * hands, so only the difference is a cash entry: collected on the chosen account when the total
 * goes up, refunded in cash from the reviser's drawer when it goes down. The original keeps its
 * money where it was paid. Stock is put back for the original lines and taken for the new ones.
 * Idempotent by the new nota's id.
 */
export async function reviseSale(db: Db, originalId: string, input: PosRevision, actor: Actor) {
  const pinAdmin = await pinApprover(db, actor, input.approval);
  return db.transaction(async (tx) => {
    const [known] = await tx.select({ revisionOf: posSales.revisionOf }).from(posSales).where(eq(posSales.id, input.id));
    if (known) {
      if (known.revisionOf !== originalId) throw new DomainError("conflict", "Nota baru ini sudah tercatat untuk transaksi lain");
      return getSale(tx, input.id);
    }
    const sale = await findOriginal(tx, originalId, true);
    const shift = await assertSellable(tx, input, actor.id);
    const soldAt = new Date();
    const date = businessDate(soldAt);
    const lines = await priceLines(tx, { soldAt: soldAt.toISOString(), lines: input.lines });
    const totals = checkedTotals(lines, input);
    const difference = rupiah(totals.total - sale.total);
    if (input.tendered < difference) throw new DomainError("invalid", "Uang diterima kurang dari selisih revisi");
    const refund = difference < 0;
    const method = refund ? "cash" : input.method;
    const accountId = refund ? shift.accountId : input.accountId;
    const approvalId = await authorize(tx, actor, await revisionRequirement(tx, sale, input, lines, actor), input.approval, pinAdmin);

    await tx
      .update(posSales)
      .set({ voidedAt: soldAt, voidedBy: actor.id, voidReason: `Revisi ${input.number}: ${input.reason}` })
      .where(eq(posSales.id, sale.id));
    await reverseStock(tx, sale.id, date, `Revisi ${sale.number} → ${input.number}`, actor.id);
    const deviceCode = input.number.split("-")[0]!;
    await insertSale(tx, lines, totals, {
      id: input.id,
      number: input.number,
      deviceCode,
      soldAt,
      date,
      cashierId: actor.id,
      customerId: input.customerId,
      discountKind: input.discount.kind,
      discountValue: input.discount.value,
      method,
      accountId,
      tendered: input.tendered,
      change: rupiah(input.tendered - difference),
      shiftId: input.shiftId,
      revisionOf: sale.id,
    });
    if (difference !== 0) {
      await tx.insert(cashEntries).values({
        accountId,
        date,
        direction: refund ? "out" : "in",
        amount: rupiah(Math.abs(difference)),
        category: refund ? "reversal" : "sale",
        sourceType: "pos_sale",
        sourceId: input.id,
        note: `Revisi ${sale.number} → ${input.number}`,
        createdBy: actor.id,
      });
    }
    await audit(tx, actor, {
      action: "pos.sale.revise",
      entityId: input.id,
      summary: `Revisi ${sale.number} → ${input.number} · ${formatRupiah(sale.total)} → ${formatRupiah(totals.total)}`,
      before: { saleId: sale.id, number: sale.number, total: sale.total, method: sale.method, cashierId: sale.cashierId, date: sale.date },
      after: { saleId: input.id, number: input.number, total: totals.total, difference, method, accountId, lines: lines.length },
      reason: input.reason,
      approvalId,
      deviceCode,
    });
    return getSale(tx, input.id);
  });
}

/** A reprint: counts it and logs it. The receipt it prints says SALINAN. */
export async function printSale(db: Db, id: string, actor: Actor) {
  return db.transaction(async (tx) => {
    const sale = await getSale(tx, id, actor);
    const [row] = await tx
      .update(posSales)
      .set({ printCount: sql`${posSales.printCount} + 1` })
      .where(eq(posSales.id, id))
      .returning({ printCount: posSales.printCount });
    await audit(tx, actor, {
      action: "pos.sale.print",
      entityId: id,
      summary: `Cetak ulang ${sale.number} (cetakan ke-${row!.printCount})`,
      after: { printCount: row!.printCount },
      deviceCode: sale.deviceCode,
    });
    return { ...sale, printCount: row!.printCount };
  });
}
