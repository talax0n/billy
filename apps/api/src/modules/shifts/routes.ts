import { shiftQuery } from "@billy/core";
import { Hono } from "hono";
import { adminOnly } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { listShifts } from "./service.ts";

/** The Shift report, admin only: the one place outside Log Aktivitas with the expected cash and the difference. */
export const shiftRoutes = new Hono<AppEnv>()
  .use(adminOnly())
  .get("/", validate("query", shiftQuery), async (c) => c.json(await listShifts(c.var.db, c.req.valid("query"))));
