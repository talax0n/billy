import { z } from "zod";
import { approvalInput } from "../approvals.ts";
import { discountKinds } from "../invoice.ts";
import { businessDateInput, paginationQuery, text } from "./common.ts";
import { salesLineInput } from "./sales.ts";

/** Stored statuses. `expired` is derived from `valid_until`, never stored. */
export const quotationStatuses = ["draft", "sent", "accepted", "rejected"] as const;
export type QuotationStatus = (typeof quotationStatuses)[number] | "expired";

export const quotationStatusLabels: Record<QuotationStatus, string> = {
  draft: "Draf",
  sent: "Terkirim",
  accepted: "Diterima",
  rejected: "Ditolak",
  expired: "Kedaluwarsa",
};

export const QUOTATION_VALID_DAYS = 14;

/** Draft and sent read as expired once the valid-until date has passed. */
export const quotationStatus = (stored: (typeof quotationStatuses)[number], validUntil: string, today: string): QuotationStatus =>
  (stored === "draft" || stored === "sent") && validUntil < today ? "expired" : stored;

export const quotationInput = z
  .object({
    customerId: z.uuid("Pilih pelanggan"),
    date: businessDateInput,
    validUntil: businessDateInput,
    discountKind: z.enum(discountKinds),
    discountValue: z.number().int().min(0),
    note: text(500),
    lines: z.array(salesLineInput).min(1, "Minimal satu baris barang").max(200),
  })
  .refine((q) => q.validUntil >= q.date, { path: ["validUntil"], message: "Tidak boleh sebelum tanggal penawaran" });
export type QuotationInput = z.input<typeof quotationInput>;

/** Draft → sent, draft or sent → rejected. Accepted only comes from "Jadikan faktur". */
export const quotationStatusInput = z.object({ status: z.enum(["sent", "rejected"]) });

export const quotationConvertInput = z.object({
  date: businessDateInput,
  termsDays: z.number().int().min(0).max(365),
  /** Only when a non-admin converts a line below cost or below the normal selling price. */
  approval: approvalInput.optional(),
});
export type QuotationConvertInput = z.input<typeof quotationConvertInput>;

export const quotationListQuery = paginationQuery.extend({ status: z.enum([...quotationStatuses, "expired"]).optional() });
