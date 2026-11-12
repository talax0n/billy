import type { Role } from "@billy/core";
import { createDb } from "@billy/db";
import { sql } from "drizzle-orm";
import { createApp } from "./app.ts";
import { createUser } from "./modules/users/service.ts";

/**
 * A fresh, empty database on the Postgres server at `serverUrl`, for tests that need real
 * concurrent transactions (PGlite runs one transaction at a time).
 */
async function freshPostgres(serverUrl: string) {
  const name = `billy_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = await createDb({ url: serverUrl });
  await admin.db.execute(sql.raw(`create database ${name}`));
  await admin.close();
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

/**
 * A fresh app on an in-memory PGlite with migrations applied, plus helpers to call it as a role.
 * With `postgres` (a server URL), it runs on a new database on that server instead.
 */
export async function createTestApp({ postgres }: { postgres?: string | undefined } = {}) {
  const { db, migrate, close } = await createDb(postgres ? { url: await freshPostgres(postgres) } : {});
  await migrate();
  const app = createApp(db);

  const call = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
    app.request(path, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", ...(init.cookie && { cookie: init.cookie }) },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    });

  /** Creates a user with the role and returns the `cookie` header of a fresh session. */
  const signIn = async (role: Role, username: string = role) => {
    const user = await createUser(db, { username, name: `Uji ${role}`, role, password: "rahasia123" });
    const res = await call("/api/auth/login", { method: "POST", body: { username, password: "rahasia123" } });
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    return { user, cookie };
  };

  return { app, db, call, signIn, close };
}
