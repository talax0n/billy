import { contactCodeQuery, contactInput, contactLookupQuery, contactQuery, idParam } from "@billy/core";
import { Hono } from "hono";
import { backOffice } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { createContact, getContact, listContacts, lookupContacts, suggestContactCode, updateContact } from "./service.ts";

export const contactRoutes = new Hono<AppEnv>()
  .use(backOffice())
  .get("/", validate("query", contactQuery), async (c) => c.json(await listContacts(c.var.db, c.req.valid("query"))))
  .get("/lookup", validate("query", contactLookupQuery), async (c) =>
    c.json(await lookupContacts(c.var.db, c.req.valid("query"))),
  )
  .get("/next-code", validate("query", contactCodeQuery), async (c) =>
    c.json(await suggestContactCode(c.var.db, c.req.valid("query").kind)),
  )
  .post("/", validate("json", contactInput), async (c) => c.json(await createContact(c.var.db, c.req.valid("json")), 201))
  .get("/:id", validate("param", idParam), async (c) => c.json(await getContact(c.var.db, c.req.valid("param").id)))
  .put("/:id", validate("param", idParam), validate("json", contactInput), async (c) =>
    c.json(await updateContact(c.var.db, c.req.valid("param").id, c.req.valid("json"))),
  );
