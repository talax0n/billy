import { z } from "zod";
import { paginationQuery, text } from "./common.ts";

export const contactKind = z.enum(["customer", "supplier", "employee", "other"]);
export const contactInput = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  kind: contactKind,
  phone: text(100), email: text(200), address: text(500), taxId: text(100),
  paymentTermsDays: z.number().int().min(0).default(0), active: z.boolean().default(true),
});
export const contactQuery = paginationQuery.extend({ kind: contactKind.optional() });
export const contactLookupQuery = z.object({ q: z.string().trim().max(100).default(""), kind: contactKind.optional() });
