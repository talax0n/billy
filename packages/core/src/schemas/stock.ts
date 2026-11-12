import { z } from "zod";
import { businessDateInput, paginationQuery } from "./common.ts";

export const stockReasons = ["purchase", "sale", "pos", "adjustment", "reversal"] as const;

export const movementQuery = paginationQuery.extend({
  from: businessDateInput.optional(),
  to: businessDateInput.optional(),
  productId: z.uuid().optional(),
  reason: z.enum(stockReasons).optional(),
});
