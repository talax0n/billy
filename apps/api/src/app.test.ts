import { expect, it } from "vitest";
import { createTestApp } from "./testing.ts";

const { call } = await createTestApp();

it("reports health under /api", async () => {
  const res = await call("/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, service: "billy-api" });
});

it("answers unknown routes and malformed bodies with JSON errors", async () => {
  const missing = await call("/api/nope");
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "Tidak ditemukan" });

  const malformed = await call("/api/auth/login", { method: "POST", body: undefined });
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toEqual({ error: "Malformed JSON in request body" });
});
