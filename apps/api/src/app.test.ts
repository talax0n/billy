import { expect, it } from "vitest";
import { app } from "./app.ts";

it("reports health under /api", async () => {
  const res = await app.request("/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, service: "billy-api" });
});
