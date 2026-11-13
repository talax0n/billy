import { idParam, paginationQuery, posSaleInput, posVoidInput } from "@billy/core";
import { Hono } from "hono";
import { requireRole } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { getCatalog, getSale, listSales, recordSale, voidSale } from "./service.ts";

/**
 * The cashier. Every role sells and voids, but a non-admin's void and any sale over a limit
 * need an admin's approval. A kasir sees and voids only their own sales.
 */
export const posRoutes = new Hono<AppEnv>()
  .use(requireRole("admin", "staff", "kasir"))
  .use(async (c, next) => {
    c.set("actor", { ...c.var.actor, source: "kasir" });
    await next();
  })
  .get("/catalog", async (c) => c.json(await getCatalog(c.var.db)))
  .get("/sales", validate("query", paginationQuery), async (c) =>
    c.json(await listSales(c.var.db, c.var.user, c.req.valid("query"))),
  )
  .post("/sales", validate("json", posSaleInput), async (c) => {
    const { created, sale } = await recordSale(c.var.db, c.req.valid("json"), c.var.actor);
    return c.json(sale, created ? 201 : 200);
  })
  .get("/sales/:id", validate("param", idParam), async (c) =>
    c.json(await getSale(c.var.db, c.req.valid("param").id, c.var.user)),
  )
  .post("/sales/:id/void", validate("param", idParam), validate("json", posVoidInput), async (c) =>
    c.json(await voidSale(c.var.db, c.req.valid("param").id, c.req.valid("json"), c.var.actor)),
  );
