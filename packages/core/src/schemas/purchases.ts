import { z } from "zod";
import { discountKinds } from "../invoice.ts";
import { businessDateInput, paginationQuery, rupiahInput, text } from "./common.ts";

export const paymentMethods = ["cash", "transfer", "qris", "giro"] as const;

export const purchasePaymentInput = z.object({
  accountId: z.uuid("Pilih akun pembayaran"),
  date: businessDateInput,
  amount: rupiahInput.refine((amount) => amount > 0, "Jumlah harus lebih dari 0"),
  method: z.enum(paymentMethods),
  note: text(500),
});
export type PurchasePaymentInput = z.input<typeof purchasePaymentInput>;

export const purchaseLineInput = z.object({
  productId: z.uuid("Pilih produk"),
  qty: z.number().int().positive("Jumlah minimal 1"),
  unitCost: rupiahInput,
  discountAmount: rupiahInput,
  note: text(200),
});

export const purchaseInput = z.object({
  supplierId: z.uuid("Pilih pemasok"),
  supplierInvoiceNumber: text(100),
  date: businessDateInput,
  termsDays: z.number().int().min(0).max(3650),
  discountKind: z.enum(discountKinds),
  /** Basis points for `percent`, rupiah for `amount`. */
  discountValue: z.number().int().min(0),
  /** PPN in basis points: 1100 = 11%. */
  taxRateBp: z.number().int().min(0).max(10_000),
  note: text(500),
  lines: z.array(purchaseLineInput).min(1, "Tambahkan minimal satu barang"),
  /** "Bayar sekarang": a payment recorded in the same transaction. */
  payment: purchasePaymentInput.optional(),
});
export type PurchaseInput = z.input<typeof purchaseInput>;

export const voidInput = z.object({ reason: z.string().trim().min(1, "Alasan wajib diisi").max(500) });

export const purchaseStatusFilters = ["unpaid", "partial", "overdue", "paid", "void"] as const;

export const purchaseListQuery = paginationQuery.extend({
  from: businessDateInput.optional(),
  to: businessDateInput.optional(),
  supplierId: z.uuid().optional(),
  status: z.enum(purchaseStatusFilters).optional(),
});

export const lookupQuery = z.object({ q: z.string().trim().max(100).default("") });
