import { z } from "zod";
import { approvalInput } from "../approvals.ts";
import { discountKinds } from "../invoice.ts";
import { rupiah } from "../money.ts";
import { rupiahInput, text } from "./common.ts";
import { deliveryDetailsInput } from "./deliveries.ts";

export const posMethods = ["cash", "qris", "transfer"] as const;
export type PosMethod = (typeof posMethods)[number];

export const posLineInput = z.object({
  productId: z.uuid(),
  qty: z.number().int().min(1, "Jumlah minimal 1"),
  /** The price actually charged; stored as is, even if the catalog price changed since. */
  unitPrice: rupiahInput,
  discountAmount: z.number().int().min(0).default(0).transform(rupiah),
  /** Tinting colour code and similar, printed on the receipt. */
  note: text(200),
});

/**
 * One POS sale as queued by the cashier device. `id` (UUIDv7) and `number` are allocated on
 * the device, so an upload retried after a dropped connection is recognised and not written twice.
 */
export const posSaleInput = z.object({
  id: z.uuid(),
  number: z.string().regex(/^[A-Z0-9]{1,4}-\d{6}-\d{4,}$/, "Nomor struk tidak valid"),
  soldAt: z.iso.datetime({ offset: true }),
  customerId: z.uuid().nullable().default(null),
  lines: z.array(posLineInput).min(1, "Minimal satu barang"),
  discount: z.object({ kind: z.enum(discountKinds), value: z.number().int().min(0) }),
  method: z.enum(posMethods),
  accountId: z.uuid(),
  tendered: rupiahInput,
  /** What the device charged; compared with the server's own computation. */
  total: rupiahInput,
  /**
   * The cashier signed in when the sale was made. A kasir may only upload their own sales;
   * admin and staff may upload any cashier's queued sales, recorded under that cashier.
   */
  cashierId: z.uuid().optional(),
  /** The cashier's open shift on this device; a sale needs one. */
  shiftId: z.uuid({ error: "Buka shift dulu sebelum berjualan" }),
  /** Only when the sale breaks a limit; never stored on the device, since it may hold the admin's PIN. */
  approval: approvalInput.optional(),
  /** "Diantar ke alamat": queues the goods in Antrian Antar with the sale. */
  delivery: deliveryDetailsInput.optional(),
});
export type PosSaleInput = z.input<typeof posSaleInput>;

export const posVoidInput = z.object({
  reason: z.string().trim().min(1, "Alasan void wajib diisi").max(500),
  approval: approvalInput.optional(),
});

const reasonInput = (label: string) => z.string().trim().min(1, `Alasan ${label} wajib diisi`).max(500);

/** A nota sementara: the cart kept on the server so any Kasir device can reopen and pay it. */
export const posDraftInput = z.object({
  customerId: posSaleInput.shape.customerId,
  lines: posSaleInput.shape.lines,
  discount: posSaleInput.shape.discount,
});
export type PosDraftInput = z.input<typeof posDraftInput>;

export const posDraftCancelInput = z.object({
  reason: reasonInput("batal"),
  /** Only once it has been printed. */
  approval: approvalInput.optional(),
});
export type PosDraftCancelInput = z.input<typeof posDraftCancelInput>;

/**
 * Revisi after payment, online only: the new nota (numbered on the device like any sale) that
 * replaces the original. The server stamps the time. `method` and `accountId` settle the
 * difference: a higher total collects it there, a lower total is refunded in cash from the
 * reviser's drawer whatever they say. `tendered` is what the customer hands over for the difference.
 */
export const posRevisionInput = posSaleInput.omit({ soldAt: true, cashierId: true, delivery: true }).extend({ reason: reasonInput("revisi") });
export type PosRevisionInput = z.input<typeof posRevisionInput>;
