import { dailySummaryQuery, watchdogQuery } from "@billy/core";
import { Hono } from "hono";
import { adminOnly } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { dailySummary, watchdogFlags } from "./service.ts";

/** Red flags for the owner, computed on read: there is no background job on the serverless deploy. */
export const watchdogRoutes = new Hono<AppEnv>()
  .use(adminOnly())
  .get("/", validate("query", watchdogQuery), async (c) => c.json({ rows: await watchdogFlags(c.var.db, c.req.valid("query")) }))
  .get("/daily", validate("query", dailySummaryQuery), async (c) => c.json(await dailySummary(c.var.db, c.req.valid("query").date)));
