import { type Role, uuidv7 } from "@billy/core";
import { accounts, createDb, users } from "@billy/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { createApp } from "./app.ts";
import { hashPassword } from "./auth/password.ts";

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
    const [user] = await db
      .insert(users)
      .values({ username, name: `Uji ${role}`, role, passwordHash: await hashPassword("rahasia123") })
      .returning({ id: users.id, username: users.username, name: users.name, role: users.role });
    const res = await call("/api/auth/login", { method: "POST", body: { username, password: "rahasia123" } });
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    return { user: user!, cookie };
  };

  /**
   * The id of an open K1 shift for the session, opened on the first active cash account at the
   * first call. Every Kasir sale needs one: tests spread `shiftId` into their sale bodies.
   */
  const shifts = new Map<string, Promise<string>>();
  const shiftFor = (cookie: string) => {
    if (!shifts.has(cookie)) {
      shifts.set(
        cookie,
        (async () => {
          const [drawer] = await db
            .select({ id: accounts.id })
            .from(accounts)
            .where(and(eq(accounts.kind, "cash"), eq(accounts.active, true)))
            .orderBy(asc(accounts.code));
          const body = { id: uuidv7(), deviceCode: "K1", accountId: drawer!.id, openedAt: new Date().toISOString(), openingFloat: 0 };
          const res = await call("/api/pos/shifts", { method: "POST", cookie, body });
          if (res.status !== 201) throw new Error(`opening a test shift failed: ${res.status} ${await res.text()}`);
          return body.id;
        })(),
      );
    }
    return shifts.get(cookie)!;
  };

  return { app, db, call, signIn, shiftFor, close };
}
