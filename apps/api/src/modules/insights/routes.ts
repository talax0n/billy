import { Hono } from "hono";
import { backOffice } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import { actionsQuery, dashboardQuery, reportQuery } from "./query.ts";
import { exportReport } from "./reports.ts";
import { businessDate } from "@billy/core";
import { attention, dashboard, listActions, yearlyOverview } from "./service.ts";

export const insightRoutes = new Hono<AppEnv>()
  .use("/insights/*", backOffice())
  .use("/reports/*", backOffice())
  .get("/insights/dashboard", validate("query", dashboardQuery), async (c) =>
    c.json(await dashboard(c.var.db, c.req.valid("query"))),
  )
  .get("/insights/attention", async (c) => c.json(await attention(c.var.db, c.var.user.role === "admin")))
  .get("/insights/yearly", async (c) => c.json(await yearlyOverview(c.var.db, businessDate())))
  .get("/insights/actions", validate("query", actionsQuery), async (c) =>
    c.json(await listActions(c.var.db, c.req.valid("query"))),
  )
  .get("/reports/cash-book.xlsx", validate("query", reportQuery), async (c) => {
    const body = await exportReport(
      c.var.db,
      "cash-book",
      c.req.valid("query"),
    );
    return new Response(body, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="buku-kas.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  })
  .get("/reports/sales.xlsx", validate("query", reportQuery), async (c) => {
    const body = await exportReport(c.var.db, "sales", c.req.valid("query"));
    return new Response(body, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="penjualan.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  });
