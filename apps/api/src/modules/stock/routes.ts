import { movementQuery, paginationQuery } from "@billy/core";
import { Hono } from "hono";
import { backOffice } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { listMovements, listStockAlerts } from "./service.ts";

/** Mutasi Stok: the movement ledger and stock alerts. Adjustments live in the products module. */
export const stockRoutes = new Hono<AppEnv>()
  .use(backOffice())
  .get("/movements", validate("query", movementQuery), async (c) => c.json(await listMovements(c.var.db, c.req.valid("query"))))
  .get("/alerts", validate("query", paginationQuery), async (c) => c.json(await listStockAlerts(c.var.db, c.req.valid("query"))));
