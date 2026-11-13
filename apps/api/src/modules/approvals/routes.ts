import { approvalPinInput, approvalRequestInput, idParam } from "@billy/core";
import { Hono } from "hono";
import { adminOnly, anySignedIn } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { decide, getApproval, hasPin, listPending, requestApproval, setPin } from "./service.ts";

/**
 * Remote approvals: a kasir asks, admin approves or rejects from the bell, the kasir's action
 * then spends it. Also the admin's own approval PIN. A PIN hash never leaves the server.
 */
export const approvalRoutes = new Hono<AppEnv>()
  .use(anySignedIn())
  .post("/", validate("json", approvalRequestInput), async (c) =>
    c.json(await requestApproval(c.var.db, c.req.valid("json"), c.var.actor), 201),
  )
  .get("/pending", adminOnly(), async (c) => c.json(await listPending(c.var.db)))
  .get("/pin", adminOnly(), async (c) => c.json(await hasPin(c.var.db, c.var.user.id)))
  .put("/pin", adminOnly(), validate("json", approvalPinInput), async (c) =>
    c.json(await setPin(c.var.db, c.req.valid("json"), c.var.actor)),
  )
  .get("/:id", validate("param", idParam), async (c) => c.json(await getApproval(c.var.db, c.req.valid("param").id, c.var.user)))
  .post("/:id/approve", adminOnly(), validate("param", idParam), async (c) =>
    c.json(await decide(c.var.db, c.req.valid("param").id, "approve", c.var.actor)),
  )
  .post("/:id/reject", adminOnly(), validate("param", idParam), async (c) =>
    c.json(await decide(c.var.db, c.req.valid("param").id, "reject", c.var.actor)),
  );
