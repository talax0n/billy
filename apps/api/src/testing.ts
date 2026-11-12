import type { Role } from "@billy/core";
import { createDb } from "@billy/db";
import { createApp } from "./app.ts";
import { createUser } from "./modules/users/service.ts";

/** A fresh app on an in-memory PGlite with migrations applied, plus helpers to call it as a role. */
export async function createTestApp() {
  const { db, migrate } = await createDb();
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

  return { app, db, call, signIn };
}
