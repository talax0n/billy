import type { movementQuery, PaginationQuery } from "@billy/core";
import { type Db, posSales, products, purchaseInvoices, salesInvoices, stockMovements, users } from "@billy/db";
import { and, asc, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { z } from "zod";

type MovementQuery = z.output<typeof movementQuery>;

/**
 * The stock ledger, newest first. With a product selected, each row also carries the stock
 * right after it, summed over all of that product's movements so date and reason filters do
 * not change it.
 */
export async function listMovements(db: Db, query: MovementQuery) {
  const ledger = db
    .select({
      id: stockMovements.id,
      productId: stockMovements.productId,
      date: stockMovements.date,
      qty: stockMovements.qty,
      reason: stockMovements.reason,
      unitCost: stockMovements.unitCost,
      sourceType: stockMovements.sourceType,
      sourceId: stockMovements.sourceId,
      note: stockMovements.note,
      createdBy: stockMovements.createdBy,
      createdAt: stockMovements.createdAt,
      runningStock: (query.productId
        ? sql<number>`sum(${stockMovements.qty}) over (order by ${stockMovements.date}, ${stockMovements.createdAt}, ${stockMovements.id})::int`
        : sql<null>`null::int`
      ).as("running_stock"),
    })
    .from(stockMovements)
    .where(query.productId ? eq(stockMovements.productId, query.productId) : undefined)
    .as("ledger");

  const where = and(
    query.from ? gte(ledger.date, query.from) : undefined,
    query.to ? lte(ledger.date, query.to) : undefined,
    query.reason ? eq(ledger.reason, query.reason) : undefined,
  );
  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: ledger.id,
        date: ledger.date,
        productId: ledger.productId,
        productName: products.name,
        variant: products.variant,
        unit: products.unit,
        qty: ledger.qty,
        reason: ledger.reason,
        unitCost: ledger.unitCost,
        sourceType: ledger.sourceType,
        sourceId: ledger.sourceId,
        sourceNumber: sql<string | null>`coalesce(${purchaseInvoices.number}, ${salesInvoices.number}, ${posSales.number})`,
        note: ledger.note,
        createdByName: users.name,
        runningStock: ledger.runningStock,
      })
      .from(ledger)
      .innerJoin(products, eq(products.id, ledger.productId))
      .innerJoin(users, eq(users.id, ledger.createdBy))
      .leftJoin(purchaseInvoices, and(eq(ledger.sourceType, "purchase_invoice"), eq(purchaseInvoices.id, ledger.sourceId)))
      .leftJoin(salesInvoices, and(eq(ledger.sourceType, "sales_invoice"), eq(salesInvoices.id, ledger.sourceId)))
      .leftJoin(posSales, and(eq(ledger.sourceType, "pos_sale"), eq(posSales.id, ledger.sourceId)))
      .where(where)
      .orderBy(desc(ledger.date), desc(ledger.createdAt), desc(ledger.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(ledger).where(where),
  ]);
  return { rows, total: counted!.total };
}

/** Active products with negative stock, or at or under a minimum that is set. Largest shortfall first. */
export async function listStockAlerts(db: Db, { page, pageSize }: PaginationQuery) {
  const stockByProduct = db
    .select({ productId: stockMovements.productId, stock: sql<number>`sum(${stockMovements.qty})::int`.as("stock") })
    .from(stockMovements)
    .groupBy(stockMovements.productId)
    .as("stock_by_product");
  const stock = sql<number>`coalesce(${stockByProduct.stock}, 0)`;
  const where = and(
    eq(products.active, true),
    sql`(${stock} < 0 or (${products.minStock} > 0 and ${stock} <= ${products.minStock}))`,
  );
  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: products.id,
        code: products.code,
        name: products.name,
        variant: products.variant,
        unit: products.unit,
        minStock: products.minStock,
        stock,
      })
      .from(products)
      .leftJoin(stockByProduct, eq(stockByProduct.productId, products.id))
      .where(where)
      .orderBy(sql`${stock} - ${products.minStock}`, asc(products.name))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: count() })
      .from(products)
      .leftJoin(stockByProduct, eq(stockByProduct.productId, products.id))
      .where(where),
  ]);
  return { rows, total: counted!.total };
}
