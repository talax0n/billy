import type { Db } from "@billy/db";
import { Hono } from "hono";
import { authRoutes } from "./auth/routes.ts";
import type { AppEnv } from "./env.ts";
import { onError } from "./lib/errors.ts";
import { categoryRoutes } from "./modules/categories/routes.ts";
import { invoiceBundleRoutes } from "./modules/invoice-bundles/routes.ts";
import { productRoutes } from "./modules/products/routes.ts";
import { salesRoutes } from "./modules/sales/routes.ts";
import { settingsRoutes } from "./modules/settings/routes.ts";
import { userRoutes } from "./modules/users/routes.ts";

/**
 * The module list. Add a module with one `.route()` line; the chain (not a loop) keeps
 * every route's types for the web's Hono client.
 */
export function createApp(db: Db) {
  return new Hono<AppEnv>()
    .basePath("/api")
    .use(async (c, next) => {
      c.set("db", db);
      await next();
    })
    .onError(onError)
    .notFound((c) => c.json({ error: "Tidak ditemukan" }, 404))
    .get("/health", (c) => c.json({ ok: true as const, service: "billy-api" }))
    .route("/auth", authRoutes)
    .route("/users", userRoutes)
    .route("/settings", settingsRoutes)
    .route("/categories", categoryRoutes)
    .route("/products", productRoutes)
    .route("/sales", salesRoutes)
    .route("/invoice-bundles", invoiceBundleRoutes);
}

export type AppType = ReturnType<typeof createApp>;
