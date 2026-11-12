import {
  businessDate,
  DomainError,
  type PaginationQuery,
  type productInput,
  type stockAdjustmentInput,
} from "@billy/core";
import { categories, type Db, products, stockMovements, users } from "@billy/db";
import { and, asc, count, desc, eq, ilike, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { likePattern } from "../../lib/search.ts";

/** Stock is derived: the sum of a product's movements (data-model ground rule 4). */
export const stockByProduct = (db: Db) =>
  db
    .select({ productId: stockMovements.productId, stock: sql<number>`sum(${stockMovements.qty})::int`.as("stock") })
    .from(stockMovements)
    .groupBy(stockMovements.productId)
    .as("stock_by_product");

/** Every whitespace-separated term must appear in the name, variant, code or barcode. */
function searchWhere(q: string): SQL | undefined {
  const haystack = sql`${products.name} || ' ' || ${products.variant} || ' ' || coalesce(${products.code}, '') || ' ' || coalesce(${products.barcode}, '')`;
  const terms = q.split(/\s+/).filter(Boolean);
  return terms.length ? and(...terms.map((term) => ilike(haystack, likePattern(term)))) : undefined;
}

function selectProducts(db: Db) {
  const stock = stockByProduct(db);
  return db
    .select({
      id: products.id,
      code: products.code,
      barcode: products.barcode,
      name: products.name,
      variant: products.variant,
      unit: products.unit,
      categoryId: products.categoryId,
      categoryName: categories.name,
      sellPrice: products.sellPrice,
      costPrice: products.costPrice,
      minStock: products.minStock,
      active: products.active,
      stock: sql<number>`coalesce(${stock.stock}, 0)`,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(stock, eq(stock.productId, products.id));
}

export async function listProducts(db: Db, { q, page, pageSize }: PaginationQuery) {
  const where = searchWhere(q);
  const [rows, [counted]] = await Promise.all([
    selectProducts(db)
      .where(where)
      .orderBy(desc(products.active), asc(products.name), asc(products.variant))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(products).where(where),
  ]);
  return { rows, total: counted!.total };
}

export async function getProduct(db: Db, id: string) {
  const [row] = await selectProducts(db).where(eq(products.id, id));
  if (!row) throw new DomainError("not_found", "Produk tidak ditemukan");
  return row;
}

export async function createProduct(db: Db, input: z.output<typeof productInput>) {
  const [row] = await db.insert(products).values(input).returning({ id: products.id });
  return getProduct(db, row!.id);
}

export async function updateProduct(db: Db, id: string, input: z.output<typeof productInput>) {
  const [row] = await db.update(products).set(input).where(eq(products.id, id)).returning({ id: products.id });
  if (!row) throw new DomainError("not_found", "Produk tidak ditemukan");
  return getProduct(db, id);
}

/** Writes one `adjustment` movement valued at the current cost price. */
export async function adjustStock(
  db: Db,
  productId: string,
  input: z.output<typeof stockAdjustmentInput>,
  userId: string,
) {
  return db.transaction(async (tx) => {
    const product = await getProduct(tx, productId);
    await tx.insert(stockMovements).values({
      productId,
      date: input.date ?? businessDate(),
      qty: input.qty,
      reason: "adjustment",
      unitCost: product.costPrice,
      note: input.note,
      createdBy: userId,
    });
    return getProduct(tx, productId);
  });
}

export async function listMovements(db: Db, productId: string, { page, pageSize }: PaginationQuery) {
  const where = eq(stockMovements.productId, productId);
  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: stockMovements.id,
        date: stockMovements.date,
        qty: stockMovements.qty,
        reason: stockMovements.reason,
        unitCost: stockMovements.unitCost,
        sourceType: stockMovements.sourceType,
        sourceId: stockMovements.sourceId,
        note: stockMovements.note,
        createdByName: users.name,
        createdAt: stockMovements.createdAt,
      })
      .from(stockMovements)
      .innerJoin(users, eq(users.id, stockMovements.createdBy))
      .where(where)
      .orderBy(desc(stockMovements.date), desc(stockMovements.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(stockMovements).where(where),
  ]);
  return { rows, total: counted!.total };
}
