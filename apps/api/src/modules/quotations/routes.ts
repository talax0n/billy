import { idParam, quotationConvertInput, quotationInput, quotationListQuery, quotationStatusInput } from "@billy/core";
import { Hono } from "hono";
import { backOffice } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { convertQuotation, createQuotation, getQuotation, listQuotations, setQuotationStatus } from "./service.ts";

/** Penawaran harga, back office only. Converting to a faktur may need an admin's approval. */
export const quotationRoutes = new Hono<AppEnv>()
  .use(backOffice())
  .get("/", validate("query", quotationListQuery), async (c) => c.json(await listQuotations(c.var.db, c.req.valid("query"))))
  .post("/", validate("json", quotationInput), async (c) => c.json(await createQuotation(c.var.db, c.req.valid("json"), c.var.actor), 201))
  .get("/:id", validate("param", idParam), async (c) => c.json(await getQuotation(c.var.db, c.req.valid("param").id)))
  .post("/:id/status", validate("param", idParam), validate("json", quotationStatusInput), async (c) =>
    c.json(await setQuotationStatus(c.var.db, c.req.valid("param").id, c.req.valid("json"), c.var.actor)),
  )
  .post("/:id/convert", validate("param", idParam), validate("json", quotationConvertInput), async (c) =>
    c.json(await convertQuotation(c.var.db, c.req.valid("param").id, c.req.valid("json"), c.var.actor), 201),
  );
