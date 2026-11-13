import { z } from "zod";
import { posRevisionInput, posSaleInput } from "./pos.ts";
import { quotationConvertInput } from "./quotations.ts";
import { salesInvoiceInput } from "./sales.ts";

/**
 * A remote approval request names the action it is for. The server derives the approved
 * subject from it with the same code the action runs, so the two always compare equal.
 */
export const approvalRequestInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pos.sale"), sale: posSaleInput }),
  z.object({ action: z.literal("pos.void"), saleId: z.uuid() }),
  z.object({ action: z.literal("pos.revise"), originalId: z.uuid(), revision: posRevisionInput }),
  z.object({ action: z.literal("pos.draft.cancel"), draftId: z.uuid() }),
  z.object({ action: z.literal("sales.invoice"), invoice: salesInvoiceInput }),
  z.object({ action: z.literal("quotation.convert"), quotationId: z.uuid(), convert: quotationConvertInput }),
]);
export type ApprovalRequestInput = z.input<typeof approvalRequestInput>;
