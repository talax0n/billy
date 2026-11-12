import { z } from "zod";
import { discountKinds } from "../invoice.ts";
import { rupiah } from "../money.ts";
import { rupiahInput, text } from "./common.ts";

export const posMethods = ["cash", "qris", "transfer"] as const;
export type PosMethod = (typeof posMethods)[number];

export const posLineInput = z.object({
  productId: z.uuid(),
  qty: z.number().int().min(1, "Jumlah minimal 1"),
  /** The price the cashier saw; the server rejects the sale when it no longer matches. */
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
});
export type PosSaleInput = z.input<typeof posSaleInput>;

export const posVoidInput = z.object({
  reason: z.string().trim().min(1, "Alasan void wajib diisi").max(500),
});
