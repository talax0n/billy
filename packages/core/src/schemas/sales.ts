import { z } from "zod";
import { discountKinds } from "../invoice.ts";
import { rupiah } from "../money.ts";
import { salesStatusFilters } from "../sales.ts";
import { businessDateInput, paginationQuery, rupiahInput, text } from "./common.ts";

export const paymentMethods = ["cash", "transfer", "qris", "giro"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];
export const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: "Tunai",
  transfer: "Transfer",
  qris: "QRIS",
  giro: "Giro",
};

const positiveRupiah = z
  .number()
  .int()
  .min(1, "Jumlah harus lebih dari 0")
  .transform((v) => rupiah(v));

export const salesLineInput = z.object({
  productId: z.uuid("Pilih produk"),
  qty: z.number().int().min(1, "Minimal 1"),
  unitPrice: rupiahInput,
  discountAmount: rupiahInput.default(rupiah(0)),
  /** The tinting colour code, printed on the invoice. */
  note: text(200),
});

export const paymentFields = {
  accountId: z.uuid("Pilih akun"),
  amount: positiveRupiah,
  method: z.enum(paymentMethods),
  proofUrl: z
    .union([z.literal(""), z.null(), z.url("Tautan bukti tidak valid").max(500)])
    .default(null)
    .transform((v) => v || null),
  note: text(500),
};

export const salesInvoiceInput = z.object({
  customerId: z.uuid("Pilih pelanggan"),
  date: businessDateInput,
  termsDays: z.number().int().min(0).max(365),
  discountKind: z.enum(discountKinds),
  /** Basis points for percent, rupiah for amount. */
  discountValue: z.number().int().min(0),
  note: text(500),
  lines: z.array(salesLineInput).min(1, "Minimal satu baris barang").max(200),
  /** "Bayar sekarang": a payment recorded on the invoice date in the same transaction. */
  payment: z.object(paymentFields).nullable().default(null),
});
export type SalesInvoiceInput = z.input<typeof salesInvoiceInput>;

export const salesPaymentInput = z.object({ ...paymentFields, date: businessDateInput });
export type SalesPaymentInput = z.input<typeof salesPaymentInput>;

export const salesListQuery = paginationQuery.extend({
  from: businessDateInput.optional(),
  to: businessDateInput.optional(),
  status: z.enum(salesStatusFilters).optional(),
  customerId: z.uuid().optional(),
});

export const lookupQuery = z.object({ q: z.string().trim().max(100).default("") });

export const invoiceBundleInput = z.object({
  customerId: z.uuid("Pilih pelanggan"),
  date: businessDateInput,
  note: text(500),
  invoiceIds: z.array(z.uuid()).min(1, "Pilih minimal satu faktur").max(200),
});
export type InvoiceBundleInput = z.input<typeof invoiceBundleInput>;
