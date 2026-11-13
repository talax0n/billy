import { idParam, opnameCountInput, opnameCreateInput, opnameLinesQuery, paginationQuery } from "@billy/core";
import { Hono } from "hono";
import { adminOnly, backOffice } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { createOpname, getOpname, listOpnameLines, listOpnames, postOpname, saveCounts } from "./service.ts";

/** Stok opname: admin and staff count, only admin posts. */
export const opnameRoutes = new Hono<AppEnv>()
  .use(backOffice())
  .get("/", validate("query", paginationQuery), async (c) => c.json(await listOpnames(c.var.db, c.req.valid("query"))))
  .post("/", validate("json", opnameCreateInput), async (c) => c.json(await createOpname(c.var.db, c.req.valid("json"), c.var.actor), 201))
  .get("/:id", validate("param", idParam), async (c) => c.json(await getOpname(c.var.db, c.req.valid("param").id)))
  .get("/:id/lines", validate("param", idParam), validate("query", opnameLinesQuery), async (c) =>
    c.json(await listOpnameLines(c.var.db, c.req.valid("param").id, c.req.valid("query"))),
  )
  .put("/:id/lines", validate("param", idParam), validate("json", opnameCountInput), async (c) =>
    c.json(await saveCounts(c.var.db, c.req.valid("param").id, c.req.valid("json"), c.var.actor)),
  )
  .post("/:id/post", adminOnly(), validate("param", idParam), async (c) => c.json(await postOpname(c.var.db, c.req.valid("param").id, c.var.actor)));
