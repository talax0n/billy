import { categoryInput, changedFields, DomainError, idParam, paginationQuery } from "@billy/core";
import { categories, products } from "@billy/db";
import { asc, count, eq, ilike } from "drizzle-orm";
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
  });
