import { DomainError } from "@billy/core";
import { categories, type Db, products, stockOpnameLines, stockOpnames } from "@billy/db";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import type { Actor } from "../../env.ts";
import { rankProducts } from "../../lib/product-match.ts";
import { createOpname, saveCounts } from "../opname/service.ts";

/** What the stock bot may touch: the brand categories, their products, and draft opname counts. Never stock itself. */

/** Categories that have active products; the bot calls them brands. */
export async function brandList(db: Db) {
  return db
    .selectDistinct({ id: categories.id, name: categories.name })
    .from(categories)
    .innerJoin(products, and(eq(products.categoryId, categories.id), eq(products.active, true)))
    .orderBy(asc(categories.name));
}

/** The brand's active products closest to the words a staff typed, best first. */
export async function findProducts(db: Db, categoryId: string, words: string, limit = 6) {
  const pool = await db
    .select({ id: products.id, name: products.name, variant: products.variant, unit: products.unit })
    .from(products)
    .where(and(eq(products.categoryId, categoryId), eq(products.active, true)));
  const named = pool.map((p) => ({ id: p.id, name: `${p.name} ${p.variant}`.trim(), unit: p.unit }));
  return rankProducts(words, named)
    .slice(0, limit)
    .map((r) => ({ ...r.product, score: Math.round(r.score * 100) / 100 }));
}

/** The brand's open draft opname, or a new one. Counts from every message of the day land in one draft. */
async function draftFor(db: Db, categoryId: string, actor: Actor) {
  const [open] = await db
    .select({ id: stockOpnames.id, number: stockOpnames.number })
    .from(stockOpnames)
    .where(and(eq(stockOpnames.categoryId, categoryId), eq(stockOpnames.status, "draft")))
    .orderBy(desc(stockOpnames.createdAt))
    .limit(1);
  return open ?? (await createOpname(db, { categoryId, note: "Dari laporan SPB lewat Telegram" }, actor));
}

async function namesOf(db: Db, ids: string[]) {
  const rows = await db.select({ id: products.id, name: products.name, variant: products.variant }).from(products).where(inArray(products.id, ids));
  return new Map(rows.map((r) => [r.id, `${r.name} ${r.variant}`.trim()]));
}

/** Writes counted quantities into the brand's draft opname, replacing earlier counts of the same products. */
export async function recordCounts(db: Db, actor: Actor, categoryId: string, lines: { productId: string; qty: number }[]) {
  if (lines.length === 0) throw new DomainError("invalid", "Tidak ada barang untuk dicatat");
  const opname = await draftFor(db, categoryId, actor);
  await saveCounts(db, opname.id, { lines: lines.map((l) => ({ productId: l.productId, countedQty: l.qty })) }, actor);
  const names = await namesOf(
    db,
    lines.map((l) => l.productId),
  );
  return { opname: opname.number, saved: lines.map((l) => ({ name: names.get(l.productId)!, qty: l.qty })) };
}

/** Removes counts from the brand's draft opname, for a count the staff says was wrong. */
export async function clearCounts(db: Db, actor: Actor, categoryId: string, productIds: string[]) {
  const opname = await draftFor(db, categoryId, actor);
  await saveCounts(db, opname.id, { lines: productIds.map((productId) => ({ productId, countedQty: null })) }, actor);
  const names = await namesOf(db, productIds);
  return { opname: opname.number, cleared: productIds.map((id) => names.get(id)!) };
}

/** Each brand draft with what is counted so far, as plain text for the agent's context. */
export async function draftsSummary(db: Db, maxLines = 60) {
  const drafts = await db
    .select({ id: stockOpnames.id, number: stockOpnames.number, brand: categories.name, counted: count(stockOpnameLines.productId) })
    .from(stockOpnames)
    .innerJoin(categories, eq(categories.id, stockOpnames.categoryId))
    .leftJoin(stockOpnameLines, eq(stockOpnameLines.opnameId, stockOpnames.id))
    .where(eq(stockOpnames.status, "draft"))
    .groupBy(stockOpnames.id, categories.name)
    .orderBy(asc(categories.name));
  const parts: string[] = [];
  for (const d of drafts) {
    const lines = await db
      .select({ id: products.id, name: products.name, variant: products.variant, qty: stockOpnameLines.countedQty })
      .from(stockOpnameLines)
      .innerJoin(products, eq(products.id, stockOpnameLines.productId))
      .where(eq(stockOpnameLines.opnameId, d.id))
      .orderBy(asc(products.name))
      .limit(maxLines);
    const more = d.counted > lines.length ? `\n  … dan ${d.counted - lines.length} barang lain` : "";
    parts.push(`${d.number} (${d.brand}), ${d.counted} barang dihitung:${lines.map((l) => `\n  - ${`${l.name} ${l.variant}`.trim()} [${l.id}] = ${l.qty}`).join("")}${more}`);
  }
  return parts.join("\n") || "Belum ada draf opname per brand.";
}
