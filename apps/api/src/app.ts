import type { Db } from "@billy/db";
import { Hono } from "hono";
import { authRoutes } from "./auth/routes.ts";
import { approvalRoutes } from "./modules/approvals/routes.ts";
import { auditRoutes } from "./modules/audit/routes.ts";
import type { AppEnv } from "./env.ts";
import { onError } from "./lib/errors.ts";
import { categoryRoutes } from "./modules/categories/routes.ts";
import { invoiceBundleRoutes } from "./modules/invoice-bundles/routes.ts";
import { accountRoutes, cashRoutes } from "./modules/cash/routes.ts";
import { contactRoutes } from "./modules/contacts/routes.ts";
import { expenseRoutes } from "./modules/expenses/routes.ts";
import { insightRoutes } from "./modules/insights/routes.ts";
import { opnameRoutes } from "./modules/opname/routes.ts";
import { posRoutes } from "./modules/pos/routes.ts";
import { productRoutes } from "./modules/products/routes.ts";
import { salesRoutes } from "./modules/sales/routes.ts";
import { purchaseRoutes } from "./modules/purchases/routes.ts";
import { quotationRoutes } from "./modules/quotations/routes.ts";
import { settingsRoutes } from "./modules/settings/routes.ts";
import { shiftRoutes } from "./modules/shifts/routes.ts";
import { stockRoutes } from "./modules/stock/routes.ts";
import { userRoutes } from "./modules/users/routes.ts";
import { watchdogRoutes } from "./modules/watchdog/routes.ts";

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
    .route("/quotations", quotationRoutes)
    .route("/invoice-bundles", invoiceBundleRoutes)
    .route("/accounts", accountRoutes)
    .route("/cash", cashRoutes)
    .route("/expenses", expenseRoutes)
    .route("/contacts", contactRoutes)
    .route("/purchases", purchaseRoutes)
    .route("/stock", stockRoutes)
    .route("/opnames", opnameRoutes)
    .route("/pos", posRoutes)
    .route("/approvals", approvalRoutes)
    .route("/audit", auditRoutes)
    .route("/shifts", shiftRoutes)
    .route("/watchdog", watchdogRoutes)
    .route("/", insightRoutes);
}

export type AppType = ReturnType<typeof createApp>;
