import { z } from "zod";
import { businessDateInput, paginationQuery, rupiahInput, text } from "./common.ts";

/**
 * A shift as the Kasir device opens it. `id` (UUIDv7) and `openedAt` come from the device, so
 * an open queued offline and uploaded twice is recognised and not written twice.
 */
export const shiftOpenInput = z.object({
  id: z.uuid(),
  deviceCode: z.string().regex(/^[A-Z0-9]{1,4}$/, "Kode perangkat tidak valid"),
  /** The cash drawer account. */
  accountId: z.uuid(),
  openedAt: z.iso.datetime({ offset: true }),
  openingFloat: rupiahInput,
  /** As on a sale: admin and staff may upload another cashier's queued shift. */
  cashierId: z.uuid().optional(),
});
export type ShiftOpenInput = z.input<typeof shiftOpenInput>;

/** The blind count: what the cashier counted in the drawer. The expected amount is never asked or shown. */
export const shiftCloseInput = z.object({
  closedAt: z.iso.datetime({ offset: true }),
  countedCash: rupiahInput,
  note: text(500),
});
export type ShiftCloseInput = z.input<typeof shiftCloseInput>;

export const currentShiftQuery = z.object({ deviceCode: shiftOpenInput.shape.deviceCode });

export const shiftQuery = paginationQuery.extend({
  cashierId: z.uuid().optional(),
  from: businessDateInput.optional(),
  to: businessDateInput.optional(),
});
