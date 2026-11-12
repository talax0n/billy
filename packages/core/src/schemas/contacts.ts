import { z } from "zod";
import { contactKinds } from "../contacts.ts";
import { paginationQuery, text } from "./common.ts";

export const contactKind = z.enum(contactKinds);

export const contactInput = z.object({
  code: z.string().trim().min(1, "Kode wajib diisi").max(40),
  name: z.string().trim().min(1, "Nama wajib diisi").max(200),
  kind: contactKind,
  phone: text(100),
  email: z.union([z.literal(""), z.email("Email tidak valid").max(200)]).default(""),
  address: text(500),
  taxId: text(100),
  paymentTermsDays: z.number().int().min(0, "Tidak boleh negatif").max(365, "Maksimal 365 hari").default(0),
  active: z.boolean().default(true),
});
export type ContactInput = z.input<typeof contactInput>;

export const contactQuery = paginationQuery.extend({ kind: contactKind.optional() });

export const contactLookupQuery = z.object({
  q: z.string().trim().max(100).default(""),
  kind: contactKind.optional(),
});

export const contactCodeQuery = z.object({ kind: contactKind });
