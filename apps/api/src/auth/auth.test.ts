import { expect, it } from "vitest";
import { createTestApp } from "../testing.ts";

const { call, signIn } = await createTestApp();

it("signs in with an httpOnly SameSite=Lax cookie and returns the user", async () => {
  const { cookie } = await signIn("staff", "budi");
  const me = await call("/api/auth/me", { cookie });
  expect(me.status).toBe(200);
  expect(await me.json()).toMatchObject({ username: "budi", name: "Uji staff", role: "staff" });

  const res = await call("/api/auth/login", { method: "POST", body: { username: "BUDI", password: "rahasia123" } });
  const setCookie = res.headers.get("set-cookie")!;
  expect(setCookie).toMatch(/^billy_session=[\w-]{43};/);
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("SameSite=Lax");
  expect(setCookie).toContain("Max-Age=604800");
});

it("rejects a wrong password and an unknown user the same way", async () => {
  await signIn("staff", "sari");
  for (const body of [
    { username: "sari", password: "salah-sekali" },
    { username: "tidakada", password: "rahasia123" },
  ]) {
    const res = await call("/api/auth/login", { method: "POST", body });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Nama pengguna atau kata sandi salah" });
  }
});

it("ends the session on logout", async () => {
  const { cookie } = await signIn("admin", "pemilik");
  expect((await call("/api/auth/logout", { method: "POST", cookie })).status).toBe(200);
  expect((await call("/api/auth/me", { cookie })).status).toBe(401);
});

it("enforces roles: kasir cannot touch products or users, staff cannot manage users", async () => {
  const kasir = await signIn("kasir", "kasir1");
  const staff = await signIn("staff", "staf1");

  expect((await call("/api/products", { method: "POST", cookie: kasir.cookie, body: {} })).status).toBe(403);
  expect((await call("/api/products", { cookie: kasir.cookie })).status).toBe(403);
  expect((await call("/api/users", { cookie: kasir.cookie })).status).toBe(403);
  expect((await call("/api/users", { cookie: staff.cookie })).status).toBe(403);
  expect((await call("/api/products", { cookie: staff.cookie })).status).toBe(200);
  expect((await call("/api/products")).status).toBe(401);
});

it("lets an admin create and deactivate users, which ends their sessions", async () => {
  const admin = await signIn("admin", "admin2");
  const created = await call("/api/users", {
    method: "POST",
    cookie: admin.cookie,
    body: { username: "Kasir2", name: "Kasir Dua", role: "kasir", password: "rahasia123" },
  });
  expect(created.status).toBe(201);
  const user = (await created.json()) as { id: string };
  expect(user).toMatchObject({ username: "kasir2", role: "kasir", active: true });
  expect(user).not.toHaveProperty("passwordHash");

  const login = await call("/api/auth/login", { method: "POST", body: { username: "kasir2", password: "rahasia123" } });
  const kasirCookie = login.headers.get("set-cookie")!.split(";")[0]!;

  const deactivated = await call(`/api/users/${user.id}`, {
    method: "PUT",
    cookie: admin.cookie,
    body: { name: "Kasir Dua", role: "kasir", active: false },
  });
  expect(await deactivated.json()).toMatchObject({ active: false });
  expect((await call("/api/auth/me", { cookie: kasirCookie })).status).toBe(401);
});

it("stops an admin from locking themselves out", async () => {
  const admin = await signIn("admin", "admin3");
  const res = await call(`/api/users/${admin.user.id}`, {
    method: "PUT",
    cookie: admin.cookie,
    body: { name: "Admin", role: "admin", active: false },
  });
  expect(res.status).toBe(409);
});
