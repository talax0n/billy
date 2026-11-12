import { expenseInput, expenseQuery, idParam, voidInput } from "@billy/core";
import { Hono } from "hono";
import { backOffice } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { createExpense, getExpense, listExpenses, voidExpense } from "./service.ts";

export const expenseRoutes = new Hono<AppEnv>()
  .use(backOffice())
  .get("/", validate("query", expenseQuery), async (c) => c.json(await listExpenses(c.var.db, c.req.valid("query"))))
  .post("/", validate("json", expenseInput), async (c) =>
    c.json(await createExpense(c.var.db, c.req.valid("json"), c.var.user.id), 201),
  )
  .get("/:id", validate("param", idParam), async (c) => c.json(await getExpense(c.var.db, c.req.valid("param").id)))
  .post("/:id/void", validate("param", idParam), validate("json", voidInput), async (c) =>
    c.json(await voidExpense(c.var.db, c.req.valid("param").id, c.req.valid("json").reason, c.var.user.id)),
  );
