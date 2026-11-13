import type { Role } from "@billy/core";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AuthedEnv } from "../env.ts";
import { findSessionUser, SESSION_COOKIE } from "./session.ts";

/**
 * Gate for every protected router: 401 without a live session, 403 when the role is not listed.
 * Sets `c.var.user` and `c.var.actor` (source `web`) for the handlers after it. Roles follow docs/architecture/data-model.md.
 */
export const requireRole = (...allowed: Role[]) =>
  createMiddleware<AuthedEnv>(async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const user = token ? await findSessionUser(c.var.db, token) : null;
    if (!user) throw new HTTPException(401, { message: "Silakan masuk terlebih dulu" });
    if (!allowed.includes(user.role)) throw new HTTPException(403, { message: "Anda tidak punya akses ke fitur ini" });
    c.set("user", user);
    c.set("actor", { id: user.id, role: user.role, source: "web" });
    await next();
  });

export const anySignedIn = () => requireRole("admin", "staff", "kasir");
/** Back-office modules: everything except users and settings. */
export const backOffice = () => requireRole("admin", "staff");
export const adminOnly = () => requireRole("admin");
