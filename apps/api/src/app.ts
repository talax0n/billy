import { Hono } from "hono";

export const app = new Hono()
  .basePath("/api")
  .get("/health", (c) => c.json({ ok: true as const, service: "billy-api" }));

export type AppType = typeof app;
export default app;
