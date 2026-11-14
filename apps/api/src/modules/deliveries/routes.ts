import { deliveryCancelInput, deliveryCreateInput, deliveryDepartInput, driverInput, driverUpdateInput, idParam } from "@billy/core";
import { Hono } from "hono";
import { backOffice, requireRole } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { validate } from "../../lib/validate.ts";
import {
  cancelDelivery,
  createDelivery,
  createDriver,
  deliverDelivery,
  departDelivery,
  getBoard,
  requeueDelivery,
  updateDriver,
} from "./service.ts";

/**
 * Antrian Antar. The kasir stands where drivers pick up the goods, so every role reads the
 * board and moves deliveries along it; it shows no money. Adding one by hand (it can name a
 * faktur) and managing drivers is back office only. A kasir queues one by paying a nota with
 * "Diantar ke alamat" (see the POS module).
 */
export const deliveryRoutes = new Hono<AppEnv>()
  .use(requireRole("admin", "staff", "kasir"))
  .get("/", async (c) => c.json(await getBoard(c.var.db)))
  .post("/", backOffice(), validate("json", deliveryCreateInput), async (c) =>
    c.json(await createDelivery(c.var.db, c.req.valid("json"), c.var.actor), 201),
  )
  .post("/:id/depart", validate("param", idParam), validate("json", deliveryDepartInput), async (c) =>
    c.json(await departDelivery(c.var.db, c.req.valid("param").id, c.req.valid("json").driverId, c.var.actor)),
  )
  .post("/:id/deliver", validate("param", idParam), async (c) => c.json(await deliverDelivery(c.var.db, c.req.valid("param").id, c.var.actor)))
  .post("/:id/requeue", validate("param", idParam), async (c) => c.json(await requeueDelivery(c.var.db, c.req.valid("param").id, c.var.actor)))
  .post("/:id/cancel", validate("param", idParam), validate("json", deliveryCancelInput), async (c) =>
    c.json(await cancelDelivery(c.var.db, c.req.valid("param").id, c.req.valid("json").reason, c.var.actor)),
  )
  .post("/drivers", backOffice(), validate("json", driverInput), async (c) =>
    c.json(await createDriver(c.var.db, c.req.valid("json"), c.var.actor), 201),
  )
  .put("/drivers/:id", backOffice(), validate("param", idParam), validate("json", driverUpdateInput), async (c) =>
    c.json(await updateDriver(c.var.db, c.req.valid("param").id, c.req.valid("json"), c.var.actor)),
  );
