import { z } from "zod";
import { businessDateInput, paginationQuery } from "./common.ts";

export const stockReasons = ["purchase", "sale", "pos", "adjustment", "reversal"] as const;

export const movementQuery = paginationQuery.extend({
  from: businessDateInput.optional(),
  to: businessDateInput.optional(),
  productId: z.uuid().optional(),
  reason: z.enum(stockReasons).optional(),
});

export const opnameStatuses = ["draft", "posted"] as const;
export type OpnameStatus = (typeof opnameStatuses)[number];

/** All active products, or one category's. */
export const opnameCreateInput = z.object({
  categoryId: z.uuid().nullable(),
  note: z.string().trim().max(500).default(""),
});
export type OpnameCreateInput = z.input<typeof opnameCreateInput>;

/** Counted quantities to save on a draft. `null` clears a line, so it no longer counts. */
export const opnameCountInput = z.object({
  lines: z
    .array(z.object({ productId: z.uuid(), countedQty: z.number().int().min(0, "Jumlah tidak boleh minus").nullable() }))
    .min(1)
    .max(500),
});
export type OpnameCountInput = z.input<typeof opnameCountInput>;

export const opnameLineFilters = ["all", "counted", "uncounted", "difference"] as const;
export const opnameLinesQuery = paginationQuery.extend({ filter: z.enum(opnameLineFilters).default("all") });
