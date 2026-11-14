import { z } from "zod";
import { approvalInput } from "../approvals.ts";
import { discountKinds } from "../invoice.ts";
import { rupiah } from "../money.ts";
import { salesStatusFilters } from "../sales.ts";
import { businessDateInput, editReason, paginationQuery, paymentMethods, rupiahInput, sortQuery, text } from "./common.ts";

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
  /** Only when a non-admin's discount passes the cap. */
  approval: approvalInput.optional(),
});
export type SalesInvoiceInput = z.input<typeof salesInvoiceInput>;

/** Ubah: the corrected invoice in full. The original's payments move to it, so it takes none of its own. */
export const salesInvoiceEditInput = salesInvoiceInput.omit({ payment: true }).extend({ reason: editReason });
export type SalesInvoiceEditInput = z.input<typeof salesInvoiceEditInput>;

export const salesPaymentInput = z.object({ ...paymentFields, date: businessDateInput });
export type SalesPaymentInput = z.input<typeof salesPaymentInput>;

export const salesSortKeys = ["number", "customer", "date", "dueDate", "total", "paid", "outstanding", "status"] as const;
export type SalesSortKey = (typeof salesSortKeys)[number];

export const salesListQuery = paginationQuery.extend({
  from: businessDateInput.optional(),
  to: businessDateInput.optional(),
  status: z.enum(salesStatusFilters).optional(),
  customerId: z.uuid().optional(),
  ...sortQuery(salesSortKeys).shape,
});

export const invoiceBundleInput = z.object({
  customerId: z.uuid("Pilih pelanggan"),
  date: businessDateInput,
  note: text(500),
  invoiceIds: z.array(z.uuid()).min(1, "Pilih minimal satu faktur").max(200),
});
export type InvoiceBundleInput = z.input<typeof invoiceBundleInput>;

export const invoiceBundleEditInput = invoiceBundleInput.extend({ reason: editReason });
export type InvoiceBundleEditInput = z.input<typeof invoiceBundleEditInput>;
