import { brandOf, categoryInput, changedFields, DomainError, idParam, paginationQuery } from "@billy/core";
import { categories, products } from "@billy/db";
import { asc, count, eq, ilike, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { backOffice } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { audit } from "../../lib/audit.ts";
import { likePattern } from "../../lib/search.ts";
import { validate } from "../../lib/validate.ts";

export const categoryRoutes = new Hono<AppEnv>()
  .use(backOffice())
  .get("/", validate("query", paginationQuery), async (c) => {
    const { q, page, pageSize } = c.req.valid("query");
    const where = q ? ilike(categories.name, likePattern(q)) : undefined;
    const [rows, [counted]] = await Promise.all([
      c.var.db
        .select({
          id: categories.id,
          name: categories.name,
          description: categories.description,
          productCount: count(products.id),
        })
        .from(categories)
        .leftJoin(products, eq(products.categoryId, categories.id))
        .where(where)
        .groupBy(categories.id)
        .orderBy(asc(categories.name))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      c.var.db.select({ total: count() }).from(categories).where(where),
    ]);
    return c.json({ rows, total: counted!.total });
  })
  .post("/", validate("json", categoryInput), async (c) => {
    const input = c.req.valid("json");
    const row = await c.var.db.transaction(async (tx) => {
      const [row] = await tx.insert(categories).values(input).returning();
      await audit(tx, c.var.actor, { action: "category.create", entityId: row!.id, summary: `Kategori ${row!.name}`, after: input });
      return row!;
    });
    return c.json(row, 201);
  })
  .put("/:id", validate("param", idParam), validate("json", categoryInput), async (c) => {
    const input = c.req.valid("json");
    const { id } = c.req.valid("param");
    const row = await c.var.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ name: categories.name, description: categories.description })
        .from(categories)
        .where(eq(categories.id, id))
        .for("update");
      if (!before) throw new DomainError("not_found", "Kategori tidak ditemukan");
      const [row] = await tx.update(categories).set(input).where(eq(categories.id, id)).returning();
      const diff = changedFields(before, input);
      if (diff) await audit(tx, c.var.actor, { action: "category.update", entityId: id, summary: `Kategori ${row!.name} diubah`, ...diff });
      return row!;
    });
    return c.json(row);
  })
  /** Gives each product without a category its brand, read from its name. Products that already have one stay. */
  .post("/auto-assign", async (c) => {
    const brands = await c.var.db.transaction(async (tx) => {
      const unassigned = await tx.select({ id: products.id, name: products.name }).from(products).where(isNull(products.categoryId)).for("update");
      const idsByBrand = new Map<string, string[]>();
      for (const p of unassigned) {
        const brand = brandOf(p.name);
        if (brand) idsByBrand.set(brand, [...(idsByBrand.get(brand) ?? []), p.id]);
      }
      if (idsByBrand.size === 0) return [];

      // Reuse a category the admin already made, whatever its capitalisation.
      const existing = new Map((await tx.select({ id: categories.id, name: categories.name }).from(categories)).map((r) => [r.name.toLowerCase(), r]));
      const missing = [...idsByBrand.keys()].filter((brand) => !existing.has(brand.toLowerCase()));
      if (missing.length > 0) {
        const created = await tx.insert(categories).values(missing.map((name) => ({ name }))).returning({ id: categories.id, name: categories.name });
        for (const r of created) existing.set(r.name.toLowerCase(), r);
      }

      const result: { id: string; name: string; count: number }[] = [];
      for (const [brand, ids] of idsByBrand) {
        const category = existing.get(brand.toLowerCase())!;
        await tx.update(products).set({ categoryId: category.id }).where(inArray(products.id, ids));
        await audit(tx, c.var.actor, {
          action: "category.auto_assign",
          entityId: category.id,
          summary: `Kategori ${category.name}: ${ids.length} produk diisi otomatis`,
          after: { productIds: ids },
        });
        result.push({ id: category.id, name: category.name, count: ids.length });
      }
      return result.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    });
    return c.json({ assigned: brands.reduce((sum, b) => sum + b.count, 0), brands });
  });
