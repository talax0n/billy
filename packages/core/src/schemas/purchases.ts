import { z } from "zod";
import { businessDateInput, paginationQuery, rupiahInput, text } from "./common.ts";

const payment = z.object({ accountId: z.uuid(), date: businessDateInput, amount: rupiahInput.refine((v) => v > 0), method: z.enum(["cash", "transfer", "qris", "giro"]), note: text(500) });
export const purchasePaymentInput = payment;
export const purchaseInput = z.object({
  supplierId: z.uuid(), supplierInvoiceNumber: text(100), date: businessDateInput,
  termsDays: z.number().int().min(0).max(3650), discountKind: z.enum(["none", "percent", "amount"]),
  discountValue: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), taxRateBp: z.number().int().min(0).max(10000), note: text(500),
  lines: z.array(z.object({ productId: z.uuid(), qty: z.number().int().positive(), unitCost: rupiahInput, discountAmount: rupiahInput, note: text(500) })).min(1),
  payment: payment.optional(),
});
export const voidPurchaseInput = z.object({ reason: z.string().trim().min(1).max(500) });
export const purchaseListQuery = paginationQuery.extend({ from: businessDateInput.optional(), to: businessDateInput.optional(), supplierId: z.uuid().optional(), status: z.enum(["void", "paid", "partial", "unpaid", "overdue"]).optional() });
export const movementQuery = paginationQuery.extend({ from: businessDateInput.optional(), to: businessDateInput.optional(), productId: z.uuid().optional(), reason: z.enum(["purchase", "sale", "pos", "adjustment", "reversal"]).optional() });
