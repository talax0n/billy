import { changedFields, DomainError, formatBp, formatRupiah, limitsInput, settingsInput, watchdogSettingsInput } from "@billy/core";
import { settings } from "@billy/db";
import { getTableColumns } from "drizzle-orm";
import { Hono } from "hono";
import { adminOnly, anySignedIn } from "../../auth/require-role.ts";
import type { AppEnv } from "../../env.ts";
import { audit } from "../../lib/audit.ts";
import { validate } from "../../lib/validate.ts";
import { getLimits } from "../pos/service.ts";
import { getWatchdogSettings } from "../watchdog/service.ts";

const {
  id: _id,
  kasirMaxDiscountBp: _max,
  allowBelowCost: _below,
  cashDifferenceThreshold: _threshold,
  openTime: _open,
  closeTime: _close,
  ...columns
} = getTableColumns(settings);

export const settingsRoutes = new Hono<AppEnv>()
  // Every role reads the shop header: the POS prints it on receipts.
  .get("/", anySignedIn(), async (c) => {
    const [row] = await c.var.db.select(columns).from(settings);
    if (!row) throw new DomainError("not_found", "Pengaturan toko belum dibuat");
    return c.json(row);
  })
  .put("/", adminOnly(), validate("json", settingsInput), async (c) => {
    const input = c.req.valid("json");
    const row = await c.var.db.transaction(async (tx) => {
      const [before] = await tx.select(columns).from(settings).for("update");
      const [row] = await tx
        .insert(settings)
        .values({ id: 1, ...input })
        .onConflictDoUpdate({ target: settings.id, set: input })
        .returning(columns);
      const diff = before ? changedFields(before, row!) : { before: null, after: row! };
      if (diff) await audit(tx, c.var.actor, { action: "settings.update", entityId: "1", summary: "Pengaturan toko diubah", ...diff });
      return row!;
    });
    return c.json(row);
  })
  /** Batas kasir. The POS reads them through its catalog; only admin reads or edits them here. */
  .get("/limits", adminOnly(), async (c) => c.json(await getLimits(c.var.db)))
  .put("/limits", adminOnly(), validate("json", limitsInput), async (c) => {
    const input = c.req.valid("json");
    const limits = await c.var.db.transaction(async (tx) => {
      const before = await getLimits(tx);
      const [row] = await tx
        .update(settings)
        .set(input)
        .returning({ kasirMaxDiscountBp: settings.kasirMaxDiscountBp, allowBelowCost: settings.allowBelowCost });
      if (!row) throw new DomainError("not_found", "Simpan pengaturan toko dulu");
      const diff = changedFields(before, row);
      if (diff) {
        await audit(tx, c.var.actor, {
          action: "settings.limits.update",
          entityId: "1",
          summary: `Batas kasir: diskon maks ${formatBp(row.kasirMaxDiscountBp)}, ${row.allowBelowCost ? "boleh" : "tidak boleh"} di bawah modal`,
          ...diff,
        });
      }
      return row;
    });
    return c.json(limits);
  })
  /** Pengawasan: what the watchdog flags. Never sent to the Kasir device, so a cashier cannot stay under it. */
  .get("/watchdog", adminOnly(), async (c) => c.json(await getWatchdogSettings(c.var.db)))
  .put("/watchdog", adminOnly(), validate("json", watchdogSettingsInput), async (c) => {
    const input = c.req.valid("json");
    const saved = await c.var.db.transaction(async (tx) => {
      const before = await getWatchdogSettings(tx);
      const [row] = await tx.update(settings).set(input).returning({ id: settings.id });
      if (!row) throw new DomainError("not_found", "Simpan pengaturan toko dulu");
      const after = await getWatchdogSettings(tx);
      const diff = changedFields(before, after);
      if (diff) {
        await audit(tx, c.var.actor, {
          action: "settings.watchdog.update",
          entityId: "1",
          summary: `Pengawasan: selisih kas ${formatRupiah(after.cashDifferenceThreshold)}, jam buka ${after.openTime}–${after.closeTime}`,
          ...diff,
        });
      }
      return after;
    });
    return c.json(saved);
  });
