import { loginInput } from "@billy/core";
import { users } from "@billy/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env.ts";
import { validate } from "../lib/validate.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { anySignedIn } from "./require-role.ts";
import { createSession, deleteSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "./session.ts";

/** Checked when the username is unknown, so a wrong username and a wrong password take the same time. */
const dummyHash = await hashPassword("not-a-real-password");

export const authRoutes = new Hono<AppEnv>()
  .post("/login", validate("json", loginInput), async (c) => {
    const { username, password } = c.req.valid("json");
    const [user] = await c.var.db.select().from(users).where(eq(users.username, username));
    const valid = await verifyPassword(password, user?.passwordHash ?? dummyHash);
    if (!user || !valid || !user.active) {
      throw new HTTPException(401, { message: "Nama pengguna atau kata sandi salah" });
    }
    const token = await createSession(c.var.db, user.id);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: new URL(c.req.url).protocol === "https:",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return c.json({ id: user.id, username: user.username, name: user.name, role: user.role });
  })
  .post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await deleteSession(c.var.db, token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true as const });
  })
  .get("/me", anySignedIn(), (c) => c.json(c.var.user));
