import { idParam, salesInvoiceEditInput, salesInvoiceInput, salesListQuery, salesPaymentInput, voidInput } from "@billy/core";
import { Hono } from "hono";
import { z } from "zod";
import { backOffice } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { exportFileName, xlsxResponse } from "../../lib/xlsx.ts";
import {
  createInvoice,
  editInvoice,
  exportInvoices,
  getInvoice,
  listInvoices,
  listReceivables,
  overdueSummary,
  recordPayment,
  voidInvoice,
  voidPayment,
} from "./service.ts";

const paymentParam = z.object({ id: z.uuid(), paymentId: z.uuid() });

export const salesRoutes = new Hono<AppEnv>()
  .use(backOffice())
  .get("/receivables", async (c) => c.json(await listReceivables(c.var.db)))
  .get("/overdue-summary", async (c) => c.json(await overdueSummary(c.var.db)))
  .get("/", validate("query", salesListQuery), async (c) => c.json(await listInvoices(c.var.db, c.req.valid("query"))))
  .get("/export.xlsx", validate("query", salesListQuery), async (c) => {
    const query = c.req.valid("query");
    return xlsxResponse(await exportInvoices(c.var.db, query), exportFileName("penjualan", query));
  })
  .post("/", validate("json", salesInvoiceInput), async (c) =>
    c.json(await createInvoice(c.var.db, c.req.valid("json"), c.var.actor), 201),
  )
  .get("/:id", validate("param", idParam), async (c) => c.json(await getInvoice(c.var.db, c.req.valid("param").id)))
  .post("/:id/payments", validate("param", idParam), validate("json", salesPaymentInput), async (c) =>
    c.json(await recordPayment(c.var.db, c.req.valid("param").id, c.req.valid("json"), c.var.actor), 201),
  )
  .post("/:id/payments/:paymentId/void", validate("param", paymentParam), validate("json", voidInput), async (c) => {
    const { id, paymentId } = c.req.valid("param");
    return c.json(await voidPayment(c.var.db, id, paymentId, c.req.valid("json"), c.var.actor));
  })
  .post("/:id/void", validate("param", idParam), validate("json", voidInput), async (c) =>
    c.json(await voidInvoice(c.var.db, c.req.valid("param").id, c.req.valid("json"), c.var.actor)),
  )
  .post("/:id/edit", validate("param", idParam), validate("json", salesInvoiceEditInput), async (c) =>
    c.json(await editInvoice(c.var.db, c.req.valid("param").id, c.req.valid("json"), c.var.actor), 201),
  );
