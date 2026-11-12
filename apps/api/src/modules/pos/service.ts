import {
  businessDate,
  computeTotals,
  docPeriod,
  DomainError,
  formatRupiah,
  type PaginationQuery,
  type posSaleInput,
  rupiah,
} from "@billy/core";
import {
  accounts,
  cashEntries,
  categories,
  contacts,
  type Db,
  posLines,
  posSales,
  products,
  settings,
  stockMovements,
  users,
} from "@billy/db";
import { and, asc, count, desc, eq, getTableColumns, ilike, inArray, isNull, like, ne, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { SessionUser } from "../../env.ts";
import { likePattern } from "../../lib/search.ts";
import { stockByProduct } from "../products/service.ts";

type PosSale = z.output<typeof posSaleInput>;

/** A kasir only ever sees their own sales (data-model roles). */
const visibleTo = (user: SessionUser): SQL | undefined =>
  user.role === "kasir" ? eq(posSales.cashierId, user.id) : undefined;

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

  return { products: productRows, accounts: accountRows, customers: customerRows, shop, lastNumber: last?.number ?? null };
}

/**
 * Idempotent by the device-generated id: a replay returns the stored sale untouched
 * (`created: false`). The sale already happened and was paid, so each line keeps the price
 * actually charged, even when the catalog price changed while the device was offline. The
 * server still recomputes the totals from those lines and refuses a total that disagrees.
 */
export async function recordSale(db: Db, input: PosSale, user: SessionUser) {
  const cashierId = user.id;
  // A replay answers like GET: a kasir never sees another cashier's sale.
  const replay = (tx: Db) => getSale(tx, input.id, user).then((sale) => ({ created: false, sale }));
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: posSales.id }).from(posSales).where(eq(posSales.id, input.id));
    if (existing) return replay(tx);

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

    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const catalog = await tx
      .select({ id: products.id, active: products.active, costPrice: products.costPrice })
      .from(products)
      .where(inArray(products.id, productIds));
    const byId = new Map(catalog.map((p) => [p.id, p]));

    const lines = input.lines.map((line) => {
      const product = byId.get(line.productId);
      if (!product?.active) throw new DomainError("invalid", "Produk di struk tidak ditemukan atau nonaktif");
      return { ...line, unitCost: product.costPrice };
    });

    const totals = computeTotals(lines, input.discount);
    if (totals.total !== input.total) {
      throw new DomainError(
        "invalid",
        `Total struk ${formatRupiah(input.total)} tidak sama dengan hitungan server ${formatRupiah(totals.total)}`,
      );
    }
    if (input.tendered < totals.total) throw new DomainError("invalid", "Uang diterima kurang dari total");

    const soldAt = new Date(input.soldAt);
    const date = businessDate(soldAt);
    // Two uploads of the same new sale can both get here; the one that loses the insert
    // waits for the winner and answers as a replay.
    const [inserted] = await tx
      .insert(posSales)
      .values({
        id: input.id,
        number: input.number,
        deviceCode: input.number.split("-")[0]!,
        soldAt,
        date,
        cashierId,
        customerId: input.customerId,
        subtotal: totals.subtotal,
        discountKind: input.discount.kind,
        discountValue: input.discount.value,
        discountAmount: totals.discountAmount,
        total: totals.total,
        method: input.method,
        accountId: input.accountId,
        tendered: input.tendered,
        change: rupiah(input.tendered - totals.total),
      })
      .onConflictDoNothing({ target: posSales.id })
      .returning({ id: posSales.id });
    if (!inserted) return replay(tx);
    await tx.insert(posLines).values(
      lines.map((line, position) => ({
        saleId: input.id,
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
        date,
        qty: -line.qty,
        reason: "pos" as const,
        unitCost: line.unitCost,
        sourceType: "pos_sale" as const,
        sourceId: input.id,
        note: input.number,
        createdBy: cashierId,
      })),
    );
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
    return { created: true, sale: await getSale(tx, input.id) };
  });
}

const saleColumns = {
  ...getTableColumns(posSales),
  cashierName: users.name,
  accountName: accounts.name,
};

export async function listSales(db: Db, user: SessionUser, { q, page, pageSize }: PaginationQuery) {
  const where = and(visibleTo(user), q ? ilike(posSales.number, likePattern(q)) : undefined);
  const [rows, [counted]] = await Promise.all([
    db
      .select(saleColumns)
      .from(posSales)
      .innerJoin(users, eq(users.id, posSales.cashierId))
      .innerJoin(accounts, eq(accounts.id, posSales.accountId))
      .where(where)
      .orderBy(desc(posSales.soldAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(posSales).where(where),
  ]);
  return { rows, total: counted!.total };
}

/** The sale with its lines, for the detail sheet and reprints. Receipt-safe: no cost prices. */
export async function getSale(db: Db, id: string, user?: SessionUser) {
  const [sale] = await db
    .select(saleColumns)
    .from(posSales)
    .innerJoin(users, eq(users.id, posSales.cashierId))
    .innerJoin(accounts, eq(accounts.id, posSales.accountId))
    .where(and(eq(posSales.id, id), user && visibleTo(user)));
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

/**
 * Sets the void columns and writes reversal rows for the stock and the money. The conditional
 * update is the guard: of two concurrent voids only one updates the row and writes reversals.
 */
export async function voidSale(db: Db, id: string, reason: string, userId: string) {
  return db.transaction(async (tx) => {
    const [voided] = await tx
      .update(posSales)
      .set({ voidedAt: new Date(), voidedBy: userId, voidReason: reason })
      .where(and(eq(posSales.id, id), isNull(posSales.voidedAt)))
      .returning({ id: posSales.id });
    const sale = await getSale(tx, id);
    if (!voided) throw new DomainError("conflict", "Struk sudah di-void");
    const date = businessDate();
    const note = `Void ${sale.number}: ${reason}`;

    const lines = await tx
      .select({ productId: posLines.productId, qty: posLines.qty, unitCost: posLines.unitCost })
      .from(posLines)
      .where(eq(posLines.saleId, id));
    await tx.insert(stockMovements).values(
      lines.map((line) => ({
        productId: line.productId,
        date,
        qty: line.qty,
        reason: "reversal" as const,
        unitCost: line.unitCost,
        sourceType: "pos_sale" as const,
        sourceId: id,
        note,
        createdBy: userId,
      })),
    );
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
    return getSale(tx, id);
  });
}
