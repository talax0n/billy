import { idParam, paginationQuery, userCreateInput, userUpdateInput } from "@billy/core";
import { Hono } from "hono";
import { adminOnly } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { createUser, listUsers, updateUser } from "./service.ts";

export const userRoutes = new Hono<AppEnv>()
  .use(adminOnly())
  .get("/", validate("query", paginationQuery), async (c) => c.json(await listUsers(c.var.db, c.req.valid("query"))))
  .post("/", validate("json", userCreateInput), async (c) =>
    c.json(await createUser(c.var.db, c.req.valid("json")), 201),
  )
  .put("/:id", validate("param", idParam), validate("json", userUpdateInput), async (c) =>
    c.json(await updateUser(c.var.db, c.var.user.id, c.req.valid("param").id, c.req.valid("json"))),
  );
