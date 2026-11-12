import { idParam, invoiceBundleInput, paginationQuery } from "@billy/core";
import { Hono } from "hono";
import { backOffice } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { createBundle, getBundle, listBundles, voidBundle } from "./service.ts";

/** Tukar faktur: a customer's open invoices handed over together for collection. */
export const invoiceBundleRoutes = new Hono<AppEnv>()
  .use(backOffice())
  .get("/", validate("query", paginationQuery), async (c) => c.json(await listBundles(c.var.db, c.req.valid("query"))))
  .post("/", validate("json", invoiceBundleInput), async (c) =>
    c.json(await createBundle(c.var.db, c.req.valid("json"), c.var.user.id), 201),
  )
  .get("/:id", validate("param", idParam), async (c) => c.json(await getBundle(c.var.db, c.req.valid("param").id)))
  .post("/:id/void", validate("param", idParam), async (c) => c.json(await voidBundle(c.var.db, c.req.valid("param").id)));
