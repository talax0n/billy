import { auditQuery } from "@billy/core";
import { Hono } from "hono";
import { adminOnly } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { listAuditEvents } from "./service.ts";

/** Log Aktivitas, read-only and admin-only. Nothing in the API updates or deletes an audit event. */
export const auditRoutes = new Hono<AppEnv>()
  .use(adminOnly())
  .get("/", validate("query", auditQuery), async (c) => c.json(await listAuditEvents(c.var.db, c.req.valid("query"))));
