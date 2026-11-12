import { DomainError } from "./errors.ts";
import { rupiah, type Rupiah } from "./money.ts";

export const discountKinds = ["none", "percent", "amount"] as const;
export type DiscountKind = (typeof discountKinds)[number];

/**
 * `value` is basis points for `percent` (1250 = 12,5%) and whole rupiah for `amount`.
 * It is ignored for `none`.
 */
export interface Discount {
  kind: DiscountKind;
  value: number;
}

export interface LineInput {
  qty: number;
  unitPrice: Rupiah;
  /** Discount on the whole line, in rupiah. */
  discountAmount: Rupiah;
}

export interface Totals {
  lineTotals: Rupiah[];
  subtotal: Rupiah;
  discountAmount: Rupiah;
  taxAmount: Rupiah;
  total: Rupiah;
}

export const BASIS_POINTS = 10_000;

/**
 * `amount * bp / 10000`, rounded half up to whole rupiah.
 * BigInt keeps it exact: amount × bp can pass 2^53 for large invoices.
 */
export function applyBasisPoints(amount: Rupiah, bp: number): Rupiah {
  const scaled = BigInt(amount) * BigInt(bp) + BigInt(BASIS_POINTS / 2);
  return rupiah(Number(scaled / BigInt(BASIS_POINTS)));
}

export function computeLineTotal(line: LineInput): Rupiah {
  if (!Number.isSafeInteger(line.qty) || line.qty <= 0) {
    throw new DomainError("invalid", "Jumlah barang harus bilangan bulat lebih dari 0");
  }
  const gross = rupiah(line.qty * line.unitPrice);
  if (line.discountAmount < 0 || line.discountAmount > gross) {
    throw new DomainError("invalid", "Diskon baris tidak boleh melebihi harga baris");
  }
  return rupiah(gross - line.discountAmount);
}

/**
 * Order of operations: line totals → subtotal → document discount → PPN on the discounted
 * subtotal. Each step rounds half up to whole rupiah, so the stored parts always add up:
 * `total = subtotal - discountAmount + taxAmount`.
 */
export function computeTotals(lines: readonly LineInput[], discount: Discount, taxRateBp = 0): Totals {
  if (lines.length === 0) throw new DomainError("invalid", "Minimal satu baris barang");
  if (!Number.isInteger(taxRateBp) || taxRateBp < 0 || taxRateBp > BASIS_POINTS) {
    throw new DomainError("invalid", "Tarif PPN tidak valid");
  }
  const lineTotals = lines.map(computeLineTotal);
  const subtotal = rupiah(lineTotals.reduce((sum, t) => sum + t, 0));
  const discountAmount = documentDiscount(subtotal, discount);
  const taxAmount = applyBasisPoints(rupiah(subtotal - discountAmount), taxRateBp);
  const total = rupiah(subtotal - discountAmount + taxAmount);
  return { lineTotals, subtotal, discountAmount, taxAmount, total };
}

function documentDiscount(subtotal: Rupiah, discount: Discount): Rupiah {
  if (!Number.isSafeInteger(discount.value) || discount.value < 0) {
    throw new DomainError("invalid", "Diskon tidak valid");
  }
  switch (discount.kind) {
    case "none":
      return rupiah(0);
    case "percent":
      if (discount.value > BASIS_POINTS) throw new DomainError("invalid", "Diskon persen maksimal 100%");
      return applyBasisPoints(subtotal, discount.value);
    case "amount":
      if (discount.value > subtotal) throw new DomainError("invalid", "Diskon melebihi subtotal");
      return rupiah(discount.value);
  }
}
