import { idParam, paginationQuery, productInput, stockAdjustmentInput } from "@billy/core";
import { Hono } from "hono";
import { backOffice } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { adjustStock, createProduct, getProduct, listMovements, listProducts, updateProduct } from "./service.ts";

/**
 * Reference module: copy this layout for new modules. Routes validate and delegate;
 * services hold the queries and transactions and throw DomainError for rule failures.
 */
export const productRoutes = new Hono<AppEnv>()
  .use(backOffice())
  .get("/", validate("query", paginationQuery), async (c) => c.json(await listProducts(c.var.db, c.req.valid("query"))))
  .post("/", validate("json", productInput), async (c) => c.json(await createProduct(c.var.db, c.req.valid("json")), 201))
  .get("/:id", validate("param", idParam), async (c) => c.json(await getProduct(c.var.db, c.req.valid("param").id)))
  .put("/:id", validate("param", idParam), validate("json", productInput), async (c) =>
    c.json(await updateProduct(c.var.db, c.req.valid("param").id, c.req.valid("json"))),
  )
  .post("/:id/adjustments", validate("param", idParam), validate("json", stockAdjustmentInput), async (c) =>
    c.json(await adjustStock(c.var.db, c.req.valid("param").id, c.req.valid("json"), c.var.user.id), 201),
  )
  .get("/:id/movements", validate("param", idParam), validate("query", paginationQuery), async (c) =>
    c.json(await listMovements(c.var.db, c.req.valid("param").id, c.req.valid("query"))),
  );
