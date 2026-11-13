import {
  businessDate,
  DomainError,
  formatRupiah,
  type opnameCountInput,
  type opnameCreateInput,
  type opnameLinesQuery,
  type PaginationQuery,
  type Rupiah,
  rupiah,
} from "@billy/core";
import { categories, type Db, products, stockMovements, stockOpnameLines, stockOpnames, users } from "@billy/db";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type { Actor } from "../../env.ts";
import { audit } from "../../lib/audit.ts";
import { allocateDocNumber } from "../../lib/doc-number.ts";
import { likePattern } from "../../lib/search.ts";
import { productSearchWhere, stockByProduct } from "../products/service.ts";

type Opname = typeof stockOpnames.$inferSelect;

const signed = (value: Rupiah) => `${value > 0 ? "+" : ""}${formatRupiah(value)}`;

/** "Opname OP-261113-0001 · 12 barang selisih · −Rp 340.000", in Log Aktivitas and the watchdog. */
export const opnameSummary = (number: string, changed: number, net: Rupiah) => `Opname ${number} · ${changed} barang selisih · ${signed(net)}`;

const creator = alias(users, "creator");
const poster = alias(users, "poster");

async function lockDraft(tx: Db, id: string): Promise<Opname> {
  const [opname] = await tx.select().from(stockOpnames).where(eq(stockOpnames.id, id)).for("update");
  if (!opname) throw new DomainError("not_found", "Stok opname tidak ditemukan");
  if (opname.status === "posted") throw new DomainError("conflict", `Opname ${opname.number} sudah diposting dan tidak bisa diubah`);
  return opname;
}

/** A draft covers the active products of its scope plus any line already entered; a posted one only its lines. */
const inScope = (opname: Pick<Opname, "status" | "categoryId">) =>
  opname.status === "posted"
    ? isNotNull(stockOpnameLines.productId)
    : or(and(eq(products.active, true), opname.categoryId ? eq(products.categoryId, opname.categoryId) : undefined), isNotNull(stockOpnameLines.productId));

/**
 * Each product of the opname with its system stock (live on a draft, frozen at posting on a
 * posted one), the counted quantity (null when not counted), and the difference valued at cost.
 */
function opnameLines(db: Db, opname: Opname, search?: SQL) {
  const stock = stockByProduct(db);
  const posted = opname.status === "posted";
  const systemQty = posted ? sql<number>`${stockOpnameLines.systemQty}` : sql<number>`coalesce(${stock.stock}, 0)::int`;
  const unitCost = posted ? sql<number>`${stockOpnameLines.unitCost}` : sql<number>`${products.costPrice}`;
  const difference = sql<number | null>`(${stockOpnameLines.countedQty} - ${systemQty})::int`;
  return db
    .select({
      id: products.id,
      code: products.code,
      name: products.name,
      variant: products.variant,
      unit: products.unit,
      systemQty: systemQty.as("system_qty"),
      unitCost: unitCost.as("unit_cost"),
      countedQty: stockOpnameLines.countedQty,
      difference: difference.as("difference"),
      value: sql<number | null>`(${difference} * ${unitCost})::bigint`.as("value"),
    })
    .from(products)
    .leftJoin(stockOpnameLines, and(eq(stockOpnameLines.productId, products.id), eq(stockOpnameLines.opnameId, opname.id)))
    .leftJoin(stock, eq(stock.productId, products.id))
    .where(and(inScope(opname), search))
    .as("lines");
}

async function findOpname(db: Db, id: string): Promise<Opname> {
  const [opname] = await db.select().from(stockOpnames).where(eq(stockOpnames.id, id));
  if (!opname) throw new DomainError("not_found", "Stok opname tidak ditemukan");
  return opname;
}

export async function listOpnames(db: Db, { q, page, pageSize }: PaginationQuery) {
  const where = q ? ilike(stockOpnames.number, likePattern(q)) : undefined;
  const lines = db
    .select({ opnameId: stockOpnameLines.opnameId, n: sql<number>`count(*)::int`.as("n") })
    .from(stockOpnameLines)
    .groupBy(stockOpnameLines.opnameId)
    .as("lines");
  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: stockOpnames.id,
        number: stockOpnames.number,
        date: stockOpnames.date,
        categoryName: categories.name,
        status: stockOpnames.status,
        createdByName: creator.name,
        postedAt: stockOpnames.postedAt,
        lineCount: sql<number>`coalesce(${lines.n}, 0)`,
      })
      .from(stockOpnames)
      .innerJoin(creator, eq(creator.id, stockOpnames.createdBy))
      .leftJoin(categories, eq(categories.id, stockOpnames.categoryId))
      .leftJoin(lines, eq(lines.opnameId, stockOpnames.id))
      .where(where)
      .orderBy(desc(stockOpnames.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(stockOpnames).where(where),
  ]);
  return { rows, total: counted!.total };
}

/** The header with the totals so far: products in scope, lines counted, lines that differ, their value. */
export async function getOpname(db: Db, id: string) {
  const opname = await findOpname(db, id);
  const lines = opnameLines(db, opname);
  const [[totals], [header]] = await Promise.all([
    db
      .select({
        scope: count(),
        counted: count(lines.countedQty),
        changed: sql<number>`count(*) filter (where ${lines.difference} <> 0)`.mapWith(Number),
        net: sql`coalesce(sum(${lines.value}), 0)`.mapWith((v) => rupiah(Number(v))),
      })
      .from(lines),
    db
      .select({ categoryName: categories.name, createdByName: creator.name, postedByName: poster.name })
      .from(stockOpnames)
      .innerJoin(creator, eq(creator.id, stockOpnames.createdBy))
      .leftJoin(poster, eq(poster.id, stockOpnames.postedBy))
      .leftJoin(categories, eq(categories.id, stockOpnames.categoryId))
      .where(eq(stockOpnames.id, id)),
  ]);
  return { ...opname, ...header!, ...totals! };
}

export async function listOpnameLines(db: Db, id: string, { q, page, pageSize, filter }: z.output<typeof opnameLinesQuery>) {
  const opname = await findOpname(db, id);
  const lines = opnameLines(db, opname, q ? productSearchWhere(q) : undefined);
  const where = {
    all: undefined,
    counted: isNotNull(lines.countedQty),
    uncounted: isNull(lines.countedQty),
    difference: ne(lines.difference, 0),
  }[filter];
  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: lines.id,
        code: lines.code,
        name: lines.name,
        variant: lines.variant,
        unit: lines.unit,
        systemQty: lines.systemQty,
        unitCost: sql<number>`${lines.unitCost}`.mapWith(Number),
        countedQty: lines.countedQty,
        difference: lines.difference,
        value: sql<number | null>`${lines.value}`.mapWith(Number),
      })
      .from(lines)
      .where(where)
      .orderBy(asc(lines.name), asc(lines.variant))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(lines).where(where),
  ]);
  return { rows, total: counted!.total };
}

export async function createOpname(db: Db, input: z.output<typeof opnameCreateInput>, actor: Actor) {
  const id = await db.transaction(async (tx) => {
    let categoryName = "semua barang";
    if (input.categoryId) {
      const [category] = await tx.select({ name: categories.name }).from(categories).where(eq(categories.id, input.categoryId));
      if (!category) throw new DomainError("invalid", "Kategori tidak ditemukan");
      categoryName = category.name;
    }
    const date = businessDate();
    const number = await allocateDocNumber(tx, "OP", date);
    const [row] = await tx
      .insert(stockOpnames)
      .values({ number, date, categoryId: input.categoryId, note: input.note, createdBy: actor.id })
      .returning({ id: stockOpnames.id });
    await audit(tx, actor, {
      action: "stock.opname.create",
      entityId: row!.id,
      summary: `Mulai opname ${number} · ${categoryName}`,
      after: { number, date, categoryId: input.categoryId, note: input.note },
    });
    return row!.id;
  });
  return getOpname(db, id);
}

/** Saves counted quantities on a draft; a null clears the line. Only products in the opname's scope. */
export async function saveCounts(db: Db, id: string, input: z.output<typeof opnameCountInput>, actor: Actor) {
  await db.transaction(async (tx) => {
    const opname = await lockDraft(tx, id);
    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const known = await tx
      .select({ id: products.id, countedQty: stockOpnameLines.countedQty })
      .from(products)
      .leftJoin(stockOpnameLines, and(eq(stockOpnameLines.productId, products.id), eq(stockOpnameLines.opnameId, id)))
      .where(and(inArray(products.id, productIds), inScope(opname)));
    if (known.length !== productIds.length) throw new DomainError("invalid", "Ada barang di luar cakupan opname ini");
    const before = new Map(known.map((p) => [p.id, p.countedQty]));

    const entered = input.lines.filter((l) => l.countedQty !== null);
    const cleared = input.lines.filter((l) => l.countedQty === null).map((l) => l.productId);
    if (entered.length) {
      await tx
        .insert(stockOpnameLines)
        .values(entered.map((l) => ({ opnameId: id, productId: l.productId, countedQty: l.countedQty! })))
        .onConflictDoUpdate({
          target: [stockOpnameLines.opnameId, stockOpnameLines.productId],
          set: { countedQty: sql`excluded.counted_qty` },
        });
    }
    if (cleared.length) {
      await tx.delete(stockOpnameLines).where(and(eq(stockOpnameLines.opnameId, id), inArray(stockOpnameLines.productId, cleared)));
    }
    await audit(tx, actor, {
      action: "stock.opname.count",
      entityId: id,
      summary: `Hitungan opname ${opname.number} disimpan · ${input.lines.length} barang`,
      before: { lines: input.lines.map((l) => ({ productId: l.productId, countedQty: before.get(l.productId) ?? null })) },
      after: { lines: input.lines },
    });
  });
  return getOpname(db, id);
}

/**
 * Admin only. Takes each counted product's stock now, not at the start: sales during the count
 * move it. Writes one `adjustment` movement per difference at the current cost price, freezes
 * the lines with that stock and cost, and logs the summary, all in one transaction.
 */
export async function postOpname(db: Db, id: string, actor: Actor) {
  await db.transaction(async (tx) => {
    const opname = await lockDraft(tx, id);
    const stock = stockByProduct(tx);
    const lines = await tx
      .select({
        productId: stockOpnameLines.productId,
        countedQty: stockOpnameLines.countedQty,
        systemQty: sql<number>`coalesce(${stock.stock}, 0)::int`,
        unitCost: products.costPrice,
      })
      .from(stockOpnameLines)
      .innerJoin(products, eq(products.id, stockOpnameLines.productId))
      .leftJoin(stock, eq(stock.productId, stockOpnameLines.productId))
      .where(eq(stockOpnameLines.opnameId, id));
    if (lines.length === 0) throw new DomainError("invalid", "Belum ada barang yang dihitung");

    const date = businessDate();
    const changed = lines.filter((l) => l.countedQty !== l.systemQty);
    if (changed.length) {
      await tx.insert(stockMovements).values(
        changed.map((l) => ({
          productId: l.productId,
          date,
          qty: l.countedQty - l.systemQty,
          reason: "adjustment" as const,
          unitCost: l.unitCost,
          sourceType: "stock_opname" as const,
          sourceId: id,
          note: `Opname ${opname.number}`,
          createdBy: actor.id,
        })),
      );
    }
    for (const l of lines) {
      await tx
        .update(stockOpnameLines)
        .set({ systemQty: l.systemQty, unitCost: l.unitCost })
        .where(and(eq(stockOpnameLines.opnameId, id), eq(stockOpnameLines.productId, l.productId)));
    }
    await tx.update(stockOpnames).set({ status: "posted", postedBy: actor.id, postedAt: new Date() }).where(eq(stockOpnames.id, id));
    const net = rupiah(changed.reduce((sum, l) => sum + (l.countedQty - l.systemQty) * l.unitCost, 0));
    await audit(tx, actor, {
      action: "stock.opname.post",
      entityId: id,
      summary: opnameSummary(opname.number, changed.length, net),
      before: { status: "draft" },
      after: {
        status: "posted",
        date,
        counted: lines.length,
        changed: changed.length,
        net,
        lines: changed.map((l) => ({ productId: l.productId, systemQty: l.systemQty, countedQty: l.countedQty, unitCost: l.unitCost })),
      },
    });
  });
  return getOpname(db, id);
}
