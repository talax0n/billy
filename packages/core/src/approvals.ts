import { z } from "zod";
import { BASIS_POINTS, computeTotals, type Discount, type LineInput } from "./invoice.ts";
import type { Rupiah } from "./money.ts";

/** What an approval lets a non-admin do. Phase 3 kinds are listed now so the enum never needs a migration. */
export const approvalKinds = [
  "void",
  "discount",
  "below_cost",
  "revisi_lower",
  "refund",
  "cancel_printed_draft",
  "foreign_or_past_revisi",
] as const;
export type ApprovalKind = (typeof approvalKinds)[number];

export const approvalKindLabels: Record<ApprovalKind, string> = {
  void: "Void",
  discount: "Diskon di atas batas",
  below_cost: "Harga di bawah modal",
  revisi_lower: "Revisi turun",
  refund: "Refund",
  cancel_printed_draft: "Batal nota sementara tercetak",
  foreign_or_past_revisi: "Revisi nota kasir lain / hari lalu",
};

export const approvalStatuses = ["pending", "approved", "rejected", "used", "expired"] as const;
export type ApprovalStatus = (typeof approvalStatuses)[number];

export const approvalMethods = ["pin", "remote"] as const;
export type ApprovalMethod = (typeof approvalMethods)[number];

/** A remote request waits this long for the admin, then for the kasir to spend it. */
export const APPROVAL_TTL_MS = 10 * 60_000;
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MS = 15 * 60_000;

const pin = z.string().regex(/^\d{6}$/, "PIN berupa 6 angka");

/** Sent with an action that needs approval: the admin's PIN typed on the spot, or an approved remote request. */
export const approvalInput = z.union([z.object({ pin }), z.object({ id: z.uuid() })]);
export type ApprovalInput = z.infer<typeof approvalInput>;

export const approvalPinInput = z.object({
  password: z.string().min(1, "Kata sandi wajib diisi"),
  pin,
});
export type ApprovalPinInput = z.input<typeof approvalPinInput>;

export const limitsInput = z.object({
  /** Basis points of the gross, line and document discounts combined. */
  kasirMaxDiscountBp: z.number().int().min(0, "Minimal 0%").max(BASIS_POINTS, "Maksimal 100%"),
  allowBelowCost: z.boolean(),
});
export type LimitsInput = z.input<typeof limitsInput>;
export type Limits = z.output<typeof limitsInput>;

export interface PricedLine extends LineInput {
  /** Unknown on the cashier device, which never holds cost prices. */
  unitCost?: Rupiah | undefined;
  /** Catalog sell price. A unit price under it counts as discount, so price cuts cannot bypass the cap. */
  listPrice?: Rupiah | undefined;
}

export type LimitBreach = { kind: "discount"; bp: number; maxBp: number } | { kind: "below_cost"; lines: number[] };

/**
 * Line and document discounts together, in basis points of the gross, rounded up. The gross is
 * at the catalog price when the line was sold under it, so the price cut adds to the discount;
 * a price above catalog (a tinted mix) counts at the price charged.
 */
export function combinedDiscountBp(lines: readonly PricedLine[], discount: Discount): number {
  const gross = lines.reduce((sum, l) => sum + l.qty * Math.max(l.unitPrice, l.listPrice ?? 0), 0);
  if (gross === 0) return 0;
  const off = gross - computeTotals(lines, discount).total;
  return Math.ceil((off * BASIS_POINTS) / gross);
}

/**
 * The limits a sale breaks, for a user who is limited at all (everyone except admin).
 * A line is below cost when its price after the line discount is under qty × unit cost.
 */
export function saleLimitBreaches(lines: readonly PricedLine[], discount: Discount, limits: Limits): LimitBreach[] {
  const breaches: LimitBreach[] = [];
  const bp = combinedDiscountBp(lines, discount);
  if (bp > limits.kasirMaxDiscountBp) breaches.push({ kind: "discount", bp, maxBp: limits.kasirMaxDiscountBp });
  if (!limits.allowBelowCost) {
    const below = lines.flatMap((l, i) =>
      l.unitCost !== undefined && l.qty * l.unitPrice - l.discountAmount < l.qty * l.unitCost ? [i] : [],
    );
    if (below.length) breaches.push({ kind: "below_cost", lines: below });
  }
  return breaches;
}

/** `500` → `5%`, `1250` → `12,5%`. */
export const formatBp = (bp: number) => `${(bp / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;

/** One sentence per breached limit, naming the limit. Never mentions a cost price. */
export function breachMessage(breaches: readonly LimitBreach[]): string {
  return breaches
    .map((b) =>
      b.kind === "discount"
        ? `Diskon ${formatBp(b.bp)} melebihi batas kasir ${formatBp(b.maxBp)} per nota.`
        : "Harga jual di bawah modal tidak diizinkan.",
    )
    .join(" ");
}
