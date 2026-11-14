import { z } from "zod";
import { rupiah } from "../money.ts";

z.config(z.locales.id());

export const paginationQuery = z.object({
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.output<typeof paginationQuery>;

export const sortDirs = ["asc", "desc"] as const;
export type SortDir = (typeof sortDirs)[number];

/** `?sort=&dir=` for a list whose columns can be sorted; no `sort` means the list's default order. */
export const sortQuery = <const Keys extends readonly [string, ...string[]]>(keys: Keys) =>
  z.object({ sort: z.enum(keys).optional(), dir: z.enum(sortDirs).default("asc") });

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

/** Ubah: why a posted document is replaced. The original is voided with "Diubah: <reason>". */
export const editReason = z.string().trim().min(1, "Alasan perubahan wajib diisi").max(500);

export const voidInput = z.object({ reason: z.string().trim().min(1, "Alasan void wajib diisi").max(500) });
export type VoidInput = z.input<typeof voidInput>;

export const paymentMethods = ["cash", "transfer", "qris", "giro"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];
export const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: "Tunai",
  transfer: "Transfer",
  qris: "QRIS",
  giro: "Giro",
};

export const lookupQuery = z.object({ q: z.string().trim().max(100).default("") });
