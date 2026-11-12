import { idParam, movementQuery, paginationQuery, purchaseInput, purchaseListQuery, purchasePaymentInput, voidPurchaseInput } from "@billy/core";
import { Hono } from "hono";
import { z } from "zod";
import { backOffice } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { accountLookup, createPurchase, getPurchase, listPurchases, listStockMovements, lowStock, payables, payPurchase, suppliers, voidPayment, voidPurchase } from "./service.ts";

export const purchaseRoutes = new Hono<AppEnv>()
  .use(backOffice())
  .get("/suppliers", validate("query", paginationQuery), async (c) => c.json(await suppliers(c.var.db, c.req.valid("query").q)))
  .get("/accounts", async (c) => c.json(await accountLookup(c.var.db)))
  .get("/payables", async (c) => c.json(await payables(c.var.db)))
  .get("/movements", validate("query", movementQuery), async (c) => c.json(await listStockMovements(c.var.db, c.req.valid("query"))))
  .get("/low-stock", async (c) => c.json(await lowStock(c.var.db)))
  .get("/", validate("query", purchaseListQuery), async (c) => c.json(await listPurchases(c.var.db, c.req.valid("query"))))
  .post("/", validate("json", purchaseInput), async (c) => c.json(await createPurchase(c.var.db, c.req.valid("json"), c.var.user.id), 201))
  .get("/:id", validate("param", idParam), async (c) => c.json(await getPurchase(c.var.db, c.req.valid("param").id)))
  .post("/:id/payments", validate("param", idParam), validate("json", purchasePaymentInput), async (c) => c.json(await payPurchase(c.var.db, c.req.valid("param").id, c.req.valid("json"), c.var.user.id), 201))
  .post("/:id/payments/:paymentId/void", validate("param", z.object({ id: z.uuid(), paymentId: z.uuid() })), validate("json", voidPurchaseInput), async (c) => c.json(await voidPayment(c.var.db, c.req.valid("param").id, c.req.valid("param").paymentId, c.req.valid("json").reason, c.var.user.id)))
  .post("/:id/void", validate("param", idParam), validate("json", voidPurchaseInput), async (c) => c.json(await voidPurchase(c.var.db, c.req.valid("param").id, c.req.valid("json").reason, c.var.user.id)));
