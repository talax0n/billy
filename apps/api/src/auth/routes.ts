import { loginInput, type Role } from "@billy/core";
import { users } from "@billy/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env.ts";
import { audit } from "../lib/audit.ts";
import { validate } from "../lib/validate.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { anySignedIn } from "./require-role.ts";
import { createSession, deleteSession, findSessionUser, SESSION_COOKIE, SESSION_TTL_SECONDS } from "./session.ts";

/** A kasir only ever signs in to the Kasir screen; admin and staff land in the back office. */
const sourceOf = (role: Role) => (role === "kasir" ? "kasir" : "web");

/** Checked when the username is unknown, so a wrong username and a wrong password take the same time. */
const dummyHash = await hashPassword("not-a-real-password");

export const authRoutes = new Hono<AppEnv>()
  .post("/login", validate("json", loginInput), async (c) => {
    const { username, password } = c.req.valid("json");
    const [user] = await c.var.db.select().from(users).where(eq(users.username, username));
    const valid = await verifyPassword(password, user?.passwordHash ?? dummyHash);
    if (!user || !valid || !user.active) {
      await audit(c.var.db, user ? { id: user.id, role: user.role, source: sourceOf(user.role) } : null, {
        action: "auth.login_failed",
        entityId: user?.id ?? username,
        summary: `Gagal masuk sebagai ${username}${user && valid ? " (akun nonaktif)" : ""}`,
      });
      throw new HTTPException(401, { message: "Nama pengguna atau kata sandi salah" });
    }
    const { token, sessionStartedAt } = await c.var.db.transaction(async (tx) => {
      const session = await createSession(tx, user.id);
      await audit(tx, { id: user.id, role: user.role, source: sourceOf(user.role) }, { action: "auth.login", entityId: user.id, summary: `${user.name} masuk` });
      return session;
    });
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: new URL(c.req.url).protocol === "https:",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return c.json({ id: user.id, username: user.username, name: user.name, role: user.role, sessionStartedAt });
  })
  .post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const user = token ? await findSessionUser(c.var.db, token) : null;
    if (token) {
      await c.var.db.transaction(async (tx) => {
        await deleteSession(tx, token);
        if (user) await audit(tx, { id: user.id, role: user.role, source: sourceOf(user.role) }, { action: "auth.logout", entityId: user.id, summary: `${user.name} keluar` });
      });
    }
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true as const });
  })
  .get("/me", anySignedIn(), (c) => c.json(c.var.user));
