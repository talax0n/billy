import {
  businessDate,
  changedFields,
  DomainError,
  type PaginationQuery,
  rankProducts,
  type productInput,
  type stockAdjustmentInput,
} from "@billy/core";
import { categories, type Db, products, stockMovements, users } from "@billy/db";
import { asc, count, desc, eq, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../env.ts";
import { audit } from "../../lib/audit.ts";
import { matchAllTerms } from "../../lib/search.ts";

/** Stock is derived: the sum of a product's movements (data-model ground rule 4). */
export const stockByProduct = (db: Db) =>
  db
    .select({ productId: stockMovements.productId, stock: sql<number>`sum(${stockMovements.qty})::int`.as("stock") })
    .from(stockMovements)
    .groupBy(stockMovements.productId)
    .as("stock_by_product");

/** Every whitespace-separated term must appear in the name, variant, code or barcode. */
export function productSearchWhere(q: string): SQL | undefined {
  const haystack = sql`${products.name} || ' ' || ${products.variant} || ' ' || coalesce(${products.code}, '') || ' ' || coalesce(${products.barcode}, '')`;
  return matchAllTerms(haystack, q);
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

/**
 * One page of products. A search is ranked with `rankProducts` (exact code first, then whole
 * words…), so its matches are ranked and paged here rather than in SQL.
 */
export async function listProducts(db: Db, { q, page, pageSize }: PaginationQuery) {
  const offset = (page - 1) * pageSize;
  const order = [desc(products.active), asc(products.name), asc(products.variant)];
  if (q) {
    // ponytail: every match is loaded to rank it; fine while a search matches a few hundred products.
    const matches = rankProducts(await selectProducts(db).where(productSearchWhere(q)).orderBy(...order), q);
    return { rows: matches.slice(offset, offset + pageSize), total: matches.length };
  }
  const [rows, [counted]] = await Promise.all([
    selectProducts(db)
      .orderBy(...order)
      .limit(pageSize)
      .offset(offset),
    db.select({ total: count() }).from(products),
  ]);
  return { rows, total: counted!.total };
}

export async function getProduct(db: Db, id: string) {
  const [row] = await selectProducts(db).where(eq(products.id, id));
  if (!row) throw new DomainError("not_found", "Produk tidak ditemukan");
  return row;
}

const productLabel = (p: { name: string; variant: string }) => `${p.name} ${p.variant}`.trim();

export async function createProduct(db: Db, input: z.output<typeof productInput>, actor: Actor) {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(products).values(input).returning({ id: products.id });
    await audit(tx, actor, { action: "product.create", entityId: row!.id, summary: `Produk ${productLabel(input)}`, after: input });
    return getProduct(tx, row!.id);
  });
}

/** Logs only the changed fields, so a price or cost change shows its old and new value. */
export async function updateProduct(db: Db, id: string, input: z.output<typeof productInput>, actor: Actor) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(products).where(eq(products.id, id)).for("update");
    if (!before) throw new DomainError("not_found", "Produk tidak ditemukan");
    await tx.update(products).set(input).where(eq(products.id, id));
    const { createdAt: _c, updatedAt: _u, id: _id, ...fields } = before;
    const diff = changedFields(fields, { ...fields, ...input });
    if (diff) {
      const price = "sellPrice" in diff.after || "costPrice" in diff.after;
      await audit(tx, actor, {
        action: "product.update",
        entityId: id,
        summary: `${price ? "Harga" : "Data"} ${productLabel(input)} diubah`,
        ...diff,
      });
    }
    return getProduct(tx, id);
  });
}

/** Writes one `adjustment` movement valued at the current cost price. */
export async function adjustStock(
  db: Db,
  productId: string,
  input: z.output<typeof stockAdjustmentInput>,
  actor: Actor,
) {
  return db.transaction(async (tx) => {
    const product = await getProduct(tx, productId);
    const date = input.date ?? businessDate();
    const [movement] = await tx
      .insert(stockMovements)
      .values({
        productId,
        date,
        qty: input.qty,
        reason: "adjustment",
        unitCost: product.costPrice,
        note: input.note,
        createdBy: actor.id,
      })
      .returning({ id: stockMovements.id });
    await audit(tx, actor, {
      action: "stock.adjust",
      entityId: productId,
      summary: `Stok ${productLabel(product)} ${input.qty > 0 ? "+" : ""}${input.qty}`,
      before: { stock: product.stock },
      after: { stock: product.stock + input.qty, qty: input.qty, date, movementId: movement!.id },
      reason: input.note,
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
