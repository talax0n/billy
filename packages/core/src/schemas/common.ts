import { z } from "zod";
import { rupiah } from "../money.ts";

z.config(z.locales.id());

export const paginationQuery = z.object({
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.output<typeof paginationQuery>;

/** Shape of every list endpoint response. */
export interface Paginated<Row> {
  rows: Row[];
  total: number;
}

export const idParam = z.object({ id: z.uuid() });

export const rupiahInput = z
  .number()
  .int()
  .min(0)
  .transform((v) => rupiah(v));

export const businessDateInput = z.iso.date();

/** Optional unique text such as a product code: blank means none. */
export const optionalCode = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);

export const text = (max: number) => z.string().trim().max(max).default("");

/** `{ "lines.0.qty": "message" }`, the first message per field. Shared by API errors and forms. */
export function fieldErrors(error: z.core.$ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return fields;
}
