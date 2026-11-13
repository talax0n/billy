import {
  currentShiftQuery,
  idParam,
  paginationQuery,
  posDraftCancelInput,
  posDraftInput,
  posRevisionInput,
  posSaleInput,
  posVoidInput,
  shiftCloseInput,
  shiftOpenInput,
} from "@billy/core";
import { Hono } from "hono";
import { requireRole } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { closeShift, currentShift, openShift } from "../shifts/service.ts";
import { cancelDraft, createDraft, getDraft, listOpenDrafts, printDraft, updateDraft } from "./drafts.ts";
import { getCatalog, getSale, listSales, printSale, recordSale, reviseSale, voidSale } from "./service.ts";

/**
 * The cashier. Every role sells and voids, but a non-admin's void and any sale over a limit
 * need an admin's approval. A kasir sees and voids only their own sales. Selling needs an open
 * shift; closing one answers without the expected cash (the admin reads it in /api/shifts).
 * Nota sementara (drafts) and revisi are online only, so they are never queued on the device.
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
  .get("/shifts/current", validate("query", currentShiftQuery), async (c) =>
    c.json(await currentShift(c.var.db, c.var.user, c.req.valid("query"))),
  )
  .post("/shifts", validate("json", shiftOpenInput), async (c) => {
    const { created, shift } = await openShift(c.var.db, c.req.valid("json"), c.var.actor);
    return c.json(shift, created ? 201 : 200);
  })
  .post("/shifts/:id/close", validate("param", idParam), validate("json", shiftCloseInput), async (c) =>
    c.json(await closeShift(c.var.db, c.req.valid("param").id, c.req.valid("json"), c.var.actor)),
  )
  .post("/sales/:id/void", validate("param", idParam), validate("json", posVoidInput), async (c) =>
    c.json(await voidSale(c.var.db, c.req.valid("param").id, c.req.valid("json"), c.var.actor)),
  )
  .post("/sales/:id/revise", validate("param", idParam), validate("json", posRevisionInput), async (c) =>
    c.json(await reviseSale(c.var.db, c.req.valid("param").id, c.req.valid("json"), c.var.actor), 201),
  )
  .post("/sales/:id/print", validate("param", idParam), async (c) => c.json(await printSale(c.var.db, c.req.valid("param").id, c.var.actor)))
  .get("/drafts", async (c) => c.json(await listOpenDrafts(c.var.db)))
  .post("/drafts", validate("json", posDraftInput), async (c) => c.json(await createDraft(c.var.db, c.req.valid("json"), c.var.actor), 201))
  .get("/drafts/:id", validate("param", idParam), async (c) => c.json(await getDraft(c.var.db, c.req.valid("param").id)))
  .put("/drafts/:id", validate("param", idParam), validate("json", posDraftInput), async (c) =>
    c.json(await updateDraft(c.var.db, c.req.valid("param").id, c.req.valid("json"), c.var.actor)),
  )
  .post("/drafts/:id/print", validate("param", idParam), async (c) => c.json(await printDraft(c.var.db, c.req.valid("param").id, c.var.actor)))
  .post("/drafts/:id/cancel", validate("param", idParam), validate("json", posDraftCancelInput), async (c) =>
    c.json(await cancelDraft(c.var.db, c.req.valid("param").id, c.req.valid("json"), c.var.actor)),
  )
  .post("/drafts/:id/pay", validate("param", idParam), validate("json", posSaleInput), async (c) => {
    const { created, sale } = await recordSale(c.var.db, c.req.valid("json"), c.var.actor, c.req.valid("param").id);
    return c.json(sale, created ? 201 : 200);
  });
