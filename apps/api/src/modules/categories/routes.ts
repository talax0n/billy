import { categoryInput, DomainError, idParam, paginationQuery } from "@billy/core";
import { categories, products } from "@billy/db";
import { asc, count, eq, ilike } from "drizzle-orm";
import { Hono } from "hono";
import { backOffice } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
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
    const [row] = await c.var.db.insert(categories).values(c.req.valid("json")).returning();
    return c.json(row!, 201);
  })
  .put("/:id", validate("param", idParam), validate("json", categoryInput), async (c) => {
    const [row] = await c.var.db
      .update(categories)
      .set(c.req.valid("json"))
      .where(eq(categories.id, c.req.valid("param").id))
      .returning();
    if (!row) throw new DomainError("not_found", "Kategori tidak ditemukan");
    return c.json(row);
  });
