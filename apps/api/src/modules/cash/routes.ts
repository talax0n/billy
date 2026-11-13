import { accountInput, cashBookQuery, cashEntryInput, idParam, paginationQuery, transferInput, voidInput } from "@billy/core";
import { Hono } from "hono";
import { anySignedIn, backOffice } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import {
  cashBook,
  createAccount,
  createCashEntry,
  createTransfer,
  getAccount,
  listAccounts,
  lookupAccounts,
  updateAccount,
  voidTransfer,
} from "./service.ts";

export const accountRoutes = new Hono<AppEnv>()
  // The POS maps payment methods to accounts, so every role may read the lookup.
  .get("/lookup", anySignedIn(), async (c) => c.json(await lookupAccounts(c.var.db)))
  .use(backOffice())
  .get("/", validate("query", paginationQuery), async (c) => c.json(await listAccounts(c.var.db, c.req.valid("query"))))
  .post("/", validate("json", accountInput), async (c) => c.json(await createAccount(c.var.db, c.req.valid("json"), c.var.actor), 201))
  .get("/:id", validate("param", idParam), async (c) => c.json(await getAccount(c.var.db, c.req.valid("param").id)))
  .put("/:id", validate("param", idParam), validate("json", accountInput), async (c) =>
    c.json(await updateAccount(c.var.db, c.req.valid("param").id, c.req.valid("json"), c.var.actor)),
  )
  .get("/:id/entries", validate("param", idParam), validate("query", cashBookQuery), async (c) =>
    c.json(await cashBook(c.var.db, c.req.valid("param").id, c.req.valid("query"))),
  );

export const cashRoutes = new Hono<AppEnv>()
  .use(backOffice())
  .post("/entries", validate("json", cashEntryInput), async (c) =>
    c.json(await createCashEntry(c.var.db, c.req.valid("json"), c.var.actor), 201),
  )
  .post("/transfers", validate("json", transferInput), async (c) =>
    c.json(await createTransfer(c.var.db, c.req.valid("json"), c.var.actor), 201),
  )
  .post("/transfers/:id/void", validate("param", idParam), validate("json", voidInput), async (c) =>
    c.json(await voidTransfer(c.var.db, c.req.valid("param").id, c.req.valid("json").reason, c.var.actor)),
  );
