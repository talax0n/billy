import { z } from "zod";
import { businessDateInput, optionalCode, rupiahInput, text } from "./common.ts";

export const categoryInput = z.object({
  name: z.string().trim().min(1, "Nama kategori wajib diisi").max(80),
  description: text(500),
});
export type CategoryInput = z.input<typeof categoryInput>;

export const productInput = z.object({
  code: optionalCode(40),
  barcode: optionalCode(64),
  name: z.string().trim().min(1, "Nama produk wajib diisi").max(200),
  variant: text(100),
  unit: z.string().trim().min(1, "Satuan wajib diisi").max(20),
  categoryId: z.uuid().nullable(),
  sellPrice: rupiahInput,
  costPrice: rupiahInput,
  minStock: z.number().int().min(0),
  active: z.boolean().default(true),
});
export type ProductInput = z.input<typeof productInput>;

export const stockAdjustmentInput = z.object({
  qty: z
    .number()
    .int()
    .refine((qty) => qty !== 0, "Jumlah tidak boleh 0"),
  note: z.string().trim().min(1, "Alasan penyesuaian wajib diisi").max(500),
  date: businessDateInput.optional(),
});
export type StockAdjustmentInput = z.input<typeof stockAdjustmentInput>;
