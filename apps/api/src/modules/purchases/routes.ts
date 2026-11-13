import {
  idParam,
  paginationQuery,
  purchaseEditInput,
  purchaseInput,
  purchaseListQuery,
  purchasePaymentInput,
  voidInput,
} from "@billy/core";
import { Hono } from "hono";
import { z } from "zod";
import { backOffice } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { exportFileName, xlsxResponse } from "../../lib/xlsx.ts";
import {
  createPurchase,
  editPurchase,
  exportPurchases,
  getPurchase,
  listPayables,
  listPurchases,
  listSupplierPayables,
  payPurchase,
  voidPayment,
  voidPurchase,
} from "./service.ts";

/** Supplier invoices (Pembelian), their payments, and open payables (Hutang). */
export const purchaseRoutes = new Hono<AppEnv>()
  .use(backOffice())
  .get("/payables", validate("query", paginationQuery), async (c) => c.json(await listPayables(c.var.db, c.req.valid("query"))))
  .get("/payables/:supplierId", validate("param", z.object({ supplierId: z.uuid() })), async (c) =>
    c.json(await listSupplierPayables(c.var.db, c.req.valid("param").supplierId)),
  )
  .get("/", validate("query", purchaseListQuery), async (c) => c.json(await listPurchases(c.var.db, c.req.valid("query"))))
  .get("/export.xlsx", validate("query", purchaseListQuery), async (c) => {
    const query = c.req.valid("query");
    return xlsxResponse(await exportPurchases(c.var.db, query), exportFileName("pembelian", query));
  })
  .post("/", validate("json", purchaseInput), async (c) =>
    c.json(await createPurchase(c.var.db, c.req.valid("json"), c.var.actor), 201),
  )
  .get("/:id", validate("param", idParam), async (c) => c.json(await getPurchase(c.var.db, c.req.valid("param").id)))
  .post("/:id/void", validate("param", idParam), validate("json", voidInput), async (c) =>
    c.json(await voidPurchase(c.var.db, c.req.valid("param").id, c.req.valid("json").reason, c.var.actor)),
  )
  .post("/:id/edit", validate("param", idParam), validate("json", purchaseEditInput), async (c) =>
    c.json(await editPurchase(c.var.db, c.req.valid("param").id, c.req.valid("json"), c.var.actor), 201),
  )
  .post("/:id/payments", validate("param", idParam), validate("json", purchasePaymentInput), async (c) =>
    c.json(await payPurchase(c.var.db, c.req.valid("param").id, c.req.valid("json"), c.var.actor), 201),
  )
  .post(
    "/:id/payments/:paymentId/void",
    validate("param", idParam.extend({ paymentId: z.uuid() })),
    validate("json", voidInput),
    async (c) => {
      const { id, paymentId } = c.req.valid("param");
      return c.json(await voidPayment(c.var.db, id, paymentId, c.req.valid("json").reason, c.var.actor));
    },
  );
