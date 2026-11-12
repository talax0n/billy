import { DomainError, settingsInput } from "@billy/core";
import { settings } from "@billy/db";
import { getTableColumns } from "drizzle-orm";
import { Hono } from "hono";
import { adminOnly, anySignedIn } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";

const { id: _id, ...columns } = getTableColumns(settings);

export const settingsRoutes = new Hono<AppEnv>()
  // Every role reads the shop header: the POS prints it on receipts.
  .get("/", anySignedIn(), async (c) => {
    const [row] = await c.var.db.select(columns).from(settings);
    if (!row) throw new DomainError("not_found", "Pengaturan toko belum dibuat");
    return c.json(row);
  })
  .put("/", adminOnly(), validate("json", settingsInput), async (c) => {
    const input = c.req.valid("json");
    const [row] = await c.var.db
      .insert(settings)
      .values({ id: 1, ...input })
      .onConflictDoUpdate({ target: settings.id, set: input })
      .returning(columns);
    return c.json(row!);
  });
