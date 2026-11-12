import { accountInput, cashBookQuery, expenseInput, expenseQuery, idParam, manualCashInput, transferInput, voidInput } from "@billy/core";
import { Hono } from "hono";
import { anySignedIn, backOffice } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { cashBook, createExpense, createTransfer, listAccounts, listExpenses, lookupAccounts, manualCash, saveAccount, voidDocument } from "./service.ts";
export const accountRoutes = new Hono<AppEnv>()
  .get("/lookup", anySignedIn(), async (c) => c.json(await lookupAccounts(c.var.db)))
  .use("/*", backOffice())
  .get("/", async (c) => c.json(await listAccounts(c.var.db)))
  .post("/", validate("json", accountInput), async (c) => c.json(await saveAccount(c.var.db, c.req.valid("json")), 201))
  .put("/:id", validate("param", idParam), validate("json", accountInput), async (c) => c.json(await saveAccount(c.var.db, c.req.valid("json"), c.req.valid("param").id)))
  .get("/:id/entries", validate("param", idParam), validate("query", cashBookQuery), async (c) => c.json(await cashBook(c.var.db, c.req.valid("param").id, c.req.valid("query"))));
export const cashRoutes = new Hono<AppEnv>().use(backOffice())
  .post("/entries", validate("json", manualCashInput), async (c) => c.json(await manualCash(c.var.db, c.req.valid("json"), c.var.user.id), 201))
  .post("/transfers", validate("json", transferInput), async (c) => c.json(await createTransfer(c.var.db, c.req.valid("json"), c.var.user.id), 201))
  .post("/transfers/:id/void", validate("param", idParam), validate("json", voidInput), async (c) => c.json(await voidDocument(c.var.db, "transfer", c.req.valid("param").id, c.req.valid("json").reason, c.var.user.id)));
export const expenseRoutes = new Hono<AppEnv>().use(backOffice())
  .get("/", validate("query", expenseQuery), async (c) => c.json(await listExpenses(c.var.db, c.req.valid("query"))))
  .post("/", validate("json", expenseInput), async (c) => c.json(await createExpense(c.var.db, c.req.valid("json"), c.var.user.id), 201))
  .post("/:id/void", validate("param", idParam), validate("json", voidInput), async (c) => c.json(await voidDocument(c.var.db, "expense", c.req.valid("param").id, c.req.valid("json").reason, c.var.user.id)));
